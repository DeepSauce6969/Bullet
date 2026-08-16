use anchor_lang::prelude::*;

/// Default DEX transfer tax at launch: 8% (800 bps). Live rate is volume-dynamic
/// in [DEX_TAX_MIN_BPS, DEX_TAX_MAX_BPS]. Actual withholding is the mint TransferFee.
pub const DEFAULT_TRANSFER_TAX_BPS: u16 = 800;
pub const DEX_TAX_MIN_BPS: u16 = 400; // 4%
pub const DEX_TAX_MAX_BPS: u16 = 800; // 8%

pub const MAX_DEX_POOLS: usize = 12;
pub const MAX_EXEMPT_ACCOUNTS: usize = 8;

pub const HOOK_CONFIG_SEED: &[u8] = b"hook_config";
/// Transfer-hook interface standard seed for ExtraAccountMetaList PDA.
pub const EXTRA_ACCOUNT_METAS_SEED: &[u8] = b"extra-account-metas";

/// Lifetime DEX volume thresholds (raw 6-decimal BULLET units).
/// Higher cumulative volume → lower tax (growth discount), clamped 4–8%.
pub fn dex_tax_bps_from_volume(lifetime_volume: u64) -> u16 {
    const STEP_50K: u64 = 50_000 * 1_000_000;
    const STEP_250K: u64 = 250_000 * 1_000_000;
    const STEP_1M: u64 = 1_000_000 * 1_000_000;
    const STEP_5M: u64 = 5_000_000 * 1_000_000;
    if lifetime_volume < STEP_50K {
        800
    } else if lifetime_volume < STEP_250K {
        700
    } else if lifetime_volume < STEP_1M {
        600
    } else if lifetime_volume < STEP_5M {
        500
    } else {
        400
    }
}

#[account]
#[derive(InitSpace)]
pub struct HookConfig {
    pub authority: Pubkey,
    pub mint: Pubkey,
    /// Cached target tax (mirror of mint TransferFee when synced).
    pub transfer_tax_bps: u16,
    pub dex_pool_count: u8,
    pub exempt_count: u8,
    pub bump: u8,
    pub padding: [u8; 3],
    pub dex_pools: [Pubkey; MAX_DEX_POOLS],
    pub exempt_accounts: [Pubkey; MAX_EXEMPT_ACCOUNTS],
    /// Cumulative DEX transfer amount (raw units) for dynamic tax schedule.
    pub lifetime_volume: u64,
}

impl HookConfig {
    pub fn is_exempt(&self, token_account: Pubkey) -> bool {
        self.exempt_accounts[..self.exempt_count as usize]
            .iter()
            .any(|k| *k == token_account)
    }

    pub fn is_dex_pool(&self, token_account: Pubkey) -> bool {
        self.dex_pools[..self.dex_pool_count as usize]
            .iter()
            .any(|k| *k == token_account)
    }

    pub fn add_dex_pool(&mut self, pool: Pubkey) -> Result<()> {
        require!(
            (self.dex_pool_count as usize) < MAX_DEX_POOLS,
            crate::errors::HookError::RegistryFull
        );
        require!(!self.is_dex_pool(pool), crate::errors::HookError::AlreadyRegistered);
        self.dex_pools[self.dex_pool_count as usize] = pool;
        self.dex_pool_count = self
            .dex_pool_count
            .checked_add(1)
            .ok_or(crate::errors::HookError::RegistryFull)?;
        Ok(())
    }

    pub fn remove_dex_pool(&mut self, pool: Pubkey) -> Result<()> {
        let count = self.dex_pool_count as usize;
        let pos = self.dex_pools[..count]
            .iter()
            .position(|k| *k == pool)
            .ok_or(crate::errors::HookError::NotRegistered)?;
        for i in pos..count.saturating_sub(1) {
            self.dex_pools[i] = self.dex_pools[i + 1];
        }
        self.dex_pools[count - 1] = Pubkey::default();
        self.dex_pool_count = self
            .dex_pool_count
            .checked_sub(1)
            .ok_or(crate::errors::HookError::NotRegistered)?;
        Ok(())
    }

    pub fn add_exempt(&mut self, account: Pubkey) -> Result<()> {
        require!(
            (self.exempt_count as usize) < MAX_EXEMPT_ACCOUNTS,
            crate::errors::HookError::RegistryFull
        );
        require!(
            !self.is_exempt(account),
            crate::errors::HookError::AlreadyRegistered
        );
        self.exempt_accounts[self.exempt_count as usize] = account;
        self.exempt_count = self
            .exempt_count
            .checked_add(1)
            .ok_or(crate::errors::HookError::RegistryFull)?;
        Ok(())
    }

    pub fn remove_exempt(&mut self, account: Pubkey) -> Result<()> {
        let count = self.exempt_count as usize;
        let pos = self.exempt_accounts[..count]
            .iter()
            .position(|k| *k == account)
            .ok_or(crate::errors::HookError::NotRegistered)?;
        for i in pos..count.saturating_sub(1) {
            self.exempt_accounts[i] = self.exempt_accounts[i + 1];
        }
        self.exempt_accounts[count - 1] = Pubkey::default();
        self.exempt_count = self
            .exempt_count
            .checked_sub(1)
            .ok_or(crate::errors::HookError::NotRegistered)?;
        Ok(())
    }
}
