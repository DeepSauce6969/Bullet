use crate::errors::BulletError;
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{Mint as MintClassic, Token, TokenAccount as TokenAccountClassic};
use anchor_spl::token_2022::Token2022;
use anchor_spl::token_interface::{Mint as MintInterface, TokenAccount as TokenAccountInterface};

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + Protocol::INIT_SPACE,
        seeds = [Protocol::SEED],
        bump
    )]
    pub protocol: Box<Account<'info, Protocol>>,

    /// CHECK: Token-2022 BULLET mint PDA — created in handler.
    #[account(
        mut,
        seeds = [Protocol::MINT_SEED],
        bump,
    )]
    pub bullet_mint: UncheckedAccount<'info>,

    /// Backing mint (mainnet: Ansem `9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump`).
    pub ansem_mint: Box<Account<'info, MintClassic>>,

    #[account(
        init,
        payer = authority,
        seeds = [Protocol::VAULT_SEED],
        bump,
        token::mint = ansem_mint,
        token::authority = protocol,
    )]
    pub vault: Box<Account<'info, TokenAccountClassic>>,

    #[account(
        init,
        payer = authority,
        seeds = [Protocol::POL_SEED],
        bump,
        token::mint = ansem_mint,
        token::authority = protocol,
    )]
    pub pol_vault: Box<Account<'info, TokenAccountClassic>>,

    /// CHECK: BULLET collateral vault PDA — created in handler.
    #[account(
        mut,
        seeds = [Protocol::COLLATERAL_SEED],
        bump,
    )]
    pub collateral_vault: UncheckedAccount<'info>,

    /// CHECK: transfer hook program id.
    #[account(
        constraint = transfer_hook_program.key() == TRANSFER_HOOK_PROGRAM_ID @ BulletError::InvalidTransferHook
    )]
    pub transfer_hook_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub token_2022_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct MintBullet<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [Protocol::SEED],
        bump = protocol.bump,
        has_one = bullet_mint,
        has_one = ansem_mint,
        has_one = vault,
        has_one = pol_vault,
    )]
    pub protocol: Box<Account<'info, Protocol>>,

    #[account(mut, address = protocol.bullet_mint, mint::token_program = bullet_token_program)]
    pub bullet_mint: InterfaceAccount<'info, MintInterface>,

    #[account(address = protocol.ansem_mint)]
    pub ansem_mint: Box<Account<'info, MintClassic>>,

    #[account(mut, address = protocol.vault)]
    pub vault: Box<Account<'info, TokenAccountClassic>>,

    #[account(mut, address = protocol.pol_vault)]
    pub pol_vault: Box<Account<'info, TokenAccountClassic>>,

    /// CHECK: fee recipient wallet — ATA validated below.
    #[account(address = protocol.fee_recipient)]
    pub fee_recipient: UncheckedAccount<'info>,

    #[account(
        mut,
        associated_token::mint = ansem_mint,
        associated_token::authority = fee_recipient,
    )]
    pub fee_recipient_ata: Box<Account<'info, TokenAccountClassic>>,

    #[account(
        mut,
        associated_token::mint = ansem_mint,
        associated_token::authority = user,
    )]
    pub user_ansem: Box<Account<'info, TokenAccountClassic>>,

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = bullet_mint,
        associated_token::authority = user,
        associated_token::token_program = bullet_token_program,
    )]
    pub user_bullet: InterfaceAccount<'info, TokenAccountInterface>,

    pub token_program: Program<'info, Token>,
    pub bullet_token_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct BurnBullet<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [Protocol::SEED],
        bump = protocol.bump,
        has_one = bullet_mint,
        has_one = ansem_mint,
        has_one = vault,
        has_one = pol_vault,
    )]
    pub protocol: Box<Account<'info, Protocol>>,

    #[account(mut, address = protocol.bullet_mint, mint::token_program = bullet_token_program)]
    pub bullet_mint: InterfaceAccount<'info, MintInterface>,

    #[account(address = protocol.ansem_mint)]
    pub ansem_mint: Box<Account<'info, MintClassic>>,

    #[account(mut, address = protocol.vault)]
    pub vault: Box<Account<'info, TokenAccountClassic>>,

    #[account(mut, address = protocol.pol_vault)]
    pub pol_vault: Box<Account<'info, TokenAccountClassic>>,

    /// CHECK: bribe wallet.
    #[account(address = protocol.fee_recipient)]
    pub fee_recipient: UncheckedAccount<'info>,

    #[account(
        mut,
        associated_token::mint = ansem_mint,
        associated_token::authority = fee_recipient,
    )]
    pub fee_recipient_ata: Box<Account<'info, TokenAccountClassic>>,

    #[account(
        mut,
        associated_token::mint = bullet_mint,
        associated_token::authority = user,
        associated_token::token_program = bullet_token_program,
    )]
    pub user_bullet: InterfaceAccount<'info, TokenAccountInterface>,

    #[account(
        mut,
        associated_token::mint = ansem_mint,
        associated_token::authority = user,
    )]
    pub user_ansem: Box<Account<'info, TokenAccountClassic>>,

    pub token_program: Program<'info, Token>,
    pub bullet_token_program: Program<'info, Token2022>,
}

#[derive(Accounts)]
pub struct Borrow<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [Protocol::SEED],
        bump = protocol.bump,
        has_one = bullet_mint,
        has_one = ansem_mint,
        has_one = vault,
        has_one = pol_vault,
        has_one = collateral_vault,
    )]
    pub protocol: Box<Account<'info, Protocol>>,

    #[account(mut, address = protocol.bullet_mint, mint::token_program = bullet_token_program)]
    pub bullet_mint: Box<InterfaceAccount<'info, MintInterface>>,

    #[account(address = protocol.ansem_mint)]
    pub ansem_mint: Box<Account<'info, MintClassic>>,

    #[account(mut, address = protocol.vault)]
    pub vault: Box<Account<'info, TokenAccountClassic>>,

    #[account(mut, address = protocol.pol_vault)]
    pub pol_vault: Box<Account<'info, TokenAccountClassic>>,

    #[account(
        mut,
        address = protocol.collateral_vault,
        token::token_program = bullet_token_program,
    )]
    pub collateral_vault: Box<InterfaceAccount<'info, TokenAccountInterface>>,

    /// CHECK: bribe wallet.
    #[account(address = protocol.fee_recipient)]
    pub fee_recipient: UncheckedAccount<'info>,

    #[account(
        mut,
        associated_token::mint = ansem_mint,
        associated_token::authority = fee_recipient,
    )]
    pub fee_recipient_ata: Box<Account<'info, TokenAccountClassic>>,

    #[account(
        mut,
        associated_token::mint = bullet_mint,
        associated_token::authority = user,
        associated_token::token_program = bullet_token_program,
    )]
    pub user_bullet: Box<InterfaceAccount<'info, TokenAccountInterface>>,

    #[account(
        mut,
        associated_token::mint = ansem_mint,
        associated_token::authority = user,
    )]
    pub user_ansem: Box<Account<'info, TokenAccountClassic>>,

    #[account(
        init,
        payer = user,
        space = 8 + Loan::INIT_SPACE,
        seeds = [
            Loan::SEED,
            protocol.key().as_ref(),
            user.key().as_ref(),
            &protocol.loan_count.to_le_bytes()
        ],
        bump
    )]
    pub loan: Box<Account<'info, Loan>>,

    pub token_program: Program<'info, Token>,
    pub bullet_token_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Repay<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [Protocol::SEED],
        bump = protocol.bump,
        has_one = vault,
        has_one = collateral_vault,
        has_one = bullet_mint,
    )]
    pub protocol: Box<Account<'info, Protocol>>,

    #[account(mut, address = protocol.bullet_mint, mint::token_program = bullet_token_program)]
    pub bullet_mint: InterfaceAccount<'info, MintInterface>,

    #[account(address = protocol.ansem_mint)]
    pub ansem_mint: Box<Account<'info, MintClassic>>,

    #[account(mut, address = protocol.vault)]
    pub vault: Box<Account<'info, TokenAccountClassic>>,

    #[account(
        mut,
        address = protocol.collateral_vault,
        token::token_program = bullet_token_program,
    )]
    pub collateral_vault: InterfaceAccount<'info, TokenAccountInterface>,

    #[account(
        mut,
        associated_token::mint = ansem_mint,
        associated_token::authority = user,
    )]
    pub user_ansem: Box<Account<'info, TokenAccountClassic>>,

    #[account(
        mut,
        associated_token::mint = bullet_mint,
        associated_token::authority = user,
        associated_token::token_program = bullet_token_program,
    )]
    pub user_bullet: InterfaceAccount<'info, TokenAccountInterface>,

    #[account(
        mut,
        constraint = loan.borrower == user.key() @ BulletError::Unauthorized,
        constraint = loan.protocol == protocol.key() @ BulletError::Unauthorized,
        constraint = loan.active @ BulletError::LoanInactive,
        close = user,
    )]
    pub loan: Box<Account<'info, Loan>>,

    pub token_program: Program<'info, Token>,
    pub bullet_token_program: Program<'info, Token2022>,
}

#[derive(Accounts)]
pub struct Leverage<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [Protocol::SEED],
        bump = protocol.bump,
        has_one = bullet_mint,
        has_one = ansem_mint,
        has_one = vault,
        has_one = pol_vault,
        has_one = collateral_vault,
    )]
    pub protocol: Box<Account<'info, Protocol>>,

    #[account(mut, address = protocol.bullet_mint, mint::token_program = bullet_token_program)]
    pub bullet_mint: Box<InterfaceAccount<'info, MintInterface>>,

    #[account(address = protocol.ansem_mint)]
    pub ansem_mint: Box<Account<'info, MintClassic>>,

    #[account(mut, address = protocol.vault)]
    pub vault: Box<Account<'info, TokenAccountClassic>>,

    #[account(mut, address = protocol.pol_vault)]
    pub pol_vault: Box<Account<'info, TokenAccountClassic>>,

    #[account(
        mut,
        address = protocol.collateral_vault,
        token::token_program = bullet_token_program,
    )]
    pub collateral_vault: Box<InterfaceAccount<'info, TokenAccountInterface>>,

    /// CHECK: bribe wallet.
    #[account(address = protocol.fee_recipient)]
    pub fee_recipient: UncheckedAccount<'info>,

    #[account(
        mut,
        associated_token::mint = ansem_mint,
        associated_token::authority = fee_recipient,
    )]
    pub fee_recipient_ata: Box<Account<'info, TokenAccountClassic>>,

    #[account(
        mut,
        associated_token::mint = ansem_mint,
        associated_token::authority = user,
    )]
    pub user_ansem: Box<Account<'info, TokenAccountClassic>>,

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = bullet_mint,
        associated_token::authority = user,
        associated_token::token_program = bullet_token_program,
    )]
    pub user_bullet: Box<InterfaceAccount<'info, TokenAccountInterface>>,

    #[account(
        init,
        payer = user,
        space = 8 + Loan::INIT_SPACE,
        seeds = [
            Loan::SEED,
            protocol.key().as_ref(),
            user.key().as_ref(),
            &protocol.loan_count.to_le_bytes()
        ],
        bump
    )]
    pub loan: Box<Account<'info, Loan>>,

    pub token_program: Program<'info, Token>,
    pub bullet_token_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Liquidate<'info> {
    #[account(mut)]
    pub liquidator: Signer<'info>,

    #[account(
        mut,
        seeds = [Protocol::SEED],
        bump = protocol.bump,
        has_one = bullet_mint,
        has_one = collateral_vault,
        has_one = vault,
    )]
    pub protocol: Box<Account<'info, Protocol>>,

    #[account(mut, address = protocol.bullet_mint, mint::token_program = bullet_token_program)]
    pub bullet_mint: InterfaceAccount<'info, MintInterface>,

    #[account(mut, address = protocol.vault)]
    pub vault: Box<Account<'info, TokenAccountClassic>>,

    #[account(
        mut,
        address = protocol.collateral_vault,
        token::token_program = bullet_token_program,
    )]
    pub collateral_vault: InterfaceAccount<'info, TokenAccountInterface>,

    #[account(
        mut,
        constraint = loan.protocol == protocol.key() @ BulletError::Unauthorized,
        constraint = loan.active @ BulletError::LoanInactive,
        close = liquidator,
    )]
    pub loan: Box<Account<'info, Loan>>,

    pub bullet_token_program: Program<'info, Token2022>,
}

#[derive(Accounts)]
pub struct SetFeeRecipient<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [Protocol::SEED],
        bump = protocol.bump,
        has_one = authority @ BulletError::Unauthorized,
    )]
    pub protocol: Box<Account<'info, Protocol>>,
}

#[derive(Accounts)]
pub struct SetMaxSupply<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [Protocol::SEED],
        bump = protocol.bump,
        has_one = authority @ BulletError::Unauthorized,
    )]
    pub protocol: Box<Account<'info, Protocol>>,
}

#[derive(Accounts)]
pub struct SetGenesisFeeBps<'info> {
    pub authority: Signer<'info>,

    #[account(
        seeds = [Protocol::SEED],
        bump = protocol.bump,
        has_one = authority @ BulletError::Unauthorized,
    )]
    pub protocol: Box<Account<'info, Protocol>>,

    #[account(
        mut,
        seeds = [GenesisVault::SEED, &[genesis_vault.tier]],
        bump = genesis_vault.bump,
        constraint = genesis_vault.protocol == protocol.key() @ BulletError::Unauthorized,
    )]
    pub genesis_vault: Box<Account<'info, GenesisVault>>,
}

#[derive(Accounts)]
#[instruction(tier: u8)]
pub struct InitGenesisVault<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [Protocol::SEED],
        bump = protocol.bump,
        has_one = authority @ BulletError::Unauthorized,
        has_one = ansem_mint,
        has_one = bullet_mint,
    )]
    pub protocol: Box<Account<'info, Protocol>>,

    #[account(address = protocol.ansem_mint)]
    pub ansem_mint: Box<Account<'info, MintClassic>>,

    #[account(
        address = protocol.bullet_mint,
        mint::token_program = bullet_token_program,
    )]
    pub bullet_mint: InterfaceAccount<'info, MintInterface>,

    #[account(
        init,
        payer = authority,
        space = 8 + GenesisVault::INIT_SPACE,
        seeds = [GenesisVault::SEED, &[tier]],
        bump
    )]
    pub genesis_vault: Box<Account<'info, GenesisVault>>,

    #[account(
        init,
        payer = authority,
        seeds = [GenesisVault::TOKEN_SEED, &[tier]],
        bump,
        token::mint = ansem_mint,
        token::authority = genesis_vault,
    )]
    pub token_vault: Box<Account<'info, TokenAccountClassic>>,

    /// CHECK: BULLET genesis vault PDA — created in handler with Token-2022 extensions.
    #[account(
        mut,
        seeds = [GenesisVault::BULLET_SEED, &[tier]],
        bump,
    )]
    pub bullet_vault: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub bullet_token_program: Program<'info, Token2022>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct DepositGenesis<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [GenesisVault::SEED, &[genesis_vault.tier]],
        bump = genesis_vault.bump,
        constraint = genesis_vault.presale_active @ BulletError::PresaleInactive,
        constraint = !genesis_vault.is_finalized @ BulletError::PresaleFinalized,
    )]
    pub genesis_vault: Box<Account<'info, GenesisVault>>,

    #[account(
        mut,
        address = genesis_vault.token_vault,
    )]
    pub token_vault: Box<Account<'info, TokenAccountClassic>>,

    #[account(
        mut,
        associated_token::mint = genesis_vault.ansem_mint,
        associated_token::authority = user,
    )]
    pub user_ansem: Box<Account<'info, TokenAccountClassic>>,

    #[account(
        init_if_needed,
        payer = user,
        space = 8 + UserDeposit::INIT_SPACE,
        seeds = [
            UserDeposit::SEED,
            genesis_vault.key().as_ref(),
            user.key().as_ref()
        ],
        bump
    )]
    pub user_deposit: Box<Account<'info, UserDeposit>>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct WithdrawGenesis<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [GenesisVault::SEED, &[genesis_vault.tier]],
        bump = genesis_vault.bump,
        constraint = !genesis_vault.is_finalized @ BulletError::PresaleFinalized,
    )]
    pub genesis_vault: Box<Account<'info, GenesisVault>>,

    #[account(
        mut,
        address = genesis_vault.token_vault,
    )]
    pub token_vault: Box<Account<'info, TokenAccountClassic>>,

    #[account(
        mut,
        associated_token::mint = genesis_vault.ansem_mint,
        associated_token::authority = user,
    )]
    pub user_ansem: Box<Account<'info, TokenAccountClassic>>,

    #[account(
        mut,
        seeds = [
            UserDeposit::SEED,
            genesis_vault.key().as_ref(),
            user.key().as_ref()
        ],
        bump = user_deposit.bump,
        constraint = user_deposit.user == user.key() @ BulletError::Unauthorized,
        constraint = user_deposit.vault == genesis_vault.key() @ BulletError::Unauthorized,
        close = user,
    )]
    pub user_deposit: Box<Account<'info, UserDeposit>>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct FinalizeGenesis<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [Protocol::SEED],
        bump = protocol.bump,
        has_one = authority @ BulletError::Unauthorized,
        has_one = bullet_mint,
        has_one = ansem_mint,
        has_one = vault,
        has_one = pol_vault,
    )]
    pub protocol: Box<Account<'info, Protocol>>,

    #[account(mut, address = protocol.bullet_mint, mint::token_program = bullet_token_program)]
    pub bullet_mint: InterfaceAccount<'info, MintInterface>,

    #[account(address = protocol.ansem_mint)]
    pub ansem_mint: Box<Account<'info, MintClassic>>,

    #[account(mut, address = protocol.vault)]
    pub vault: Box<Account<'info, TokenAccountClassic>>,

    #[account(mut, address = protocol.pol_vault)]
    pub pol_vault: Box<Account<'info, TokenAccountClassic>>,

    #[account(
        mut,
        seeds = [GenesisVault::SEED, &[genesis_vault.tier]],
        bump = genesis_vault.bump,
        constraint = genesis_vault.protocol == protocol.key() @ BulletError::Unauthorized,
        constraint = !genesis_vault.is_finalized @ BulletError::PresaleFinalized,
    )]
    pub genesis_vault: Box<Account<'info, GenesisVault>>,

    #[account(
        mut,
        address = genesis_vault.token_vault,
    )]
    pub token_vault: Box<Account<'info, TokenAccountClassic>>,

    #[account(
        mut,
        address = genesis_vault.bullet_vault,
        token::token_program = bullet_token_program,
    )]
    pub bullet_vault: InterfaceAccount<'info, TokenAccountInterface>,

    pub token_program: Program<'info, Token>,
    pub bullet_token_program: Program<'info, Token2022>,
}

#[derive(Accounts)]
pub struct ClaimGenesis<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [GenesisVault::SEED, &[genesis_vault.tier]],
        bump = genesis_vault.bump,
        constraint = genesis_vault.is_finalized @ BulletError::PresaleNotFinalized,
    )]
    pub genesis_vault: Box<Account<'info, GenesisVault>>,

    #[account(
        mut,
        address = genesis_vault.bullet_vault,
        token::token_program = bullet_token_program,
    )]
    pub bullet_vault: InterfaceAccount<'info, TokenAccountInterface>,

    #[account(
        mut,
        seeds = [Protocol::SEED],
        bump = protocol.bump,
        constraint = protocol.key() == genesis_vault.protocol @ BulletError::Unauthorized,
        has_one = bullet_mint,
    )]
    pub protocol: Box<Account<'info, Protocol>>,

    #[account(
        mut,
        address = protocol.bullet_mint,
        mint::token_program = bullet_token_program,
    )]
    pub bullet_mint: InterfaceAccount<'info, MintInterface>,

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = bullet_mint,
        associated_token::authority = user,
        associated_token::token_program = bullet_token_program,
    )]
    pub user_bullet: InterfaceAccount<'info, TokenAccountInterface>,

    #[account(
        mut,
        seeds = [
            UserDeposit::SEED,
            genesis_vault.key().as_ref(),
            user.key().as_ref()
        ],
        bump = user_deposit.bump,
        constraint = user_deposit.user == user.key() @ BulletError::Unauthorized,
        constraint = !user_deposit.claimed @ BulletError::AlreadyClaimed,
        constraint = user_deposit.amount > 0 @ BulletError::NoDeposit,
    )]
    pub user_deposit: Box<Account<'info, UserDeposit>>,

    pub token_program: Program<'info, Token>,
    pub bullet_token_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}