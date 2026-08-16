use crate::ix_accounts::Initialize;
use crate::errors::BulletError;
use crate::state::*;
use crate::token2022_mint;
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<Initialize>, max_supply: u64, fee_recipient: Pubkey) -> Result<()> {
    require!(max_supply > 0, BulletError::ZeroAmount);

    let mint_bump = ctx.bumps.bullet_mint;
    let protocol_bump = ctx.bumps.protocol;
    let collateral_bump = ctx.bumps.collateral_vault;

    token2022_mint::create_bullet_mint(
        &ctx.accounts.authority.to_account_info(),
        &ctx.accounts.bullet_mint.to_account_info(),
        &ctx.accounts.protocol.to_account_info(),
        mint_bump,
        protocol_bump,
        ctx.accounts.transfer_hook_program.key,
        ctx.accounts.authority.key,
        DEFAULT_DEX_TRANSFER_TAX_BPS,
        &ctx.accounts.system_program.to_account_info(),
        &ctx.accounts.token_2022_program.to_account_info(),
        &ctx.accounts.rent.to_account_info(),
    )?;

    token2022_mint::create_collateral_vault(
        &ctx.accounts.authority.to_account_info(),
        &ctx.accounts.collateral_vault.to_account_info(),
        &ctx.accounts.bullet_mint.to_account_info(),
        &ctx.accounts.protocol.to_account_info(),
        collateral_bump,
        protocol_bump,
        &ctx.accounts.system_program.to_account_info(),
        &ctx.accounts.token_2022_program.to_account_info(),
    )?;

    let protocol = &mut ctx.accounts.protocol;
    protocol.authority = ctx.accounts.authority.key();
    protocol.bullet_mint = ctx.accounts.bullet_mint.key();
    protocol.ansem_mint = ctx.accounts.ansem_mint.key();
    protocol.vault = ctx.accounts.vault.key();
    protocol.pol_vault = ctx.accounts.pol_vault.key();
    protocol.fee_recipient = fee_recipient;
    protocol.collateral_vault = ctx.accounts.collateral_vault.key();
    protocol.bump = protocol_bump;
    protocol.mint_bump = mint_bump;
    protocol.total_minted = 0;
    protocol.max_supply = max_supply;
    protocol.total_borrowed = 0;
    protocol.total_supply = 0;
    protocol.loan_count = 0;
    protocol.trading_enabled = true;
    protocol.padding = [0u8; 32];

    msg!(
        "Bullet initialized | max_supply={} | backing_mint={} | dex_tax_bps={}",
        max_supply,
        ctx.accounts.ansem_mint.key(),
        DEFAULT_DEX_TRANSFER_TAX_BPS,
    );
    Ok(())
}
