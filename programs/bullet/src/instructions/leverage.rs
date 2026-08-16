use crate::ix_accounts::Leverage;
use crate::errors::BulletError;
use crate::events::Leveraged;
use crate::math;
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Transfer};
use anchor_spl::token_interface::{self, MintTo};

/// Leverage loop:
/// bakeFee = 1% of A
/// userSpy = A - bakeFee
/// userBorrow = 0.99 * userSpy
/// overCollat = 0.01 * userSpy
/// interest on userBorrow
/// user pays bakeFee + interest + overCollat
/// protocol mints BULLET for full userSpy notional and locks as collateral with debt = userBorrow
///
/// The userBorrow is NOT paid out to the user: it is internal credit recorded in
/// `total_borrowed` that backs the freshly minted collateral (so the floor does not
/// dilute). The user repays userBorrow later to reclaim the collateral.
pub fn handler(ctx: Context<Leverage>, ansem_amount: u64, number_of_days: u16) -> Result<()> {
    require!(ctx.accounts.protocol.trading_enabled, BulletError::TradingDisabled);
    require!(ansem_amount > 0, BulletError::ZeroAmount);
    require!(
        number_of_days >= MIN_LOAN_DAYS && number_of_days <= MAX_LOAN_DAYS,
        BulletError::InvalidLoanDuration
    );

    let protocol = &ctx.accounts.protocol;
    let vault_bal = ctx.accounts.vault.amount;
    let backing_before = math::backing(vault_bal, protocol.total_borrowed)?;
    let floor_before = math::floor_scaled(backing_before, protocol.total_supply)?;

    let bake_fee = math::bps(ansem_amount, LEVERAGE_BAKE_BPS)?;
    let user_spy = ansem_amount
        .checked_sub(bake_fee)
        .ok_or(BulletError::MathOverflow)?;
    let user_borrow = math::bps(user_spy, LTV_BPS)?;
    let over_collat = math::bps(user_spy, OVERCOLLAT_BPS)?;
    let interest = math::interest_fee(user_borrow, number_of_days)?;
    let fees_total = bake_fee
        .checked_add(interest)
        .ok_or(BulletError::MathOverflow)?
        .checked_add(over_collat)
        .ok_or(BulletError::MathOverflow)?;

    require!(
        ctx.accounts.user_ansem.amount >= fees_total,
        BulletError::InsufficientLeverageFee
    );

    // Pull fees into vault.
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.user_ansem.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        fees_total,
    )?;

    // Split only bake + interest (over-collat stays fully in backing).
    let splittable = bake_fee
        .checked_add(interest)
        .ok_or(BulletError::MathOverflow)?;
    let (pol, bribe) = math::split_fee(splittable)?;

    let bump = protocol.bump;
    let seeds: &[&[u8]] = &[Protocol::SEED, &[bump]];

    if pol > 0 {
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.pol_vault.to_account_info(),
                    authority: ctx.accounts.protocol.to_account_info(),
                },
                &[seeds],
            ),
            pol,
        )?;
    }
    if bribe > 0 {
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.fee_recipient_ata.to_account_info(),
                    authority: ctx.accounts.protocol.to_account_info(),
                },
                &[seeds],
            ),
            bribe,
        )?;
    }

    // Mint BULLET for user_spy notional at curve, apply leverage bake path (already paid 1%).
    // Gross mint ≈ ansem_to_bullet for user_spy after deposit of over_collat+backing parts.
    let vault_after_fees = vault_bal
        .checked_add(fees_total)
        .ok_or(BulletError::MathOverflow)?
        .checked_sub(pol)
        .ok_or(BulletError::MathOverflow)?
        .checked_sub(bribe)
        .ok_or(BulletError::MathOverflow)?;

    // Treat over_collat as the "spot deposit" portion for mint curve sizing of user_spy exposure.
    // Mint amount: convert user_spy Ansem-notional → BULLET at current floor.
    let floor = math::floor_scaled(
        math::backing(vault_after_fees, protocol.total_borrowed)?,
        protocol.total_supply,
    )?;
    let bullet_minted = if protocol.total_supply == 0 {
        user_spy
    } else {
        // bullet = user_spy * 1e6 / floor
        let b = (user_spy as u128)
            .checked_mul(1_000_000)
            .ok_or(BulletError::MathOverflow)?
            .checked_div(floor as u128)
            .ok_or(BulletError::DivisionByZero)?;
        u64::try_from(b).map_err(|_| BulletError::MathOverflow)?
    };

    let new_minted = protocol
        .total_minted
        .checked_add(bullet_minted)
        .ok_or(BulletError::MathOverflow)?;
    require!(new_minted <= protocol.max_supply, BulletError::MaxSupplyExceeded);
    let new_supply = protocol
        .total_supply
        .checked_add(bullet_minted)
        .ok_or(BulletError::MathOverflow)?;

    // Mint BULLET directly into collateral vault (locked).
    token_interface::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.bullet_token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.bullet_mint.to_account_info(),
                to: ctx.accounts.collateral_vault.to_account_info(),
                authority: ctx.accounts.protocol.to_account_info(),
            },
            &[seeds],
        ),
        bullet_minted,
    )?;

    // NOTE: the borrowed Ansem is intentionally NOT disbursed. Leverage extends
    // internal credit that backs the freshly minted collateral; the debt is recorded
    // in `total_borrowed` and repaid later to reclaim the collateral.
    let clock = Clock::get()?;
    let end_ts = clock
        .unix_timestamp
        .checked_add((number_of_days as i64).checked_mul(SECONDS_PER_DAY).unwrap())
        .ok_or(BulletError::MathOverflow)?;

    let vault_final = vault_after_fees;
    let new_borrowed = protocol
        .total_borrowed
        .checked_add(user_borrow)
        .ok_or(BulletError::MathOverflow)?;
    let backing_after = math::backing(vault_final, new_borrowed)?;
    let floor_after = math::floor_scaled(backing_after, new_supply)?;
    math::assert_floor_non_decreasing(floor_before, floor_after)?;

    let loan_id = protocol.loan_count;
    let loan_bump = ctx.bumps.loan;
    let loan_key = ctx.accounts.loan.key();
    {
        let loan = &mut ctx.accounts.loan;
        loan.protocol = ctx.accounts.protocol.key();
        loan.borrower = ctx.accounts.user.key();
        loan.collateral_bullet = bullet_minted;
        loan.borrowed_ansem = user_borrow;
        loan.start_ts = clock.unix_timestamp;
        loan.end_ts = end_ts;
        loan.active = true;
        loan.bump = loan_bump;
        loan.padding = [0u8; 32];
    }

    {
        let protocol = &mut ctx.accounts.protocol;
        protocol.total_minted = new_minted;
        protocol.total_supply = new_supply;
        protocol.total_borrowed = new_borrowed;
        protocol.loan_count = loan_id
            .checked_add(1)
            .ok_or(BulletError::MathOverflow)?;
    }

    emit!(Leveraged {
        user: ctx.accounts.user.key(),
        loan: loan_key,
        ansem_notional: ansem_amount,
        bullet_minted,
        borrowed: user_borrow,
        fees_paid: fees_total,
        end_ts,
    });

    Ok(())
}
