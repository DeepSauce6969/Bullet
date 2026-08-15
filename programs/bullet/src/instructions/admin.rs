use crate::ix_accounts::{SetFeeRecipient, SetMaxSupply};
use crate::errors::BulletError;
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
    msg!("max_supply updated to {}", max_supply);
    Ok(())
}
