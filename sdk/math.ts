/**
 * Bullet SDK helpers — client-side math mirroring on-chain formulas.
 * Backing asset (mainnet): Ansem 9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump
 */

export const ANSEM_MINT_MAINNET =
  "9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump";

export const PROTOCOL_FEE_BPS = 250n; // 2.5%
export const BPS = 10_000n;
export const OUT_FEE_NUM = 975n;
export const OUT_FEE_DEN = 1_000n;
export const LTV_BPS = 9_900n;
export const INTEREST_APY_BPS = 390n;
export const BASE_BORROW_FEE_BPS = 10n;
export const LEVERAGE_BAKE_BPS = 100n;
export const OVERCOLLAT_BPS = 100n;
export const DEFAULT_MAX_SUPPLY = 5_000_000n * 1_000_000n;

export function backing(vault: bigint, borrowed: bigint): bigint {
  return vault + borrowed;
}

export function floorScaled(backingAmt: bigint, supply: bigint): bigint {
  if (supply === 0n) return 1_000_000n;
  return (backingAmt * 1_000_000n) / supply;
}

export function protocolFee(amount: bigint): bigint {
  return (amount * PROTOCOL_FEE_BPS) / BPS;
}

export function applyOutFee(gross: bigint): bigint {
  return (gross * OUT_FEE_NUM) / OUT_FEE_DEN;
}

export function splitFee(fee: bigint): { pol: bigint; bribe: bigint; backing: bigint } {
  const pol = (fee * 1_500n) / BPS;
  const bribe = (fee * 1_500n) / BPS;
  const stay = fee - pol - bribe;
  return { pol, bribe, backing: stay };
}

export function interestFee(borrowAmt: bigint, days: number): bigint {
  const apy = (borrowAmt * INTEREST_APY_BPS * BigInt(days)) / BPS / 365n;
  const base = (borrowAmt * BASE_BORROW_FEE_BPS) / BPS;
  return apy + base;
}

export function leverageFees(ansemAmount: bigint, days: number) {
  const bakeFee = (ansemAmount * LEVERAGE_BAKE_BPS) / BPS;
  const userSpy = ansemAmount - bakeFee;
  const userBorrow = (userSpy * LTV_BPS) / BPS;
  const overCollat = (userSpy * OVERCOLLAT_BPS) / BPS;
  const interest = interestFee(userBorrow, days);
  return {
    bakeFee,
    userSpy,
    userBorrow,
    overCollat,
    interest,
    totalDue: bakeFee + interest + overCollat,
  };
}

export const SEEDS = {
  protocol: Buffer.from("protocol"),
  bulletMint: Buffer.from("bullet_mint"),
  vault: Buffer.from("vault"),
  polVault: Buffer.from("pol_vault"),
  collateralVault: Buffer.from("collateral_vault"),
  loan: Buffer.from("loan"),
} as const;
