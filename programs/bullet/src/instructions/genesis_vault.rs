use crate::errors::BulletError;
use crate::events::{
    GenesisClaimed, GenesisDeposited, GenesisFinalized, GenesisWithdrawn,
};
use crate::ix_accounts::{
    ClaimGenesis, DepositGenesis, FinalizeGenesis, InitGenesisVault, WithdrawGenesis,
};
use crate::math;
use crate::state::*;
use crate::token2022_mint;
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Transfer};
use anchor_spl::token_interface::{self, Burn, MintTo};

pub fn init_genesis_vault(
    ctx: Context<InitGenesisVault>,
    tier: u8,
    fee_bps: u16,
    deposit_cap: u64,
    max_allocation: u64,
) -> Result<()> {
    require!(tier <= 2, BulletError::InvalidTier);
    require!(fee_bps <= 10_000, BulletError::MathOverflow);
    require!(deposit_cap > 0, BulletError::ZeroAmount);
    require!(max_allocation > 0, BulletError::ZeroAmount);

    let bullet_vault_bump = ctx.bumps.bullet_vault;
    let tier_seed = [tier];
    let bullet_vault_seeds: &[&[u8]] = &[GenesisVault::BULLET_SEED, &tier_seed, &[bullet_vault_bump]];

    token2022_mint::create_bullet_token_account(
        &ctx.accounts.authority.to_account_info(),
        &ctx.accounts.bullet_vault.to_account_info(),
        &ctx.accounts.bullet_mint.to_account_info(),
        &ctx.accounts.genesis_vault.key(),
        bullet_vault_seeds,
        &ctx.accounts.system_program.to_account_info(),
        &ctx.accounts.bullet_token_program.to_account_info(),
    )?;

    let vault = &mut ctx.accounts.genesis_vault;
    vault.protocol = ctx.accounts.protocol.key();
    vault.ansem_mint = ctx.accounts.ansem_mint.key();
    vault.token_vault = ctx.accounts.token_vault.key();
    vault.bullet_vault = ctx.accounts.bullet_vault.key();
    vault.fee_bps = fee_bps;
    vault.deposit_cap = deposit_cap;
    vault.max_allocation = max_allocation;
    vault.total_raised = 0;
    vault.total_bullet = 0;
    vault.tier = tier;
    vault.bump = ctx.bumps.genesis_vault;
    vault.token_vault_bump = ctx.bumps.token_vault;
    vault.bullet_vault_bump = ctx.bumps.bullet_vault;
    vault.presale_active = true;
    vault.is_finalized = false;
    vault.padding = [0u8; 32];
    Ok(())
}

pub fn deposit(ctx: Context<DepositGenesis>, amount: u64) -> Result<()> {
    require!(amount > 0, BulletError::ZeroAmount);

    let vault = &ctx.accounts.genesis_vault;
    let deposit_acc = &ctx.accounts.user_deposit;

    let new_user_total = deposit_acc
        .amount
        .checked_add(amount)
        .ok_or(BulletError::MathOverflow)?;
    require!(
        new_user_total <= vault.max_allocation,
        BulletError::AllocationExceeded
    );

    let new_raised = vault
        .total_raised
        .checked_add(amount)
        .ok_or(BulletError::MathOverflow)?;
    require!(new_raised <= vault.deposit_cap, BulletError::DepositCapExceeded);

    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.user_ansem.to_account_info(),
                to: ctx.accounts.token_vault.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        amount,
    )?;

    let deposit_acc = &mut ctx.accounts.user_deposit;
    if deposit_acc.user == Pubkey::default() {
        deposit_acc.vault = ctx.accounts.genesis_vault.key();
        deposit_acc.user = ctx.accounts.user.key();
        deposit_acc.claimed = false;
        deposit_acc.bump = ctx.bumps.user_deposit;
        deposit_acc.padding = [0u8; 16];
    }
    deposit_acc.amount = new_user_total;

    let vault = &mut ctx.accounts.genesis_vault;
    vault.total_raised = new_raised;

    emit!(GenesisDeposited {
        vault: vault.key(),
        user: ctx.accounts.user.key(),
        amount,
        total_raised: new_raised,
    });
    Ok(())
}

pub fn withdraw(ctx: Context<WithdrawGenesis>) -> Result<()> {
    let amount = ctx.accounts.user_deposit.amount;
    require!(amount > 0, BulletError::NoDeposit);

    let tier = ctx.accounts.genesis_vault.tier;
    let bump = ctx.accounts.genesis_vault.bump;
    let seeds: &[&[u8]] = &[GenesisVault::SEED, &[tier], &[bump]];

    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.token_vault.to_account_info(),
                to: ctx.accounts.user_ansem.to_account_info(),
                authority: ctx.accounts.genesis_vault.to_account_info(),
            },
            &[seeds],
        ),
        amount,
    )?;

    let vault = &mut ctx.accounts.genesis_vault;
    vault.total_raised = vault
        .total_raised
        .checked_sub(amount)
        .ok_or(BulletError::MathOverflow)?;

    emit!(GenesisWithdrawn {
        vault: vault.key(),
        user: ctx.accounts.user.key(),
        amount,
    });
    Ok(())
}

/// Move net ANSEM into protocol vault, mint BULLET into genesis bullet vault (no 2.5% out-fee).
pub fn finalize(ctx: Context<FinalizeGenesis>) -> Result<()> {
    let raised = ctx.accounts.genesis_vault.total_raised;
    require!(raised > 0, BulletError::ZeroAmount);

    let fee_bps = ctx.accounts.genesis_vault.fee_bps as u64;
    let fee = raised
        .checked_mul(fee_bps)
        .ok_or(BulletError::MathOverflow)?
        .checked_div(BPS_DENOM)
        .ok_or(BulletError::DivisionByZero)?;
    let net = raised.checked_sub(fee).ok_or(BulletError::MathOverflow)?;

    // Snapshot protocol vault balance before moving net ANSEM in.
    let vault_before = ctx.accounts.vault.amount;
    let protocol_bump = ctx.accounts.protocol.bump;
    let protocol_total_borrowed = ctx.accounts.protocol.total_borrowed;
    let protocol_total_supply = ctx.accounts.protocol.total_supply;
    let protocol_total_minted = ctx.accounts.protocol.total_minted;
    let protocol_max_supply = ctx.accounts.protocol.max_supply;

    let tier = ctx.accounts.genesis_vault.tier;
    let gv_bump = ctx.accounts.genesis_vault.bump;
    let gv_seeds: &[&[u8]] = &[GenesisVault::SEED, &[tier], &[gv_bump]];

    // Tier fee → fee recipient
    if fee > 0 {
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.token_vault.to_account_info(),
                    to: ctx.accounts.fee_recipient_ata.to_account_info(),
                    authority: ctx.accounts.genesis_vault.to_account_info(),
                },
                &[gv_seeds],
            ),
            fee,
        )?;
    }

    // Net ANSEM → protocol backing vault
    if net > 0 {
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.token_vault.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.genesis_vault.to_account_info(),
                },
                &[gv_seeds],
            ),
            net,
        )?;
    }

    let vault_after_in = vault_before
        .checked_add(net)
        .ok_or(BulletError::MathOverflow)?;
    let backing_for_curve = math::backing(vault_after_in, protocol_total_borrowed)?;
    // Presale mint: no 2.5% out-fee (tier fee already taken)
    let bullet_out =
        math::ansem_to_bullet_gross(net, protocol_total_supply, backing_for_curve)?;

    let new_minted = protocol_total_minted
        .checked_add(bullet_out)
        .ok_or(BulletError::MathOverflow)?;
    require!(
        new_minted <= protocol_max_supply,
        BulletError::MaxSupplyExceeded
    );
    let new_supply = protocol_total_supply
        .checked_add(bullet_out)
        .ok_or(BulletError::MathOverflow)?;

    let floor_before = math::floor_scaled(
        math::backing(vault_before, protocol_total_borrowed)?,
        protocol_total_supply,
    )?;
    let floor_after = math::floor_scaled(
        math::backing(vault_after_in, protocol_total_borrowed)?,
        new_supply,
    )?;
    math::assert_floor_non_decreasing(floor_before, floor_after)?;

    let protocol_seeds: &[&[u8]] = &[Protocol::SEED, &[protocol_bump]];
    token_interface::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.bullet_token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.bullet_mint.to_account_info(),
                to: ctx.accounts.bullet_vault.to_account_info(),
                authority: ctx.accounts.protocol.to_account_info(),
            },
            &[protocol_seeds],
        ),
        bullet_out,
    )?;

    let protocol = &mut ctx.accounts.protocol;
    protocol.total_minted = new_minted;
    protocol.total_supply = new_supply;

    let gv = &mut ctx.accounts.genesis_vault;
    gv.total_bullet = bullet_out;
    gv.is_finalized = true;
    gv.presale_active = false;

    emit!(GenesisFinalized {
        vault: gv.key(),
        ansem_net: net,
        fee,
        bullet_minted: bullet_out,
    });
    Ok(())
}

pub fn claim(ctx: Context<ClaimGenesis>) -> Result<()> {
    let deposit_amt = ctx.accounts.user_deposit.amount;
    let total_raised = ctx.accounts.genesis_vault.total_raised;
    let total_bullet = ctx.accounts.genesis_vault.total_bullet;
    require!(total_raised > 0, BulletError::DivisionByZero);

    let bullet_out = (deposit_amt as u128)
        .checked_mul(total_bullet as u128)
        .ok_or(BulletError::MathOverflow)?
        .checked_div(total_raised as u128)
        .ok_or(BulletError::DivisionByZero)? as u64;
    require!(bullet_out > 0, BulletError::ZeroAmount);

    let tier = ctx.accounts.genesis_vault.tier;
    let bump = ctx.accounts.genesis_vault.bump;
    let seeds: &[&[u8]] = &[GenesisVault::SEED, &[tier], &[bump]];

    token_interface::burn(
        CpiContext::new_with_signer(
            ctx.accounts.bullet_token_program.to_account_info(),
            Burn {
                mint: ctx.accounts.bullet_mint.to_account_info(),
                from: ctx.accounts.bullet_vault.to_account_info(),
                authority: ctx.accounts.genesis_vault.to_account_info(),
            },
            &[seeds],
        ),
        bullet_out,
    )?;
    token_interface::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.bullet_token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.bullet_mint.to_account_info(),
                to: ctx.accounts.user_bullet.to_account_info(),
                authority: ctx.accounts.protocol.to_account_info(),
            },
            &[&[Protocol::SEED, &[ctx.accounts.protocol.bump]]],
        ),
        bullet_out,
    )?;

    ctx.accounts.user_deposit.claimed = true;

    emit!(GenesisClaimed {
        vault: ctx.accounts.genesis_vault.key(),
        user: ctx.accounts.user.key(),
        bullet_out,
    });
    Ok(())
}
