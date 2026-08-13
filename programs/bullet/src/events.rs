use anchor_lang::prelude::*;

#[event]
pub struct Minted {
    pub user: Pubkey,
    pub ansem_in: u64,
    pub bullet_out: u64,
    pub fee: u64,
    pub floor_after: u64,
}

#[event]
pub struct Burned {
    pub user: Pubkey,
    pub bullet_in: u64,
    pub ansem_out: u64,
    pub fee: u64,
    pub floor_after: u64,
}

#[event]
pub struct Borrowed {
    pub user: Pubkey,
    pub loan: Pubkey,
    pub collateral: u64,
    pub borrowed: u64,
    pub interest: u64,
    pub end_ts: i64,
}

#[event]
pub struct Repaid {
    pub user: Pubkey,
    pub loan: Pubkey,
    pub principal: u64,
    pub collateral_returned: u64,
}

#[event]
pub struct Leveraged {
    pub user: Pubkey,
    pub loan: Pubkey,
    pub ansem_notional: u64,
    pub bullet_minted: u64,
    pub borrowed: u64,
    pub fees_paid: u64,
    pub end_ts: i64,
}

#[event]
pub struct Liquidated {
    pub loan: Pubkey,
    pub borrower: Pubkey,
    pub collateral_burned: u64,
    pub borrowed_kept_in_backing: u64,
    pub floor_after: u64,
}

#[event]
pub struct GenesisDeposited {
    pub vault: Pubkey,
    pub user: Pubkey,
    pub amount: u64,
    pub total_raised: u64,
}

#[event]
pub struct GenesisWithdrawn {
    pub vault: Pubkey,
    pub user: Pubkey,
    pub amount: u64,
}

#[event]
pub struct GenesisFinalized {
    pub vault: Pubkey,
    pub ansem_net: u64,
    pub fee: u64,
    pub bullet_minted: u64,
}

#[event]
pub struct GenesisClaimed {
    pub vault: Pubkey,
    pub user: Pubkey,
    pub bullet_out: u64,
}
