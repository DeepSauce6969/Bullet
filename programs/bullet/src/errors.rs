use anchor_lang::prelude::*;

#[error_code]
pub enum BulletError {
    #[msg("Trading is not enabled")]
    TradingDisabled,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Would exceed max supply")]
    MaxSupplyExceeded,
    #[msg("Insufficient backing / vault balance")]
    InsufficientBacking,
    #[msg("Floor would decrease (safety check)")]
    FloorWouldDecrease,
    #[msg("Invalid Ansem mint — must be the configured Ansem token")]
    InvalidAnsemMint,
    #[msg("Loan duration out of range (1–365 days)")]
    InvalidLoanDuration,
    #[msg("Borrow exceeds 99% LTV")]
    ExceedsLtv,
    #[msg("Loan is not active")]
    LoanInactive,
    #[msg("Loan has not expired yet")]
    LoanNotExpired,
    #[msg("Loan already expired — repay not allowed, liquidate instead")]
    LoanExpired,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Division by zero")]
    DivisionByZero,
    #[msg("Insufficient fee payment for leverage")]
    InsufficientLeverageFee,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Presale is not active")]
    PresaleInactive,
    #[msg("Presale already finalized")]
    PresaleFinalized,
    #[msg("Presale is not finalized yet")]
    PresaleNotFinalized,
    #[msg("Deposit exceeds vault cap")]
    DepositCapExceeded,
    #[msg("Deposit exceeds user max allocation")]
    AllocationExceeded,
    #[msg("No deposit to claim / withdraw")]
    NoDeposit,
    #[msg("Already claimed")]
    AlreadyClaimed,
    #[msg("Invalid genesis vault tier")]
    InvalidTier,
}
