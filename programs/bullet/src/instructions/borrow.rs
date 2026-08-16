use crate::ix_accounts::Borrow;
use crate::errors::BulletError;
use crate::events::Borrowed;
use crate::math;
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Transfer};
use anchor_spl::token_interface::{self, Burn, MintTo};

pub fn handler(ctx: Context<Borrow>, ansem_amount: u64, number_of_days: u16) -> Result<()> {
    require!(ctx.accounts.protocol.trading_enabled, BulletError::TradingDisabled);
    require!(ansem_amount > 0, BulletError::ZeroAmount);
    require!(
        number_of_days >= MIN_LOAN_DAYS && number_of_days <= MAX_LOAN_DAYS,
        BulletError::InvalidLoanDuration
    );

    let protocol = &ctx.accounts.protocol;
    let vault_bal = ctx.accounts.vault.amount;
    require!(vault_bal >= ansem_amount, BulletError::InsufficientBacking);

    let backing_amt = math::backing(vault_bal, protocol.total_borrowed)?;
    let floor_before = math::floor_scaled(backing_amt, protocol.total_supply)?;

    // Interest paid upfront in Ansem from user.
    let interest = math::interest_fee(ansem_amount, number_of_days)?;
    let (pol, bribe) = math::split_fee(interest)?;
    // 70% of interest stays in vault as backing boost.
    let interest_to_vault = interest
        .checked_sub(pol)
        .ok_or(BulletError::MathOverflow)?
        .checked_sub(bribe)
        .ok_or(BulletError::MathOverflow)?;

    // Collect interest from user → vault, then route pol/bribe.
    if interest > 0 {
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user_ansem.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            interest,
        )?;
    }

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

    // Collateral required: enough BULLET so max borrow >= ansem_amount.
    // collateral_value * 0.99 >= ansem_amount
    // collateral >= ceil(ansem_amount / 0.99 / floor)
    // Simpler: user must send collateral such that LTV holds after lock.
    // We require the user to deposit ALL their intended collateral via remaining:
    // Here we compute min collateral from floor.
    let floor = math::floor_scaled(backing_amt, protocol.total_supply)?;
    // collateral_bullet * floor/1e6 * 0.99 >= ansem_amount
    // collateral >= ansem_amount * 1e6 * 10000 / (floor * 9900)
    let min_collateral = if protocol.total_supply == 0 || floor == 0 {
        return err!(BulletError::InsufficientBacking);
    } else {
        let num = (ansem_amount as u128)
            .checked_mul(1_000_000)
            .ok_or(BulletError::MathOverflow)?
            .checked_mul(BPS_DENOM as u128)
            .ok_or(BulletError::MathOverflow)?;
        let den = (floor as u128)
            .checked_mul(LTV_BPS as u128)
            .ok_or(BulletError::MathOverflow)?;
        let mut c = num
            .checked_div(den)
            .ok_or(BulletError::DivisionByZero)?;
        if num % den != 0 {
            c = c.checked_add(1).ok_or(BulletError::MathOverflow)?;
        }
        u64::try_from(c).map_err(|_| BulletError::MathOverflow)?
    };

    require!(
        ctx.accounts.user_bullet.amount >= min_collateral,
        BulletError::ExceedsLtv
    );

    // Lock collateral without a taxable BULLET transfer (burn + mint to vault).
    token_interface::burn(
        CpiContext::new(
            ctx.accounts.bullet_token_program.to_account_info(),
            Burn {
                mint: ctx.accounts.bullet_mint.to_account_info(),
                from: ctx.accounts.user_bullet.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        min_collateral,
    )?;
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
        min_collateral,
    )?;

    // Send borrowed Ansem to user (backing math: vault down, total_borrowed up).
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.user_ansem.to_account_info(),
                authority: ctx.accounts.protocol.to_account_info(),
            },
            &[seeds],
        ),
        ansem_amount,
    )?;

    let clock = Clock::get()?;
    let end_ts = clock
        .unix_timestamp
        .checked_add((number_of_days as i64).checked_mul(SECONDS_PER_DAY).unwrap())
        .ok_or(BulletError::MathOverflow)?;

    // Floor check: vault lost ansem_amount but gained interest_to_vault; total_borrowed += ansem_amount.
    // Net backing change = +interest_to_vault (borrow is neutral). Supply unchanged → floor up or same.
    let vault_after = vault_bal
        .checked_add(interest)
        .ok_or(BulletError::MathOverflow)?
        .checked_sub(pol)
        .ok_or(BulletError::MathOverflow)?
        .checked_sub(bribe)
        .ok_or(BulletError::MathOverflow)?
        .checked_sub(ansem_amount)
        .ok_or(BulletError::InsufficientBacking)?;
    let new_borrowed = protocol
        .total_borrowed
        .checked_add(ansem_amount)
        .ok_or(BulletError::MathOverflow)?;
    let backing_after = math::backing(vault_after, new_borrowed)?;
    let floor_after = math::floor_scaled(backing_after, protocol.total_supply)?;
    math::assert_floor_non_decreasing(floor_before, floor_after)?;

    let loan_id = protocol.loan_count;
    let loan_bump = ctx.bumps.loan;
    let loan_key = ctx.accounts.loan.key();
    {
        let loan = &mut ctx.accounts.loan;
        loan.protocol = ctx.accounts.protocol.key();
        loan.borrower = ctx.accounts.user.key();
        loan.collateral_bullet = min_collateral;
        loan.borrowed_ansem = ansem_amount;
        loan.start_ts = clock.unix_timestamp;
        loan.end_ts = end_ts;
        loan.active = true;
        loan.bump = loan_bump;
        loan.padding = [0u8; 32];
    }

    {
        let protocol = &mut ctx.accounts.protocol;
        protocol.total_borrowed = new_borrowed;
        protocol.loan_count = loan_id
            .checked_add(1)
            .ok_or(BulletError::MathOverflow)?;
    }

    let _ = interest_to_vault;

    emit!(Borrowed {
        user: ctx.accounts.user.key(),
        loan: loan_key,
        collateral: min_collateral,
        borrowed: ansem_amount,
        interest,
        end_ts,
    });

    Ok(())
}
