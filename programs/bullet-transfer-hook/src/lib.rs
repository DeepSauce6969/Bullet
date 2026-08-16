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
        cfg.lifetime_volume = 0;
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
            false, // is_signer
            true,  // is_writable — volume + cached tax updates on DEX transfers
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

    /// Flip hook_config ExtraAccountMeta to writable (post-upgrade migration).
    pub fn update_extra_account_meta_list(
        ctx: Context<UpdateExtraAccountMetaList>,
    ) -> Result<()> {
        let account_metas = vec![ExtraAccountMeta::new_with_seeds(
            &[
                Seed::Literal {
                    bytes: HOOK_CONFIG_SEED.to_vec(),
                },
                Seed::AccountKey { index: 1 },
            ],
            false,
            true,
        )?];
        ExtraAccountMetaList::update::<ExecuteInstruction>(
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

    /// Update cached tax bps (clamp 4–8%). Still call mint `SetTransferFee` to apply.
    pub fn set_transfer_tax_bps(
        ctx: Context<SetTransferTaxBps>,
        transfer_tax_bps: u16,
    ) -> Result<()> {
        require!(
            (DEX_TAX_MIN_BPS..=DEX_TAX_MAX_BPS).contains(&transfer_tax_bps),
            HookError::InvalidBps
        );
        ctx.accounts.hook_config.transfer_tax_bps = transfer_tax_bps;
        Ok(())
    }

    /// Recompute cached tax from lifetime DEX volume (4–8% schedule).
    /// Permissionless — does not change the mint TransferFee by itself.
    /// Authority should follow with `SetTransferFee` (see scripts/sync-dex-tax.ts).
    pub fn refresh_tax_from_volume(ctx: Context<RefreshTaxFromVolume>) -> Result<()> {
        let cfg = &mut ctx.accounts.hook_config;
        let next = dex_tax_bps_from_volume(cfg.lifetime_volume);
        cfg.transfer_tax_bps = next;
        msg!(
            "dex tax → {} bps (lifetime_volume={})",
            next,
            cfg.lifetime_volume
        );
        Ok(())
    }

    /// One-time: grow HookConfig account for `lifetime_volume` field after program upgrade.
    pub fn migrate_config_layout(ctx: Context<MigrateConfigLayout>) -> Result<()> {
        let account = ctx.accounts.hook_config.to_account_info();
        let new_len = 8 + HookConfig::INIT_SPACE;
        require!(account.data_len() < new_len, HookError::AlreadyMigrated);

        // Verify authority (bytes 8..40 after Anchor discriminator).
        {
            let data = account.try_borrow_data()?;
            require!(data.len() >= 40, HookError::InvalidMint);
            let stored = Pubkey::new_from_array(data[8..40].try_into().unwrap());
            require_keys_eq!(stored, ctx.accounts.authority.key(), HookError::Unauthorized);
        }

        let rent = Rent::get()?;
        let need = rent.minimum_balance(new_len);
        let current = account.lamports();
        if need > current {
            let topup = need.saturating_sub(current);
            anchor_lang::system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    anchor_lang::system_program::Transfer {
                        from: ctx.accounts.authority.to_account_info(),
                        to: account.clone(),
                    },
                ),
                topup,
            )?;
        }
        account.realloc(new_len, true)?;
        Ok(())
    }

    /// Invoked by Token-2022 on every BULLET `Transfer` / `TransferChecked`.
    pub fn transfer_hook(ctx: Context<TransferHook>, amount: u64) -> Result<()> {
        let source = ctx.accounts.source_token.key();
        let dest = ctx.accounts.destination_token.key();
        let cfg = &mut ctx.accounts.hook_config;

        if cfg.is_exempt(source) || cfg.is_exempt(dest) {
            return Ok(());
        }

        if cfg.is_dex_pool(source) || cfg.is_dex_pool(dest) {
            cfg.lifetime_volume = cfg
                .lifetime_volume
                .checked_add(amount)
                .ok_or(HookError::MathOverflow)?;
            // Keep cached target in sync for indexers / sync scripts.
            cfg.transfer_tax_bps = dex_tax_bps_from_volume(cfg.lifetime_volume);
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
pub struct UpdateExtraAccountMetaList<'info> {
    pub authority: Signer<'info>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        seeds = [HOOK_CONFIG_SEED, mint.key().as_ref()],
        bump = hook_config.bump,
        has_one = authority @ HookError::Unauthorized,
        has_one = mint @ HookError::InvalidMint,
    )]
    pub hook_config: Account<'info, HookConfig>,

    /// CHECK: existing extra-account-metas PDA.
    #[account(
        mut,
        seeds = [EXTRA_ACCOUNT_METAS_SEED, mint.key().as_ref()],
        bump
    )]
    pub extra_account_meta_list: UncheckedAccount<'info>,
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

#[derive(Accounts)]
pub struct RefreshTaxFromVolume<'info> {
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [HOOK_CONFIG_SEED, mint.key().as_ref()],
        bump = hook_config.bump,
        has_one = mint @ HookError::InvalidMint,
    )]
    pub hook_config: Account<'info, HookConfig>,
}

#[derive(Accounts)]
pub struct MigrateConfigLayout<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    pub mint: InterfaceAccount<'info, Mint>,

    /// CHECK: realloc HookConfig PDA; authority must match stored authority after load.
    #[account(
        mut,
        seeds = [HOOK_CONFIG_SEED, mint.key().as_ref()],
        bump,
    )]
    pub hook_config: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
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
        mut,
        seeds = [HOOK_CONFIG_SEED, mint.key().as_ref()],
        bump = hook_config.bump,
        has_one = mint @ HookError::InvalidMint,
    )]
    pub hook_config: Account<'info, HookConfig>,
}

use spl_transfer_hook_interface::instruction::ExecuteInstruction;
