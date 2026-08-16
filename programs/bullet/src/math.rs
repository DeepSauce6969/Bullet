use crate::errors::BulletError;
use crate::state::*;
use anchor_lang::prelude::*;

/// Backing = idle vault Ansem + Ansem out on loans.
pub fn backing(vault_balance: u64, total_borrowed: u64) -> Result<u64> {
    vault_balance
        .checked_add(total_borrowed)
        .ok_or(BulletError::MathOverflow.into())
}

/// Floor scaled by 1e6 for integer comparison: floor = backing * 1e6 / supply.
/// When supply == 0, floor is treated as 1e6 (1:1).
pub fn floor_scaled(backing_amt: u64, supply: u64) -> Result<u64> {
    if supply == 0 {
        return Ok(1_000_000);
    }
    backing_amt
        .checked_mul(1_000_000)
        .ok_or(BulletError::MathOverflow)?
        .checked_div(supply)
        .ok_or(BulletError::DivisionByZero.into())
}

pub fn assert_floor_non_decreasing(before: u64, after: u64) -> Result<()> {
    require!(after >= before, BulletError::FloorWouldDecrease);
    Ok(())
}

/// Ansem → BULLET gross (before 95% haircut).
/// After Ansem is already in vault: gross = s * supply / (backing - s).
/// If supply == 0 → 1:1.
pub fn ansem_to_bullet_gross(s: u64, supply: u64, backing_after: u64) -> Result<u64> {
    if supply == 0 {
        return Ok(s);
    }
    let backing_before = backing_after
        .checked_sub(s)
        .ok_or(BulletError::InsufficientBacking)?;
    if backing_before == 0 {
        return Ok(s);
    }
    s.checked_mul(supply)
        .ok_or(BulletError::MathOverflow)?
        .checked_div(backing_before)
        .ok_or(BulletError::DivisionByZero.into())
}

/// BULLET → Ansem gross (before 95% haircut).
pub fn bullet_to_ansem_gross(t: u64, supply: u64, backing_amt: u64) -> Result<u64> {
    require!(supply > 0, BulletError::DivisionByZero);
    t.checked_mul(backing_amt)
        .ok_or(BulletError::MathOverflow)?
        .checked_div(supply)
        .ok_or(BulletError::DivisionByZero.into())
}

pub fn apply_out_fee(gross: u64) -> Result<u64> {
    gross
        .checked_mul(OUT_FEE_NUM)
        .ok_or(BulletError::MathOverflow)?
        .checked_div(OUT_FEE_DEN)
        .ok_or(BulletError::DivisionByZero.into())
}

pub fn protocol_fee(amount: u64) -> Result<u64> {
    amount
        .checked_mul(PROTOCOL_FEE_BPS)
        .ok_or(BulletError::MathOverflow)?
        .checked_div(BPS_DENOM)
        .ok_or(BulletError::DivisionByZero.into())
}

/// Split fee F into (pol, bribe). Backing share stays in vault (no transfer).
pub fn split_fee(fee: u64) -> Result<(u64, u64)> {
    let pol = fee
        .checked_mul(FEE_POL_BPS)
        .ok_or(BulletError::MathOverflow)?
        .checked_div(BPS_DENOM)
        .ok_or(BulletError::DivisionByZero)?;
    let bribe = fee
        .checked_mul(FEE_BRIBE_BPS)
        .ok_or(BulletError::MathOverflow)?
        .checked_div(BPS_DENOM)
        .ok_or(BulletError::DivisionByZero)?;
    Ok((pol, bribe))
}

/// interest = borrow * (0.078 * days / 365) + 0.2% of borrow
pub fn interest_fee(borrow_amt: u64, days: u16) -> Result<u64> {
    let apy_part = (borrow_amt as u128)
        .checked_mul(INTEREST_APY_BPS as u128)
        .ok_or(BulletError::MathOverflow)?
        .checked_mul(days as u128)
        .ok_or(BulletError::MathOverflow)?
        .checked_div(BPS_DENOM as u128)
        .ok_or(BulletError::DivisionByZero)?
        .checked_div(365)
        .ok_or(BulletError::DivisionByZero)?;

    let base = (borrow_amt as u128)
        .checked_mul(BASE_BORROW_FEE_BPS as u128)
        .ok_or(BulletError::MathOverflow)?
        .checked_div(BPS_DENOM as u128)
        .ok_or(BulletError::DivisionByZero)?;

    let total = apy_part
        .checked_add(base)
        .ok_or(BulletError::MathOverflow)?;
    u64::try_from(total).map_err(|_| BulletError::MathOverflow.into())
}

pub fn bps(amount: u64, bps: u64) -> Result<u64> {
    amount
        .checked_mul(bps)
        .ok_or(BulletError::MathOverflow)?
        .checked_div(BPS_DENOM)
        .ok_or(BulletError::DivisionByZero.into())
}

pub fn collateral_value_ansem(collateral_bullet: u64, supply: u64, backing_amt: u64) -> Result<u64> {
    if supply == 0 || collateral_bullet == 0 {
        return Ok(0);
    }
    bullet_to_ansem_gross(collateral_bullet, supply, backing_amt)
}

pub fn max_borrow(collateral_bullet: u64, supply: u64, backing_amt: u64) -> Result<u64> {
    let value = collateral_value_ansem(collateral_bullet, supply, backing_amt)?;
    bps(value, LTV_BPS)
}
