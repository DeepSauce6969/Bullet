use crate::errors::BulletError;
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_lang::solana_program::system_instruction;
use spl_token_2022::extension::{
    transfer_fee::instruction::initialize_transfer_fee_config,
    transfer_hook::instruction::initialize as initialize_transfer_hook,
    ExtensionType,
};
use spl_token_2022::instruction::{initialize_account3, initialize_mint};
use spl_token_2022::solana_program::program_pack::Pack;
use spl_token_2022::state::{Account as Token2022Account, Mint as Mint2022};

/// Create the BULLET Token-2022 mint PDA with TransferHook + TransferFee (DEX tax).
pub fn create_bullet_mint<'info>(
    payer: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
    protocol: &AccountInfo<'info>,
    mint_bump: u8,
    protocol_bump: u8,
    transfer_hook_program: &Pubkey,
    fee_authority: &Pubkey,
    transfer_tax_bps: u16,
    system_program: &AccountInfo<'info>,
    token_program: &AccountInfo<'info>,
    rent_sysvar: &AccountInfo<'info>,
) -> Result<()> {
    require!(
        *token_program.key == spl_token_2022::id(),
        BulletError::InvalidTokenProgram
    );
    require!(
        *transfer_hook_program == TRANSFER_HOOK_PROGRAM_ID,
        BulletError::InvalidTransferHook
    );

    let extensions = [
        ExtensionType::TransferFeeConfig,
        ExtensionType::TransferHook,
    ];
    let space = ExtensionType::try_calculate_account_len::<Mint2022>(&extensions)
        .map_err(|_| BulletError::MathOverflow)?;
    let lamports = Rent::get()?.minimum_balance(space);

    let mint_seeds: &[&[u8]] = &[Protocol::MINT_SEED, &[mint_bump]];
    invoke_signed(
        &system_instruction::create_account(
            payer.key,
            mint.key,
            lamports,
            space as u64,
            token_program.key,
        ),
        &[payer.clone(), mint.clone(), system_program.clone()],
        &[mint_seeds],
    )?;

    let protocol_seeds: &[&[u8]] = &[Protocol::SEED, &[protocol_bump]];

    invoke_signed(
        &initialize_transfer_fee_config(
            token_program.key,
            mint.key,
            Some(fee_authority),
            Some(fee_authority),
            transfer_tax_bps,
            u64::MAX,
        )?,
        &[mint.clone()],
        &[],
    )?;

    invoke_signed(
        &initialize_transfer_hook(
            token_program.key,
            mint.key,
            Some(protocol.key()),
            Some(*transfer_hook_program),
        )?,
        &[mint.clone()],
        &[],
    )?;

    invoke_signed(
        &initialize_mint(
            token_program.key,
            mint.key,
            &protocol.key(),
            Some(&protocol.key()),
            BULLET_DECIMALS,
        )?,
        &[mint.clone(), rent_sysvar.clone()],
        &[protocol_seeds],
    )?;

    Ok(())
}

/// Required Token-2022 account extensions for BULLET mint (TransferFee + TransferHook).
fn bullet_account_extensions() -> Vec<ExtensionType> {
    let mint_extensions = [
        ExtensionType::TransferFeeConfig,
        ExtensionType::TransferHook,
    ];
    let mut account_extensions =
        ExtensionType::get_required_init_account_extensions(&mint_extensions);
    account_extensions.push(ExtensionType::ImmutableOwner);
    account_extensions
}

/// Create a BULLET Token-2022 token account PDA with required extensions.
pub fn create_bullet_token_account<'info>(
    payer: &AccountInfo<'info>,
    token_account: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
    owner: &Pubkey,
    seeds: &[&[u8]],
    system_program: &AccountInfo<'info>,
    token_program: &AccountInfo<'info>,
) -> Result<()> {
    let account_extensions = bullet_account_extensions();
    let space = ExtensionType::try_calculate_account_len::<Token2022Account>(&account_extensions)
        .map_err(|_| BulletError::MathOverflow)?;
    let lamports = Rent::get()?.minimum_balance(space);

    invoke_signed(
        &system_instruction::create_account(
            payer.key,
            token_account.key,
            lamports,
            space as u64,
            token_program.key,
        ),
        &[
            payer.clone(),
            token_account.clone(),
            system_program.clone(),
        ],
        &[seeds],
    )?;

    invoke_signed(
        &spl_token_2022::instruction::initialize_immutable_owner(
            token_program.key,
            token_account.key,
        )?,
        &[token_account.clone()],
        &[],
    )?;
    invoke_signed(
        &initialize_account3(
            token_program.key,
            token_account.key,
            mint.key,
            owner,
        )?,
        &[token_account.clone(), mint.clone()],
        &[],
    )?;

    Ok(())
}

/// Create the protocol collateral BULLET token account (PDA).
pub fn create_collateral_vault<'info>(
    payer: &AccountInfo<'info>,
    vault: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
    protocol: &AccountInfo<'info>,
    vault_bump: u8,
    _protocol_bump: u8,
    system_program: &AccountInfo<'info>,
    token_program: &AccountInfo<'info>,
) -> Result<()> {
    let vault_seeds: &[&[u8]] = &[Protocol::COLLATERAL_SEED, &[vault_bump]];
    create_bullet_token_account(
        payer,
        vault,
        mint,
        &protocol.key(),
        vault_seeds,
        system_program,
        token_program,
    )
}
