use anchor_lang::prelude::*;

/// Ceiling DEX tax (mint TransferFee). Hook refunds down to size/LP target in [MIN, MAX].
pub const DEFAULT_TRANSFER_TAX_BPS: u16 = 800;
pub const DEX_TAX_MIN_BPS: u16 = 400; // 4% — dust / small vs LP
pub const DEX_TAX_MAX_BPS: u16 = 800; // 8% — whale / large vs LP

/// Trade size as % of pool LP that hits max tax (10% of LP → 8%).
/// Larger LP ⇒ larger absolute size needed for max tax.
pub const DEX_TAX_R_MAX_BPS: u64 = 1_000; // 10% of LP

pub const MAX_DEX_POOLS: usize = 12;
pub const MAX_EXEMPT_ACCOUNTS: usize = 8;

pub const HOOK_CONFIG_SEED: &[u8] = b"hook_config";
pub const WITHDRAW_AUTH_SEED: &[u8] = b"withdraw_auth";
/// Transfer-hook interface standard seed for ExtraAccountMetaList PDA.
pub const EXTRA_ACCOUNT_METAS_SEED: &[u8] = b"extra-account-metas";

/// Per-trade DEX tax from size vs pool LP, clamped to [4%, 8%].
///
/// `r = amount / lp_pre` (trade as fraction of LP).  
/// At `r = 0` → 4%. At `r >= R_MAX` (10% of LP) → 8%. Linear in between.
pub fn dex_tax_bps_from_size(amount: u64, lp_pre: u64) -> u16 {
    if lp_pre == 0 {
        return DEX_TAX_MAX_BPS;
    }
    let ratio_bps = (amount as u128)
        .saturating_mul(10_000)
        .checked_div(lp_pre as u128)
        .unwrap_or(u128::MAX);
    let t = std::cmp::min(ratio_bps, DEX_TAX_R_MAX_BPS as u128);
    let span = (DEX_TAX_MAX_BPS - DEX_TAX_MIN_BPS) as u128;
    (DEX_TAX_MIN_BPS as u128 + span * t / DEX_TAX_R_MAX_BPS as u128) as u16
}

/// Ceiling fee matching Token-2022 TransferFee math.
pub fn calculate_transfer_fee(amount: u64, bps: u16) -> Option<u64> {
    if bps == 0 || amount == 0 {
        return Some(0);
    }
    let numerator = (amount as u128).checked_mul(bps as u128)?;
    // ceil(numerator / 10000)
    let fee = numerator
        .checked_add(10_000 - 1)?
        .checked_div(10_000)?;
    u64::try_from(fee).ok()
}

#[account]
#[derive(InitSpace)]
pub struct HookConfig {
    pub authority: Pubkey,
    pub mint: Pubkey,
    /// Last computed target tax bps (indexer hint; mint TransferFee stays at MAX).
    pub transfer_tax_bps: u16,
    pub dex_pool_count: u8,
    pub exempt_count: u8,
    pub bump: u8,
    pub padding: [u8; 3],
    pub dex_pools: [Pubkey; MAX_DEX_POOLS],
    pub exempt_accounts: [Pubkey; MAX_EXEMPT_ACCOUNTS],
    /// Cumulative DEX transfer amount (analytics only).
    pub lifetime_volume: u64,
    /// Destination awaiting size/LP tax refund (single slot).
    pub pending_refund_dest: Pubkey,
    /// Net BULLET to refund so effective tax matches size/LP target.
    pub pending_refund_amount: u64,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn small_vs_lp_near_min() {
        // 0.1% of LP → near 4%
        let bps = dex_tax_bps_from_size(1_000, 1_000_000);
        assert!(bps >= 400 && bps <= 410, "bps={bps}");
    }

    #[test]
    fn ten_pct_lp_hits_max() {
        assert_eq!(dex_tax_bps_from_size(100_000, 1_000_000), 800);
    }

    #[test]
    fn larger_lp_needs_larger_trade_for_max() {
        // Same absolute size, 10x LP → much lower tax
        let small_lp = dex_tax_bps_from_size(100_000, 1_000_000); // 10% → 800
        let big_lp = dex_tax_bps_from_size(100_000, 10_000_000); // 1% → 440
        assert_eq!(small_lp, 800);
        assert_eq!(big_lp, 440);
    }
}
