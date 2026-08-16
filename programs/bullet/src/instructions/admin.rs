use crate::ix_accounts::{SetFeeRecipient, SetGenesisFeeBps, SetMaxSupply};
use crate::errors::BulletError;
use crate::state::BPS_DENOM;
use anchor_lang::prelude::*;

pub fn set_fee_recipient(ctx: Context<SetFeeRecipient>, fee_recipient: Pubkey) -> Result<()> {
    ctx.accounts.protocol.fee_recipient = fee_recipient;
    Ok(())
}

/// Authority-only: raise or lower the protocol max BULLET supply (raw units, 6 decimals).
pub fn set_max_supply(ctx: Context<SetMaxSupply>, max_supply: u64) -> Result<()> {
    require!(max_supply > 0, BulletError::ZeroAmount);
    require!(
        max_supply >= ctx.accounts.protocol.total_minted,
        BulletError::MaxSupplyExceeded
    );
    ctx.accounts.protocol.max_supply = max_supply;
    Ok(())
}

/// Authority-only: update a genesis vault's exit fee (0 / 250 / 350 bps target).
pub fn set_genesis_fee_bps(ctx: Context<SetGenesisFeeBps>, fee_bps: u16) -> Result<()> {
    require!((fee_bps as u64) <= BPS_DENOM, BulletError::InvalidFeeBps);
    ctx.accounts.genesis_vault.fee_bps = fee_bps;
    msg!(
        "genesis vault {} fee_bps -> {}",
        ctx.accounts.genesis_vault.key(),
        fee_bps
    );
    Ok(())
}
