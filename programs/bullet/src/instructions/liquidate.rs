use crate::ix_accounts::Liquidate;
use crate::errors::BulletError;
use crate::events::Liquidated;
use crate::math;
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Burn};

pub fn handler(ctx: Context<Liquidate>) -> Result<()> {
    let clock = Clock::get()?;
    require!(
        clock.unix_timestamp > ctx.accounts.loan.end_ts,
        BulletError::LoanNotExpired
    );

    let protocol = &ctx.accounts.protocol;
    let vault_bal = ctx.accounts.vault.amount;
    let backing_before = math::backing(vault_bal, protocol.total_borrowed)?;
    let floor_before = math::floor_scaled(backing_before, protocol.total_supply)?;

    let collateral = ctx.accounts.loan.collateral_bullet;
    let borrowed = ctx.accounts.loan.borrowed_ansem;
    let borrower = ctx.accounts.loan.borrower;

    // Burn locked collateral from collateral vault.
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

    // Keep total_borrowed unchanged — borrowed Ansem stays in backing math (floor rises for holders).
    let new_supply = protocol
        .total_supply
        .checked_sub(collateral)
        .ok_or(BulletError::MathOverflow)?;
    let backing_after = math::backing(vault_bal, protocol.total_borrowed)?;
    let floor_after = math::floor_scaled(backing_after, new_supply)?;
    math::assert_floor_non_decreasing(floor_before, floor_after)?;

    let loan_key = ctx.accounts.loan.key();
    ctx.accounts.loan.active = false;

    let protocol = &mut ctx.accounts.protocol;
    protocol.total_supply = new_supply;

    emit!(Liquidated {
        loan: loan_key,
        borrower,
        collateral_burned: collateral,
        borrowed_kept_in_backing: borrowed,
        floor_after,
    });

    Ok(())
}
