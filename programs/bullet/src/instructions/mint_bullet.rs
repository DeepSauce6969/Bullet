use crate::ix_accounts::MintBullet;
use crate::errors::BulletError;
use crate::events::Minted;
use crate::math;
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Transfer};
use anchor_spl::token_interface::{self, MintTo};

pub fn handler(ctx: Context<MintBullet>, ansem_amount: u64) -> Result<()> {
    require!(ctx.accounts.protocol.trading_enabled, BulletError::TradingDisabled);
    require!(ansem_amount > 0, BulletError::ZeroAmount);

    let protocol = &ctx.accounts.protocol;
    let vault_before = ctx.accounts.vault.amount;
    let backing_before = math::backing(vault_before, protocol.total_borrowed)?;
    let floor_before = math::floor_scaled(backing_before, protocol.total_supply)?;

    // Pull Ansem into vault.
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.user_ansem.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        ansem_amount,
    )?;

    let fee = math::protocol_fee(ansem_amount)?;
    let (pol, bribe) = math::split_fee(fee)?;
    // Route POL + bribe out of vault (backing share stays).
    route_fees(&ctx, pol, bribe)?;

    let vault_after_in = vault_before
        .checked_add(ansem_amount)
        .ok_or(BulletError::MathOverflow)?;
    // After fee routing, vault loses pol+bribe.
    let vault_after = vault_after_in
        .checked_sub(pol)
        .ok_or(BulletError::MathOverflow)?
        .checked_sub(bribe)
        .ok_or(BulletError::MathOverflow)?;

    // Curve uses backing after full deposit (before fee skim).
    let backing_for_curve = math::backing(vault_after_in, protocol.total_borrowed)?;
    let gross = math::ansem_to_bullet_gross(
        ansem_amount,
        protocol.total_supply,
        backing_for_curve,
    )?;
    let bullet_out = math::apply_out_fee(gross)?;

    let new_minted = protocol
        .total_minted
        .checked_add(bullet_out)
        .ok_or(BulletError::MathOverflow)?;
    require!(
        new_minted <= protocol.max_supply,
        BulletError::MaxSupplyExceeded
    );

    let new_supply = protocol
        .total_supply
        .checked_add(bullet_out)
        .ok_or(BulletError::MathOverflow)?;

    let backing_after = math::backing(vault_after, protocol.total_borrowed)?;
    let floor_after = math::floor_scaled(backing_after, new_supply)?;
    math::assert_floor_non_decreasing(floor_before, floor_after)?;

    let seeds: &[&[u8]] = &[Protocol::SEED, &[protocol.bump]];
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
        bullet_out,
    )?;

    let protocol = &mut ctx.accounts.protocol;
    protocol.total_minted = new_minted;
    protocol.total_supply = new_supply;

    emit!(Minted {
        user: ctx.accounts.user.key(),
        ansem_in: ansem_amount,
        bullet_out,
        fee,
        floor_after,
    });

    Ok(())
}

fn route_fees(ctx: &Context<MintBullet>, pol: u64, bribe: u64) -> Result<()> {
    let bump = ctx.accounts.protocol.bump;
    let seeds: &[&[u8]] = &[Protocol::SEED, &[bump]];
    let token_program = ctx.accounts.token_program.to_account_info();
    let vault = ctx.accounts.vault.to_account_info();
    let authority = ctx.accounts.protocol.to_account_info();

    if pol > 0 {
        token::transfer(
            CpiContext::new_with_signer(
                token_program.clone(),
                Transfer {
                    from: vault.clone(),
                    to: ctx.accounts.pol_vault.to_account_info(),
                    authority: authority.clone(),
                },
                &[seeds],
            ),
            pol,
        )?;
    }
    if bribe > 0 {
        token::transfer(
            CpiContext::new_with_signer(
                token_program,
                Transfer {
                    from: vault,
                    to: ctx.accounts.fee_recipient_ata.to_account_info(),
                    authority,
                },
                &[seeds],
            ),
            bribe,
        )?;
    }
    Ok(())
}
