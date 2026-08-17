use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_spl::token_interface::Mint;
use spl_tlv_account_resolution::{
    account::ExtraAccountMeta,
    seeds::Seed,
    state::ExtraAccountMetaList,
};
use spl_token_2022::extension::{
    transfer_fee::{instruction::withdraw_withheld_tokens_from_accounts, TransferFeeAmount},
    BaseStateWithExtensions, StateWithExtensions,
};
use spl_token_2022::instruction::{approve_checked, revoke};
use spl_token_2022::state::Account as TokenAccount;
use spl_transfer_hook_interface::instruction::TransferHookInstruction;

pub mod errors;
pub mod state;

use errors::HookError;
use state::*;

declare_id!("GJdqUFKpUHwLjVtcZMDnZDP5Mn8o9rsbiPLvUsg47BjY");

fn extra_metas() -> Result<Vec<ExtraAccountMeta>> {
    // Only hook_config needed on Execute; settle runs as a separate ix.
    Ok(vec![ExtraAccountMeta::new_with_seeds(
        &[
            Seed::Literal {
                bytes: HOOK_CONFIG_SEED.to_vec(),
            },
            Seed::AccountKey { index: 1 },
        ],
        false,
        true,
    )?])
}

fn token_amount(ai: &AccountInfo) -> Result<u64> {
    let data = ai.try_borrow_data()?;
    require!(data.len() >= 72, HookError::InvalidMint);
    Ok(u64::from_le_bytes(
        data[64..72]
            .try_into()
            .map_err(|_| HookError::InvalidMint)?,
    ))
}

fn withheld_of(ai: &AccountInfo) -> Result<u64> {
    let data = ai.try_borrow_data()?;
    let state =
        StateWithExtensions::<TokenAccount>::unpack(&data).map_err(|_| HookError::InvalidMint)?;
    match state.get_extension::<TransferFeeAmount>() {
        Ok(ext) => Ok(u64::from(ext.withheld_amount)),
        Err(_) =>     Ok(0),
    }
}

fn harvest_withheld_to_vault<'info>(
    mint: &Pubkey,
    mint_ai: AccountInfo<'info>,
    fee_vault: AccountInfo<'info>,
    withdraw_auth: AccountInfo<'info>,
    dest: AccountInfo<'info>,
    token_program: AccountInfo<'info>,
    signer: &[&[&[u8]]],
) -> Result<()> {
    let withheld = withheld_of(&dest)?;
    if withheld == 0 {
        return Ok(());
    }
    let dest_key = *dest.key;
    let wix = withdraw_withheld_tokens_from_accounts(
        &spl_token_2022::ID,
        mint,
        fee_vault.key,
        withdraw_auth.key,
        &[],
        &[&dest_key],
    )
    .map_err(|_| HookError::InvalidInstruction)?;
    invoke_signed(
        &wix,
        &[mint_ai, fee_vault, withdraw_auth, dest, token_program],
        signer,
    )?;
    Ok(())
}

#[program]
pub mod bullet_transfer_hook {
    use super::*;

    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        transfer_tax_bps: u16,
    ) -> Result<()> {
        require!(
            (DEX_TAX_MIN_BPS..=DEX_TAX_MAX_BPS).contains(&transfer_tax_bps),
            HookError::InvalidBps
        );
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
        cfg.pending_refund_dest = Pubkey::default();
        cfg.pending_refund_amount = 0;
        Ok(())
    }

    pub fn initialize_extra_account_meta_list(
        ctx: Context<InitExtraAccountMetaList>,
    ) -> Result<()> {
        let account_metas = extra_metas()?;
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

    pub fn update_extra_account_meta_list(
        ctx: Context<UpdateExtraAccountMetaList>,
    ) -> Result<()> {
        let account_metas = extra_metas()?;
        ExtraAccountMetaList::update::<ExecuteInstruction>(
            &mut ctx.accounts.extra_account_meta_list.try_borrow_mut_data()?,
            &account_metas,
        )?;
        Ok(())
    }

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

    /// Grow HookConfig for new fields (lifetime_volume + pending refund).
    pub fn migrate_config_layout(ctx: Context<MigrateConfigLayout>) -> Result<()> {
        let account = ctx.accounts.hook_config.to_account_info();
        let new_len = 8 + HookConfig::INIT_SPACE;
        require!(account.data_len() < new_len, HookError::AlreadyMigrated);
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
            anchor_lang::system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    anchor_lang::system_program::Transfer {
                        from: ctx.accounts.authority.to_account_info(),
                        to: account.clone(),
                    },
                ),
                need.saturating_sub(current),
            )?;
        }
        account.realloc(new_len, true)?;
        Ok(())
    }

    /// Prepare a size/LP refund: harvest withheld 8% into the fee vault and
    /// approve `refund_authority` to send the gross-up refund as a *top-level*
    /// Token-2022 transfer. CPI from this program into Token-2022 TransferChecked
    /// is forbidden (re-enters the hook). Router must follow with:
    ///   transfer_checked_with_hook(fee_vault → dest) then `finish_dex_tax_refund`.
    pub fn settle_dex_tax_refund(ctx: Context<SettleDexTaxRefund>) -> Result<()> {
        let dest = ctx.accounts.destination_token.key();
        let refund_net = {
            let cfg = &ctx.accounts.hook_config;
            require!(
                cfg.pending_refund_dest == dest && cfg.pending_refund_amount > 0,
                HookError::NoPendingRefund
            );
            cfg.pending_refund_amount
        };

        let mint = ctx.accounts.mint.key();
        let withdraw_auth = ctx.accounts.withdraw_auth.key();
        let (expected, bump) =
            Pubkey::find_program_address(&[WITHDRAW_AUTH_SEED, mint.as_ref()], ctx.program_id);
        require_keys_eq!(withdraw_auth, expected, HookError::Unauthorized);
        let seeds: &[&[u8]] = &[WITHDRAW_AUTH_SEED, mint.as_ref(), &[bump]];
        let signer: &[&[&[u8]]] = &[seeds];

        harvest_withheld_to_vault(
            &mint,
            ctx.accounts.mint.to_account_info(),
            ctx.accounts.fee_vault.to_account_info(),
            ctx.accounts.withdraw_auth.to_account_info(),
            ctx.accounts.destination_token.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
            signer,
        )?;

        let denom = (10_000u128).saturating_sub(DEX_TAX_MAX_BPS as u128);
        let gross = (refund_net as u128)
            .checked_mul(10_000)
            .ok_or(HookError::MathOverflow)?
            .checked_add(denom - 1)
            .ok_or(HookError::MathOverflow)?
            .checked_div(denom)
            .ok_or(HookError::MathOverflow)?;
        let gross = u64::try_from(gross).map_err(|_| HookError::MathOverflow)?;

        let aix = approve_checked(
            &spl_token_2022::ID,
            &ctx.accounts.fee_vault.key(),
            &mint,
            &ctx.accounts.refund_authority.key(),
            &withdraw_auth,
            &[],
            gross,
            6,
        )
        .map_err(|_| HookError::InvalidInstruction)?;
        invoke_signed(
            &aix,
            &[
                ctx.accounts.fee_vault.to_account_info(),
                ctx.accounts.mint.to_account_info(),
                ctx.accounts.refund_authority.to_account_info(),
                ctx.accounts.withdraw_auth.to_account_info(),
                ctx.accounts.token_program.to_account_info(),
            ],
            signer,
        )?;

        msg!("prepared dex tax refund net={} gross={}", refund_net, gross);
        Ok(())
    }

    /// After the top-level refund transfer: harvest withheld-on-refund, revoke
    /// the fee-vault delegate, clear the pending slot.
    pub fn finish_dex_tax_refund(ctx: Context<SettleDexTaxRefund>) -> Result<()> {
        let dest = ctx.accounts.destination_token.key();
        {
            let cfg = &mut ctx.accounts.hook_config;
            require!(
                cfg.pending_refund_dest == dest && cfg.pending_refund_amount > 0,
                HookError::NoPendingRefund
            );
            cfg.pending_refund_dest = Pubkey::default();
            cfg.pending_refund_amount = 0;
        }

        let mint = ctx.accounts.mint.key();
        let withdraw_auth = ctx.accounts.withdraw_auth.key();
        let (expected, bump) =
            Pubkey::find_program_address(&[WITHDRAW_AUTH_SEED, mint.as_ref()], ctx.program_id);
        require_keys_eq!(withdraw_auth, expected, HookError::Unauthorized);
        let seeds: &[&[u8]] = &[WITHDRAW_AUTH_SEED, mint.as_ref(), &[bump]];
        let signer: &[&[&[u8]]] = &[seeds];

        harvest_withheld_to_vault(
            &mint,
            ctx.accounts.mint.to_account_info(),
            ctx.accounts.fee_vault.to_account_info(),
            ctx.accounts.withdraw_auth.to_account_info(),
            ctx.accounts.destination_token.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
            signer,
        )?;

        let rix = revoke(
            &spl_token_2022::ID,
            &ctx.accounts.fee_vault.key(),
            &withdraw_auth,
            &[],
        )
        .map_err(|_| HookError::InvalidInstruction)?;
        invoke_signed(
            &rix,
            &[
                ctx.accounts.fee_vault.to_account_info(),
                ctx.accounts.withdraw_auth.to_account_info(),
                ctx.accounts.token_program.to_account_info(),
            ],
            signer,
        )?;

        msg!("finished dex tax refund");
        Ok(())
    }

    pub fn transfer_hook(ctx: Context<TransferHook>, amount: u64) -> Result<()> {
        let source = ctx.accounts.source_token.key();
        let dest = ctx.accounts.destination_token.key();
        let cfg = &mut ctx.accounts.hook_config;

        if cfg.is_exempt(source) || cfg.is_exempt(dest) {
            return Ok(());
        }
        require!(
            cfg.is_dex_pool(source) || cfg.is_dex_pool(dest),
            HookError::TransferNotAllowed
        );

        let pool_is_source = cfg.is_dex_pool(source);
        let pool_ai = if pool_is_source {
            ctx.accounts.source_token.to_account_info()
        } else {
            ctx.accounts.destination_token.to_account_info()
        };
        let pool_bal = token_amount(&pool_ai)?;
        let max_fee =
            calculate_transfer_fee(amount, DEX_TAX_MAX_BPS).ok_or(HookError::MathOverflow)?;
        let lp_pre = if pool_is_source {
            pool_bal.saturating_add(amount)
        } else {
            pool_bal.saturating_sub(amount.saturating_sub(max_fee))
        };

        let target_bps = dex_tax_bps_from_size(amount, lp_pre);
        cfg.lifetime_volume = cfg
            .lifetime_volume
            .checked_add(amount)
            .ok_or(HookError::MathOverflow)?;
        cfg.transfer_tax_bps = target_bps;

        let desired =
            calculate_transfer_fee(amount, target_bps).ok_or(HookError::MathOverflow)?;
        let refund_net = max_fee.saturating_sub(desired);
        if refund_net > 0 {
            // One pending slot — settle before the next DEX transfer that needs a refund.
            cfg.pending_refund_dest = dest;
            cfg.pending_refund_amount = refund_net;
        }

        msg!(
            "dex size/LP tax → {} bps (amount={} lp={} refund={})",
            target_bps,
            amount,
            lp_pre,
            refund_net
        );
        Ok(())
    }

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
    /// CHECK: extra-account-metas PDA.
    #[account(mut, seeds = [EXTRA_ACCOUNT_METAS_SEED, mint.key().as_ref()], bump)]
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
    #[account(mut, seeds = [EXTRA_ACCOUNT_METAS_SEED, mint.key().as_ref()], bump)]
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
    /// CHECK: DEX pool BULLET token account.
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
    /// CHECK: pool token account.
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
    /// CHECK: token account to exempt.
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
    /// CHECK: token account.
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
pub struct MigrateConfigLayout<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    pub mint: InterfaceAccount<'info, Mint>,
    /// CHECK: realloc HookConfig PDA.
    #[account(mut, seeds = [HOOK_CONFIG_SEED, mint.key().as_ref()], bump)]
    pub hook_config: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SettleDexTaxRefund<'info> {
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [HOOK_CONFIG_SEED, mint.key().as_ref()],
        bump = hook_config.bump,
        has_one = mint @ HookError::InvalidMint,
    )]
    pub hook_config: Account<'info, HookConfig>,

    /// CHECK: withdraw_auth PDA.
    #[account(seeds = [WITHDRAW_AUTH_SEED, mint.key().as_ref()], bump)]
    pub withdraw_auth: UncheckedAccount<'info>,

    /// CHECK: fee vault ATA owned by withdraw_auth (must be hook-exempt).
    #[account(mut)]
    pub fee_vault: UncheckedAccount<'info>,

    /// CHECK: destination that received the DEX transfer (has withheld fees).
    #[account(mut)]
    pub destination_token: UncheckedAccount<'info>,

    /// Crank / user who will sign the top-level refund transfer as delegate.
    pub refund_authority: Signer<'info>,

    /// CHECK: Token-2022 program.
    pub token_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct TransferHook<'info> {
    /// CHECK: source.
    pub source_token: UncheckedAccount<'info>,
    /// CHECK: mint.
    pub mint: UncheckedAccount<'info>,
    /// CHECK: destination.
    pub destination_token: UncheckedAccount<'info>,
    /// CHECK: owner.
    pub owner: UncheckedAccount<'info>,
    /// CHECK: extra metas.
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
