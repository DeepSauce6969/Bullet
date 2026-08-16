use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;
use spl_tlv_account_resolution::{
    account::ExtraAccountMeta,
    seeds::Seed,
    state::ExtraAccountMetaList,
};
use spl_transfer_hook_interface::instruction::TransferHookInstruction;

pub mod errors;
pub mod state;

use errors::HookError;
use state::*;

declare_id!("GJdqUFKpUHwLjVtcZMDnZDP5Mn8o9rsbiPLvUsg47BjY");

#[program]
pub mod bullet_transfer_hook {
    use super::*;

    /// Initialize hook config for a BULLET Token-2022 mint.
    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        transfer_tax_bps: u16,
    ) -> Result<()> {
        require!(transfer_tax_bps <= 10_000, HookError::InvalidBps);
        let cfg = &mut ctx.accounts.hook_config;
        cfg.authority = ctx.accounts.authority.key();
        cfg.mint = ctx.accounts.mint.key();
        cfg.transfer_tax_bps = transfer_tax_bps;
        cfg.dex_pool_count = 0;
        cfg.exempt_count = 0;
        cfg.bump = ctx.bumps.hook_config;
        cfg.padding = [0u8; 3];
        cfg.dex_pools = [Pubkey::default(); MAX_DEX_POOLS];
        cfg.exempt_accounts = [Pubkey::default(); MAX_EXEMPT_ACCOUNTS];
        Ok(())
    }

    /// Stores extra accounts required on every BULLET transfer (hook config PDA).
    pub fn initialize_extra_account_meta_list(ctx: Context<InitExtraAccountMetaList>) -> Result<()> {
        let account_metas = vec![ExtraAccountMeta::new_with_seeds(
            &[
                Seed::Literal {
                    bytes: HOOK_CONFIG_SEED.to_vec(),
                },
                Seed::AccountKey { index: 1 },
            ],
            false,
            false,
        )?];

        let account_size = ExtraAccountMetaList::size_of(account_metas.len())? as usize;
        let lamports = Rent::get()?.minimum_balance(account_size);

        let mint = ctx.accounts.mint.key();
        let signer_seeds: &[&[&[u8]]] = &[&[
            EXTRA_ACCOUNT_METAS_SEED,
            mint.as_ref(),
            &[ctx.bumps.extra_account_meta_list],
        ]];

        anchor_lang::system_program::create_account(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::CreateAccount {
                    from: ctx.accounts.payer.to_account_info(),
                    to: ctx.accounts.extra_account_meta_list.to_account_info(),
                },
            )
            .with_signer(signer_seeds),
            lamports,
            account_size as u64,
            ctx.program_id,
        )?;

        ExtraAccountMetaList::init::<ExecuteInstruction>(
            &mut ctx.accounts.extra_account_meta_list.try_borrow_mut_data()?,
            &account_metas,
        )?;
        Ok(())
    }

    /// Register a DEX pool BULLET token account (source or destination in swaps).
    pub fn register_dex_pool(ctx: Context<RegisterDexPool>) -> Result<()> {
        ctx.accounts
            .hook_config
            .add_dex_pool(ctx.accounts.pool_token_account.key())
    }

    pub fn unregister_dex_pool(ctx: Context<UnregisterDexPool>) -> Result<()> {
        ctx.accounts
            .hook_config
            .remove_dex_pool(ctx.accounts.pool_token_account.key())
    }

    /// Exempt a token account from the DEX-only gate (protocol vaults).
    pub fn register_exempt_account(ctx: Context<RegisterExempt>) -> Result<()> {
        ctx.accounts
            .hook_config
            .add_exempt(ctx.accounts.token_account.key())
    }

    pub fn unregister_exempt_account(ctx: Context<UnregisterExempt>) -> Result<()> {
        ctx.accounts
            .hook_config
            .remove_exempt(ctx.accounts.token_account.key())
    }

    /// Update cached tax bps (mirror of mint TransferFee; use `set_transfer_fee` on mint to apply).
    pub fn set_transfer_tax_bps(
        ctx: Context<SetTransferTaxBps>,
        transfer_tax_bps: u16,
    ) -> Result<()> {
        require!(transfer_tax_bps <= 10_000, HookError::InvalidBps);
        ctx.accounts.hook_config.transfer_tax_bps = transfer_tax_bps;
        Ok(())
    }

    /// Invoked by Token-2022 on every BULLET `Transfer` / `TransferChecked`.
    pub fn transfer_hook(ctx: Context<TransferHook>, _amount: u64) -> Result<()> {
        let cfg = &ctx.accounts.hook_config;
        let source = ctx.accounts.source_token.key();
        let dest = ctx.accounts.destination_token.key();

        if cfg.is_exempt(source) || cfg.is_exempt(dest) {
            return Ok(());
        }

        if cfg.is_dex_pool(source) || cfg.is_dex_pool(dest) {
            return Ok(());
        }

        err!(HookError::TransferNotAllowed)
    }

    /// Route Token-2022 `Execute` CPI (discriminator does not match Anchor's default).
    pub fn fallback<'info>(
        program_id: &Pubkey,
        accounts: &'info [AccountInfo<'info>],
        data: &[u8],
    ) -> Result<()> {
        if let Ok(TransferHookInstruction::Execute { amount }) =
            TransferHookInstruction::unpack(data)
        {
            let amount_bytes = amount.to_le_bytes();
            __private::__global::transfer_hook(program_id, accounts, &amount_bytes)
        } else {
            err!(HookError::InvalidInstruction)
        }
    }
}

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = authority,
        space = 8 + HookConfig::INIT_SPACE,
        seeds = [HOOK_CONFIG_SEED, mint.key().as_ref()],
        bump
    )]
    pub hook_config: Account<'info, HookConfig>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitExtraAccountMetaList<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    pub mint: InterfaceAccount<'info, Mint>,

    /// CHECK: extra-account-metas PDA defined by the transfer-hook interface.
    #[account(
        mut,
        seeds = [EXTRA_ACCOUNT_METAS_SEED, mint.key().as_ref()],
        bump
    )]
    pub extra_account_meta_list: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RegisterDexPool<'info> {
    pub authority: Signer<'info>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [HOOK_CONFIG_SEED, mint.key().as_ref()],
        bump = hook_config.bump,
        has_one = authority @ HookError::Unauthorized,
        has_one = mint @ HookError::InvalidMint,
    )]
    pub hook_config: Account<'info, HookConfig>,

    /// CHECK: DEX pool BULLET token account pubkey stored in config.
    pub pool_token_account: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct UnregisterDexPool<'info> {
    pub authority: Signer<'info>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [HOOK_CONFIG_SEED, mint.key().as_ref()],
        bump = hook_config.bump,
        has_one = authority @ HookError::Unauthorized,
    )]
    pub hook_config: Account<'info, HookConfig>,

    /// CHECK: pool token account to remove.
    pub pool_token_account: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct RegisterExempt<'info> {
    pub authority: Signer<'info>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [HOOK_CONFIG_SEED, mint.key().as_ref()],
        bump = hook_config.bump,
        has_one = authority @ HookError::Unauthorized,
        has_one = mint @ HookError::InvalidMint,
    )]
    pub hook_config: Account<'info, HookConfig>,

    /// CHECK: token account pubkey to exempt.
    pub token_account: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct UnregisterExempt<'info> {
    pub authority: Signer<'info>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [HOOK_CONFIG_SEED, mint.key().as_ref()],
        bump = hook_config.bump,
        has_one = authority @ HookError::Unauthorized,
    )]
    pub hook_config: Account<'info, HookConfig>,

    /// CHECK: token account to remove from exempt list.
    pub token_account: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct SetTransferTaxBps<'info> {
    pub authority: Signer<'info>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [HOOK_CONFIG_SEED, mint.key().as_ref()],
        bump = hook_config.bump,
        has_one = authority @ HookError::Unauthorized,
        has_one = mint @ HookError::InvalidMint,
    )]
    pub hook_config: Account<'info, HookConfig>,
}

/// Token-2022 transfer hook `Execute` accounts (plus hook config from extra meta list).
#[derive(Accounts)]
pub struct TransferHook<'info> {
    /// CHECK: source token account in Token-2022 CPI.
    pub source_token: UncheckedAccount<'info>,

    /// CHECK: mint in Token-2022 CPI.
    pub mint: UncheckedAccount<'info>,

    /// CHECK: destination token account in Token-2022 CPI.
    pub destination_token: UncheckedAccount<'info>,

    /// CHECK: source token account owner.
    pub owner: UncheckedAccount<'info>,

    /// CHECK: extra-account-metas PDA.
    pub extra_account_meta_list: UncheckedAccount<'info>,

    #[account(
        seeds = [HOOK_CONFIG_SEED, mint.key().as_ref()],
        bump = hook_config.bump,
        has_one = mint @ HookError::InvalidMint,
    )]
    pub hook_config: Account<'info, HookConfig>,
}

use spl_transfer_hook_interface::instruction::ExecuteInstruction;
