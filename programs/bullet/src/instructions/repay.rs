use crate::ix_accounts::Repay;
use crate::errors::BulletError;
use crate::events::Repaid;
use crate::math;
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Transfer};
use anchor_spl::token_interface::{self, Burn, MintTo};

pub fn handler(ctx: Context<Repay>) -> Result<()> {
    let clock = Clock::get()?;
    require!(
        clock.unix_timestamp <= ctx.accounts.loan.end_ts,
        BulletError::LoanExpired
    );

    let protocol = &ctx.accounts.protocol;
    let vault_bal = ctx.accounts.vault.amount;
    let backing_before = math::backing(vault_bal, protocol.total_borrowed)?;
    let floor_before = math::floor_scaled(backing_before, protocol.total_supply)?;

    let principal = ctx.accounts.loan.borrowed_ansem;
    let collateral = ctx.accounts.loan.collateral_bullet;

    // Return principal Ansem to vault.
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.user_ansem.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        principal,
    )?;

    // Return collateral BULLET without a taxable transfer (burn vault + mint to user).
    let bump = protocol.bump;
    let seeds: &[&[u8]] = &[Protocol::SEED, &[bump]];
    token_interface::burn(
        CpiContext::new_with_signer(
            ctx.accounts.bullet_token_program.to_account_info(),
            Burn {
                mint: ctx.accounts.bullet_mint.to_account_info(),
                from: ctx.accounts.collateral_vault.to_account_info(),
                authority: ctx.accounts.protocol.to_account_info(),
            },
            &[seeds],
        ),
        collateral,
    )?;
    token_interface::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.bullet_token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.bullet_mint.to_account_info(),
                to: ctx.accounts.user_bullet.to_account_info(),
                authority: ctx.accounts.protocol.to_account_info(),
            },
            &[seeds],
        ),
        collateral,
    )?;

    let new_borrowed = protocol
        .total_borrowed
        .checked_sub(principal)
        .ok_or(BulletError::MathOverflow)?;
    let vault_after = vault_bal
        .checked_add(principal)
        .ok_or(BulletError::MathOverflow)?;
    let backing_after = math::backing(vault_after, new_borrowed)?;
    let floor_after = math::floor_scaled(backing_after, protocol.total_supply)?;
    math::assert_floor_non_decreasing(floor_before, floor_after)?;

    let loan_key = ctx.accounts.loan.key();
    ctx.accounts.loan.active = false;

    let protocol = &mut ctx.accounts.protocol;
    protocol.total_borrowed = new_borrowed;

    emit!(Repaid {
        user: ctx.accounts.user.key(),
        loan: loan_key,
        principal,
        collateral_returned: collateral,
    });

    Ok(())
}
