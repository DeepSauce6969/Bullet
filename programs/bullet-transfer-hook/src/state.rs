use anchor_lang::prelude::*;

/// Default DEX transfer tax: 5% (500 bps). Actual fee is on the mint TransferFee extension.
pub const DEFAULT_TRANSFER_TAX_BPS: u16 = 500;

pub const MAX_DEX_POOLS: usize = 12;
pub const MAX_EXEMPT_ACCOUNTS: usize = 8;

pub const HOOK_CONFIG_SEED: &[u8] = b"hook_config";
/// Transfer-hook interface standard seed for ExtraAccountMetaList PDA.
pub const EXTRA_ACCOUNT_METAS_SEED: &[u8] = b"extra-account-metas";

#[account]
#[derive(InitSpace)]
pub struct HookConfig {
    pub authority: Pubkey,
    pub mint: Pubkey,
    pub transfer_tax_bps: u16,
    pub dex_pool_count: u8,
    pub exempt_count: u8,
    pub bump: u8,
    pub padding: [u8; 3],
    pub dex_pools: [Pubkey; MAX_DEX_POOLS],
    pub exempt_accounts: [Pubkey; MAX_EXEMPT_ACCOUNTS],
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
