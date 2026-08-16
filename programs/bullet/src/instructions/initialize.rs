use crate::ix_accounts::Initialize;
use crate::errors::BulletError;
use crate::state::*;
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<Initialize>, max_supply: u64, fee_recipient: Pubkey) -> Result<()> {
    require!(max_supply > 0, BulletError::ZeroAmount);

    let protocol = &mut ctx.accounts.protocol;
    protocol.authority = ctx.accounts.authority.key();
    protocol.bullet_mint = ctx.accounts.bullet_mint.key();
    protocol.ansem_mint = ctx.accounts.ansem_mint.key();
    protocol.vault = ctx.accounts.vault.key();
    protocol.pol_vault = ctx.accounts.pol_vault.key();
    protocol.fee_recipient = fee_recipient;
    protocol.collateral_vault = ctx.accounts.collateral_vault.key();
    protocol.bump = ctx.bumps.protocol;
    protocol.mint_bump = ctx.bumps.bullet_mint;
    protocol.total_minted = 0;
    protocol.max_supply = max_supply;
    protocol.total_borrowed = 0;
    protocol.total_supply = 0;
    protocol.loan_count = 0;
    protocol.trading_enabled = true;
    protocol.padding = [0u8; 32];

    msg!(
        "Bullet initialized | max_supply={} | backing_mint={}",
        max_supply,
        ctx.accounts.ansem_mint.key()
    );
    Ok(())
}
