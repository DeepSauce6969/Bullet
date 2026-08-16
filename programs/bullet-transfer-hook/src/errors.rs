use anchor_lang::prelude::*;

#[error_code]
pub enum HookError {
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Invalid mint")]
    InvalidMint,
    #[msg("Invalid basis points")]
    InvalidBps,
    #[msg("Transfer not allowed — BULLET may only move via protocol or registered DEX pools")]
    TransferNotAllowed,
    #[msg("Invalid instruction")]
    InvalidInstruction,
    #[msg("Registry is full")]
    RegistryFull,
    #[msg("Entry not registered")]
    NotRegistered,
    #[msg("Entry already registered")]
    AlreadyRegistered,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Config layout already migrated")]
    AlreadyMigrated,
}
