use anchor_lang::prelude::*;

/// Mainnet Ansem (pump.fun) — expected backing asset on mainnet.
/// Initialize stores whatever mint you pass (use this address on mainnet).
pub const ANSEM_MINT_MAINNET: &str = "9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump";

/// Protocol parameters (fee / floor model).
pub const PROTOCOL_FEE_BPS: u64 = 500; // 5%
pub const BPS_DENOM: u64 = 10_000;
pub const OUT_FEE_NUM: u64 = 950; // user receives 95%
pub const OUT_FEE_DEN: u64 = 1_000;

pub const FEE_BACKING_BPS: u64 = 7_000; // 70% of fee stays in backing
pub const FEE_POL_BPS: u64 = 1_500; // 15% → POL vault
pub const FEE_BRIBE_BPS: u64 = 1_500; // 15% → fee recipient

pub const LTV_BPS: u64 = 9_900; // 99%
pub const INTEREST_APY_BPS: u64 = 780; // 7.8% APY
pub const BASE_BORROW_FEE_BPS: u64 = 20; // 0.2%

pub const LEVERAGE_BAKE_BPS: u64 = 200; // 2%
pub const OVERCOLLAT_BPS: u64 = 200; // 2%

pub const MIN_LOAN_DAYS: u16 = 1;
pub const MAX_LOAN_DAYS: u16 = 365;
pub const SECONDS_PER_DAY: i64 = 86_400;

pub const BULLET_DECIMALS: u8 = 6;
/// Default max supply: 5,000,000 BULLET (6 decimals).
pub const DEFAULT_MAX_SUPPLY: u64 = 5_000_000 * 1_000_000;

/// Token-2022 transfer hook program (DEX-only gate + tax config).
/// Sourced from `bullet_transfer_hook::ID` so localnet `anchor keys sync` stays consistent.
pub const TRANSFER_HOOK_PROGRAM_ID: Pubkey = bullet_transfer_hook::ID;

/// Default 8% tax on DEX transfers (basis points). Adjustable via hook + SetTransferFee.
pub const DEFAULT_DEX_TRANSFER_TAX_BPS: u16 = 800;

#[account]
#[derive(InitSpace)]
pub struct Protocol {
    pub authority: Pubkey,
    pub bullet_mint: Pubkey,
    pub ansem_mint: Pubkey,
    /// Ansem ATA owned by protocol PDA (idle backing).
    pub vault: Pubkey,
    /// Ansem ATA for protocol-owned liquidity share of fees.
    pub pol_vault: Pubkey,
    /// Receives bribe share of fees (15%).
    pub fee_recipient: Pubkey,
    /// BULLET ATA holding loan collateral.
    pub collateral_vault: Pubkey,
    pub bump: u8,
    pub mint_bump: u8,
    /// Cumulative BULLET ever minted (burns do not free capacity).
    pub total_minted: u64,
    pub max_supply: u64,
    /// Ansem currently out on loans (counts toward backing).
    pub total_borrowed: u64,
    /// Circulating BULLET supply tracked on-chain for floor math.
    pub total_supply: u64,
    pub loan_count: u64,
    pub trading_enabled: bool,
    pub padding: [u8; 32],
}

impl Protocol {
    pub const SEED: &'static [u8] = b"protocol";
    pub const MINT_SEED: &'static [u8] = b"bullet_mint";
    pub const VAULT_SEED: &'static [u8] = b"vault";
    pub const POL_SEED: &'static [u8] = b"pol_vault";
    pub const COLLATERAL_SEED: &'static [u8] = b"collateral_vault";
}

#[account]
#[derive(InitSpace)]
pub struct Loan {
    pub protocol: Pubkey,
    pub borrower: Pubkey,
    pub collateral_bullet: u64,
    pub borrowed_ansem: u64,
    pub start_ts: i64,
    pub end_ts: i64,
    pub active: bool,
    pub bump: u8,
    pub padding: [u8; 32],
}

impl Loan {
    pub const SEED: &'static [u8] = b"loan";
}

/// Genesis pre-deposit vault (VIP / Community / Public).
#[account]
#[derive(InitSpace)]
pub struct GenesisVault {
    pub protocol: Pubkey,
    pub ansem_mint: Pubkey,
    /// Ansem ATA owned by this vault PDA during the sale.
    pub token_vault: Pubkey,
    /// BULLET ATA owned by this vault PDA after finalize.
    pub bullet_vault: Pubkey,
    /// Tier mint fee in bps (0 / 250 / 400 = VIP / Community / Public).
    pub fee_bps: u16,
    pub deposit_cap: u64,
    pub max_allocation: u64,
    pub total_raised: u64,
    pub total_bullet: u64,
    /// 0 = VIP, 1 = Community, 2 = Public
    pub tier: u8,
    pub bump: u8,
    pub token_vault_bump: u8,
    pub bullet_vault_bump: u8,
    pub presale_active: bool,
    pub is_finalized: bool,
    pub padding: [u8; 32],
}

impl GenesisVault {
    pub const SEED: &'static [u8] = b"genesis_vault";
    pub const TOKEN_SEED: &'static [u8] = b"genesis_ansem";
    pub const BULLET_SEED: &'static [u8] = b"genesis_bullet";
}

#[account]
#[derive(InitSpace)]
pub struct UserDeposit {
    pub vault: Pubkey,
    pub user: Pubkey,
    pub amount: u64,
    pub claimed: bool,
    pub bump: u8,
    pub padding: [u8; 16],
}

impl UserDeposit {
    pub const SEED: &'static [u8] = b"user_deposit";
}
