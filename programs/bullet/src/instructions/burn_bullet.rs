use crate::ix_accounts::BurnBullet;
use crate::errors::BulletError;
use crate::events::Burned;
use crate::math;
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Transfer};

pub fn handler(ctx: Context<BurnBullet>, bullet_amount: u64) -> Result<()> {
    require!(ctx.accounts.protocol.trading_enabled, BulletError::TradingDisabled);
    require!(bullet_amount > 0, BulletError::ZeroAmount);

    let protocol = &ctx.accounts.protocol;
    let vault_bal = ctx.accounts.vault.amount;
    let backing_amt = math::backing(vault_bal, protocol.total_borrowed)?;
    let floor_before = math::floor_scaled(backing_amt, protocol.total_supply)?;

    let gross = math::bullet_to_ansem_gross(bullet_amount, protocol.total_supply, backing_amt)?;
    let user_out = math::apply_out_fee(gross)?;
    let fee = math::protocol_fee(gross)?;
    let (pol, bribe) = math::split_fee(fee)?;

    // Burn BULLET from user.
    token::burn(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Burn {
                mint: ctx.accounts.bullet_mint.to_account_info(),
                from: ctx.accounts.user_bullet.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        bullet_amount,
    )?;

    let bump = protocol.bump;
    let seeds: &[&[u8]] = &[Protocol::SEED, &[bump]];

    // Pay user.
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
        user_out,
    )?;

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

    let new_supply = protocol
        .total_supply
        .checked_sub(bullet_amount)
        .ok_or(BulletError::MathOverflow)?;
    let left_vault = user_out
        .checked_add(pol)
        .ok_or(BulletError::MathOverflow)?
        .checked_add(bribe)
        .ok_or(BulletError::MathOverflow)?;
    let vault_after = vault_bal
        .checked_sub(left_vault)
        .ok_or(BulletError::InsufficientBacking)?;
    let backing_after = math::backing(vault_after, protocol.total_borrowed)?;
    let floor_after = math::floor_scaled(backing_after, new_supply)?;
    math::assert_floor_non_decreasing(floor_before, floor_after)?;

    let protocol = &mut ctx.accounts.protocol;
    protocol.total_supply = new_supply;

    emit!(Burned {
        user: ctx.accounts.user.key(),
        bullet_in: bullet_amount,
        ansem_out: user_out,
        fee,
        floor_after,
    });

    Ok(())
}
