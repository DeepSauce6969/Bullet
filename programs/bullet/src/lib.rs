use anchor_lang::prelude::*;

pub mod ix_accounts;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod math;
pub mod state;

pub use ix_accounts::*;

declare_id!("4PTGwC7KTRZhjhKgXXrD9WTRyoCb8cpKWy6HAsaMXvBj");

/// Bullet protocol — Ansem-backed up-only floor token.
/// Up-only floor mechanics without Uniswap v4 hooks:
/// mint / burn / borrow / repay / leverage / liquidate.
#[program]
pub mod bullet {
    use super::*;

    pub fn initialize(
        ctx: Context<Initialize>,
        max_supply: u64,
        fee_recipient: Pubkey,
    ) -> Result<()> {
        instructions::initialize::handler(ctx, max_supply, fee_recipient)
    }

    /// Deposit Ansem → mint BULLET (protocol buy).
    pub fn mint_bullet(ctx: Context<MintBullet>, ansem_amount: u64) -> Result<()> {
        instructions::mint_bullet::handler(ctx, ansem_amount)
    }

    /// Burn BULLET → redeem Ansem (protocol sell).
    pub fn burn_bullet(ctx: Context<BurnBullet>, bullet_amount: u64) -> Result<()> {
        instructions::burn_bullet::handler(ctx, bullet_amount)
    }

    /// Borrow Ansem against BULLET collateral (~99% LTV). Interest paid upfront.
    pub fn borrow(
        ctx: Context<Borrow>,
        ansem_amount: u64,
        number_of_days: u16,
    ) -> Result<()> {
        instructions::borrow::handler(ctx, ansem_amount, number_of_days)
    }

    /// Repay loan principal and reclaim BULLET collateral.
    pub fn repay(ctx: Context<Repay>) -> Result<()> {
        instructions::repay::handler(ctx)
    }

    /// One-click leveraged BULLET exposure (leverage loop).
    pub fn leverage(
        ctx: Context<Leverage>,
        ansem_amount: u64,
        number_of_days: u16,
    ) -> Result<()> {
        instructions::leverage::handler(ctx, ansem_amount, number_of_days)
    }

    /// Liquidate an expired loan: burn collateral, keep borrowed Ansem in backing math.
    pub fn liquidate(ctx: Context<Liquidate>) -> Result<()> {
        instructions::liquidate::handler(ctx)
    }

    /// Update fee recipient (bribes wallet). Authority only.
    pub fn set_fee_recipient(ctx: Context<SetFeeRecipient>, fee_recipient: Pubkey) -> Result<()> {
        instructions::admin::set_fee_recipient(ctx, fee_recipient)
    }

    /// Initialize a genesis pre-deposit vault tier (0=VIP, 1=Community, 2=Public).
    pub fn init_genesis_vault(
        ctx: Context<InitGenesisVault>,
        tier: u8,
        fee_bps: u16,
        deposit_cap: u64,
        max_allocation: u64,
    ) -> Result<()> {
        instructions::genesis_vault::init_genesis_vault(
            ctx,
            tier,
            fee_bps,
            deposit_cap,
            max_allocation,
        )
    }

    /// Deposit ANSEM into a live genesis vault.
    pub fn deposit_genesis(ctx: Context<DepositGenesis>, amount: u64) -> Result<()> {
        instructions::genesis_vault::deposit(ctx, amount)
    }

    /// Withdraw ANSEM before finalize (closes user deposit account).
    pub fn withdraw_genesis(ctx: Context<WithdrawGenesis>) -> Result<()> {
        instructions::genesis_vault::withdraw(ctx)
    }

    /// Finalize vault: skim tier fee, mint BULLET into vault for claims.
    pub fn finalize_genesis(ctx: Context<FinalizeGenesis>) -> Result<()> {
        instructions::genesis_vault::finalize(ctx)
    }

    /// Claim pro-rata BULLET after finalize.
    pub fn claim_genesis(ctx: Context<ClaimGenesis>) -> Result<()> {
        instructions::genesis_vault::claim(ctx)
    }
}
