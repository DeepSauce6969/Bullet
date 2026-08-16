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
/// Uses u128 intermediates so large 6-decimal supplies do not overflow u64 mul.
pub fn floor_scaled(backing_amt: u64, supply: u64) -> Result<u64> {
    if supply == 0 {
        return Ok(1_000_000);
    }
    let scaled = (backing_amt as u128)
        .checked_mul(1_000_000)
        .ok_or(BulletError::MathOverflow)?
        .checked_div(supply as u128)
        .ok_or(BulletError::DivisionByZero)?;
    u64::try_from(scaled).map_err(|_| BulletError::MathOverflow.into())
}

pub fn assert_floor_non_decreasing(before: u64, after: u64) -> Result<()> {
    require!(after >= before, BulletError::FloorWouldDecrease);
    Ok(())
}

/// Ansem → BULLET gross (before 4% out-fee haircut).
/// After Ansem is already in vault: gross = s * supply / (backing - s).
/// If supply == 0 → 1:1.
/// Uses u128 intermediates so `s * supply` does not overflow at real supply sizes.
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
    let gross = (s as u128)
        .checked_mul(supply as u128)
        .ok_or(BulletError::MathOverflow)?
        .checked_div(backing_before as u128)
        .ok_or(BulletError::DivisionByZero)?;
    u64::try_from(gross).map_err(|_| BulletError::MathOverflow.into())
}

/// BULLET → Ansem gross (before 4% out-fee haircut).
/// Uses u128 intermediates so `t * backing` does not overflow at real sizes.
pub fn bullet_to_ansem_gross(t: u64, supply: u64, backing_amt: u64) -> Result<u64> {
    require!(supply > 0, BulletError::DivisionByZero);
    let gross = (t as u128)
        .checked_mul(backing_amt as u128)
        .ok_or(BulletError::MathOverflow)?
        .checked_div(supply as u128)
        .ok_or(BulletError::DivisionByZero)?;
    u64::try_from(gross).map_err(|_| BulletError::MathOverflow.into())
}

pub fn apply_out_fee(gross: u64) -> Result<u64> {
    let net = (gross as u128)
        .checked_mul(OUT_FEE_NUM as u128)
        .ok_or(BulletError::MathOverflow)?
        .checked_div(OUT_FEE_DEN as u128)
        .ok_or(BulletError::DivisionByZero)?;
    u64::try_from(net).map_err(|_| BulletError::MathOverflow.into())
}

pub fn protocol_fee(amount: u64) -> Result<u64> {
    let fee = (amount as u128)
        .checked_mul(PROTOCOL_FEE_BPS as u128)
        .ok_or(BulletError::MathOverflow)?
        .checked_div(BPS_DENOM as u128)
        .ok_or(BulletError::DivisionByZero)?;
    u64::try_from(fee).map_err(|_| BulletError::MathOverflow.into())
}

/// Split fee F into (pol, bribe). Backing share stays in vault (no transfer).
pub fn split_fee(fee: u64) -> Result<(u64, u64)> {
    let pol = (fee as u128)
        .checked_mul(FEE_POL_BPS as u128)
        .ok_or(BulletError::MathOverflow)?
        .checked_div(BPS_DENOM as u128)
        .ok_or(BulletError::DivisionByZero)?;
    let bribe = (fee as u128)
        .checked_mul(FEE_BRIBE_BPS as u128)
        .ok_or(BulletError::MathOverflow)?
        .checked_div(BPS_DENOM as u128)
        .ok_or(BulletError::DivisionByZero)?;
    Ok((
        u64::try_from(pol).map_err(|_| BulletError::MathOverflow)?,
        u64::try_from(bribe).map_err(|_| BulletError::MathOverflow)?,
    ))
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
    let out = (amount as u128)
        .checked_mul(bps as u128)
        .ok_or(BulletError::MathOverflow)?
        .checked_div(BPS_DENOM as u128)
        .ok_or(BulletError::DivisionByZero)?;
    u64::try_from(out).map_err(|_| BulletError::MathOverflow.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Live-ish devnet magnitudes that overflow u64 `checked_mul` before divide.
    #[test]
    fn mint_gross_survives_large_supply_product() {
        let supply = 18_743_957_435u64;
        let backing = 19_982_062_329u64;
        let s = 1_000_000_000u64; // 1000 Ansem — product overflows u64
        assert!(s.checked_mul(supply).is_none());
        let gross = ansem_to_bullet_gross(s, supply, backing + s).unwrap();
        assert_eq!(gross, (s as u128 * supply as u128 / backing as u128) as u64);
    }

    #[test]
    fn burn_gross_survives_large_backing_product() {
        let supply = 18_743_957_435u64;
        let backing = 19_982_062_329u64;
        let t = 1_000_000_000u64; // 1000 BULLET
        assert!(t.checked_mul(backing).is_none());
        let gross = bullet_to_ansem_gross(t, supply, backing).unwrap();
        assert_eq!(gross, (t as u128 * backing as u128 / supply as u128) as u64);
    }

    #[test]
    fn floor_scaled_matches_u128_formula() {
        let backing = 19_982_062_329u64;
        let supply = 18_743_957_435u64;
        let floor = floor_scaled(backing, supply).unwrap();
        assert_eq!(floor, ((backing as u128 * 1_000_000) / supply as u128) as u64);
    }
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
