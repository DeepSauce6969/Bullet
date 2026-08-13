use crate::ix_accounts::SetFeeRecipient;
use anchor_lang::prelude::*;

pub fn set_fee_recipient(ctx: Context<SetFeeRecipient>, fee_recipient: Pubkey) -> Result<()> {
    ctx.accounts.protocol.fee_recipient = fee_recipient;
    Ok(())
}
