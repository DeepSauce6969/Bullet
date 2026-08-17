"use client";

import React, { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { showTxToast, parseContractError } from "@/app/utils/toast";
import { AnimatedNumber } from "@/app/components/AnimatedNumber";
import { PremiumSlider } from "@/app/components/PremiumSlider";
import { ShieldCheck, RefreshCw } from "lucide-react";
import { useTokenPrices } from "@/app/hooks/useTokenPrices";
import {
  useBulletActions,
  useLoan,
  useTokenBalances,
  useProtocolMetrics,
} from "@/lib/hooks";
import { estimateInterest, parseUnits, parseBalanceNumber, maxNotionalForFeeBudget, leverageFeeBreakdown } from "@/lib/bullet";

/**
 * Effective annualized borrow cost:
 * ((Total Fees / Principal) * (365 / Duration in days)) * 100
 * Returns 0 when duration or principal is 0 (no division by zero).
 */
function calcEffectiveBorrowApr(
  totalFees: number,
  principal: number,
  durationDays: number
): number {
  if (
    durationDays <= 0 ||
    principal <= 0 ||
    !Number.isFinite(totalFees) ||
    !Number.isFinite(principal)
  ) {
    return 0;
  }
  return (totalFees / principal) * (365 / durationDays) * 100;
}

function formatAprPercent(apr: number): string {
  return `${apr.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
}

function formatExpiration(days: number): string {
  const exp = new Date();
  exp.setUTCDate(exp.getUTCDate() + days);
  exp.setUTCHours(1, 0, 0, 0);
  return exp.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatAmountInput(n: number): string {
  if (!(n > 0) || !Number.isFinite(n)) return "";
  // Keep up to 6 decimals (token precision), trim trailing zeros
  return n.toFixed(6).replace(/\.?0+$/, "");
}

export default function LoansPage() {
  const { connected } = useWallet();
  const { setVisible } = useWalletModal();
  const {
    ansemBalance,
    bulletBalance,
    isLoading: balancesLoading,
    refetch: refetchBalances,
  } = useTokenBalances();
  const { loan: loanData, refetch: refetchLoan } = useLoan();
  const { data: metrics, hasFetched: metricsReady, rpcError } =
    useProtocolMetrics();
  const actions = useBulletActions();
  const { formatSpyUsd } = useTokenPrices();

  const [mode, setMode] = useState<"borrow" | "leverage">("borrow");
  const [borrowDays, setBorrowDays] = useState(30);
  const [amount, setAmount] = useState("");
  const [activeAction, setActiveAction] = useState<"none" | "repay">("none");
  const [actionAmount, setActionAmount] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // Deep-link: /loans?mode=leverage (also used by /leverage redirect)
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get("mode") === "leverage") setMode("leverage");
    } catch {
      /* ignore */
    }
  }, []);

  const floor = Number(metrics.floorPrice) || 1;
  const hasLoan = loanData.hasLoan;
  const tradingEnabled = metrics.tradingEnabled;
  const showTradingPaused = metricsReady && !tradingEnabled;
  const isExpired =
    hasLoan &&
    loanData.endTs > 0 &&
    loanData.endTs <= Math.floor(Date.now() / 1000);

  const ansemBalNum = parseBalanceNumber(ansemBalance);
  const bulletBalNum = parseBalanceNumber(bulletBalance);

  const formatVal = (val: string | number) =>
    Number(val).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    });

  /** Max Ansem borrowable from BULLET collateral at 99% LTV */
  const maxBorrowableAnsem = useMemo(() => {
    if (bulletBalNum <= 0 || floor <= 0) return "0";
    return (bulletBalNum * floor * 0.99).toFixed(4);
  }, [bulletBalNum, floor]);

  /**
   * BakerDAO-style looping: input = target loop size (notional ANSEM),
   * NOT the fee budget. User pays bake + interest + over-collat only.
   * MAX LOOP = largest notional affordable with wallet ANSEM.
   */
  const handleMaxLoop = async () => {
    if (!connected) {
      setVisible(true);
      return;
    }
    const bal = await refetchBalances();
    const available = parseBalanceNumber(bal?.ansem ?? ansemBalance);
    const max = maxNotionalForFeeBudget(available, borrowDays);
    const next = formatAmountInput(max);
    if (!next) {
      showTxToast.error(
        "No mock ANSEM in this wallet. Claim test ANSEM on Mint & Burn first (devnet faucet)."
      );
      return;
    }
    setAmount(next);
  };

  const borrowBreakdown = useMemo(() => {
    const zero = {
      expirationLabel: "—",
      collateralBullet: "0.0000",
      collateralAnsemEq: "0.0000",
      loanAmount: "0.0000",
      interestFee: "0.0000",
      totalReceived: "0.0000",
    };

    if (!amount || Number(amount) <= 0) {
      return { ...zero, expirationLabel: formatExpiration(borrowDays) };
    }

    const amt = Number(amount);
    const interest = Number(estimateInterest(amt, borrowDays));
    const loanAmount = amt;
    // Interest paid upfront from wallet; user receives full borrow principal
    const totalReceived = amt;
    const safeFloor = floor > 0 ? floor : 1;
    const collateralBullet = amt / (safeFloor * 0.99);
    const collateralAnsemEq = amt / 0.99;

    return {
      expirationLabel: formatExpiration(borrowDays),
      collateralBullet: collateralBullet.toFixed(4),
      collateralAnsemEq: collateralAnsemEq.toFixed(4),
      loanAmount: loanAmount.toFixed(4),
      interestFee: interest.toFixed(4),
      totalReceived: totalReceived.toFixed(4),
    };
  }, [amount, borrowDays, floor]);

  const leverageBreakdown = useMemo(() => {
    const zero = {
      expirationLabel: "—",
      leveragedPosition: "0.0000",
      loanAmount: "0.0000",
      mintFee: "0.0000",
      interestFee: "0.0000",
      overCollat: "0.0000",
      totalRequired: "0.0000",
      leverageMultiple: "0",
      notional: "0.0000",
    };

    const notional = parseBalanceNumber(amount);
    if (notional <= 0) {
      return { ...zero, expirationLabel: formatExpiration(borrowDays) };
    }

    // BakerDAO: input A → bakeFee, userAnsem=A-bake, borrow=99%, pay fees only
    const fees = leverageFeeBreakdown(notional, borrowDays);
    const safeFloor = floor > 0 ? floor : 1;
    const leveragedPosition = fees.userAnsem / safeFloor;
    // Inclusive leverage ≈ position / total payable (BakerDAO example)
    const leverageMultiple =
      fees.totalRequired > 0
        ? (fees.userAnsem / fees.totalRequired).toFixed(2)
        : "0";

    return {
      expirationLabel: formatExpiration(borrowDays),
      leveragedPosition: leveragedPosition.toFixed(4),
      loanAmount: fees.loanAmount.toFixed(4),
      mintFee: fees.bakeFee.toFixed(4),
      interestFee: fees.interest.toFixed(4),
      overCollat: fees.overCollat.toFixed(4),
      totalRequired: fees.totalRequired.toFixed(4),
      leverageMultiple,
      notional: notional.toFixed(4),
    };
  }, [amount, borrowDays, floor]);

  const insufficientBulletCollateral = useMemo(() => {
    if (mode !== "borrow" || !amount || Number(amount) <= 0) return false;
    return bulletBalNum < Number(borrowBreakdown.collateralBullet);
  }, [mode, amount, bulletBalNum, borrowBreakdown.collateralBullet]);

  const insufficientLeverageFees = useMemo(() => {
    if (mode !== "leverage" || !amount || Number(amount) <= 0) return false;
    const due = Number(leverageBreakdown.totalRequired);
    return due > ansemBalNum + 1e-9;
  }, [mode, amount, ansemBalNum, leverageBreakdown.totalRequired]);

  const estimatedBorrowApr = useMemo(() => {
    if (!amount || Number(amount) <= 0 || borrowDays <= 0) return 0;

    if (mode === "borrow") {
      const interest = Number(borrowBreakdown.interestFee);
      const principal = Number(borrowBreakdown.loanAmount);
      const mintFee = 0;
      return calcEffectiveBorrowApr(mintFee + interest, principal, borrowDays);
    }

    // BakerDAO shows Borrow APR on the loan principal
    const interest = Number(leverageBreakdown.interestFee);
    const principal = Number(leverageBreakdown.loanAmount);
    return calcEffectiveBorrowApr(interest, principal, borrowDays);
  }, [amount, borrowDays, mode, borrowBreakdown, leverageBreakdown]);

  const refetchAll = () => {
    refetchBalances();
    refetchLoan();
  };

  const handleCreateLoan = async () => {
    if (!connected) {
      setVisible(true);
      return;
    }
    if (showTradingPaused) {
      showTxToast.error("Trading is currently disabled on the protocol.");
      return;
    }
    if (hasLoan) {
      showTxToast.error("Use account with no loans");
      return;
    }
    if (!amount || Number(amount) <= 0) {
      showTxToast.error("Please enter a valid amount.");
      return;
    }
    // Borrowable / BULLET LTV checks apply to simple borrow only.
    if (mode === "borrow") {
      if (Number(amount) > Number(maxBorrowableAnsem)) {
        showTxToast.error(
          `Amount exceeds max borrowable (${maxBorrowableAnsem} ANSEM).`
        );
        return;
      }
      if (insufficientBulletCollateral) {
        showTxToast.error(
          `Insufficient BULLET collateral (need ${borrowBreakdown.collateralBullet} BULLET).`
        );
        return;
      }
    } else {
      // Input = target loop size (notional). Wallet must cover Total Payable fees.
      const notional = parseBalanceNumber(amount);
      const bal = await refetchBalances();
      const available = parseBalanceNumber(bal?.ansem ?? ansemBalance);
      const fees = leverageFeeBreakdown(notional, borrowDays);
      if (fees.totalRequired > available + 1e-9) {
        showTxToast.error(
          `Not enough ANSEM for fees (need ${fees.totalRequired.toFixed(4)}, have ${available.toFixed(4)}). Lower loop size or claim test ANSEM.`
        );
        return;
      }
      if (borrowDays < 1 || borrowDays > 365) {
        showTxToast.error("Loan duration must be between 1 and 365 days.");
        return;
      }

      setIsLoading(true);
      try {
        const raw = parseUnits(formatAmountInput(notional) || amount);
        const sig = await actions.leverage(raw, borrowDays);
        showTxToast.success("Leverage position opened!", sig);
        setAmount("");
        refetchAll();
      } catch (e: unknown) {
        const parsed = parseContractError(e);
        showTxToast.error(parsed.message || "Loan failed");
      } finally {
        setIsLoading(false);
      }
      return;
    }
    if (borrowDays < 1 || borrowDays > 365) {
      showTxToast.error("Loan duration must be between 1 and 365 days.");
      return;
    }

    setIsLoading(true);
    try {
      const raw = parseUnits(amount);
      const sig = await actions.borrow(raw, borrowDays);

      showTxToast.success("Loan created successfully!", sig);
      setAmount("");
      refetchAll();
    } catch (e: unknown) {
      const parsed = parseContractError(e);
      showTxToast.error(parsed.message || "Loan failed");
    } finally {
      setIsLoading(false);
    }
  };

  const handleManageLoan = async (_actionType: string) => {
    if (!connected) {
      setVisible(true);
      return;
    }
    if (!loanData.address) {
      showTxToast.error("No active loan found");
      return;
    }
    if (isExpired) {
      showTxToast.error("Loan expired — use Liquidate instead of repay.");
      return;
    }
    setIsLoading(true);
    try {
      const sig = await actions.repay(loanData.address);
      showTxToast.success(
        _actionType === "closePosition"
          ? "Loan position closed!"
          : "Repayment successful!",
        sig
      );
      setActiveAction("none");
      setActionAmount("");
      refetchAll();
    } catch (e: unknown) {
      showTxToast.error(e instanceof Error ? e.message : "Repay failed");
    } finally {
      setIsLoading(false);
    }
  };

  const handleLiquidate = async () => {
    if (!connected) {
      setVisible(true);
      return;
    }
    if (!loanData.address) {
      showTxToast.error("No active loan found");
      return;
    }
    if (!isExpired) {
      showTxToast.error("Loan has not expired yet.");
      return;
    }
    setIsLoading(true);
    try {
      const sig = await actions.liquidate(loanData.address);
      showTxToast.success("Loan liquidated!", sig);
      refetchAll();
    } catch (e: unknown) {
      showTxToast.error(e instanceof Error ? e.message : "Liquidation failed");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6 py-4 px-4">
      <div className="text-left space-y-1 border-b border-[var(--card-border)]/10 pb-4">
        <h1 className="text-3xl font-serif font-black text-[var(--foreground)]">
          Bullet Vaults & Leverage
        </h1>
        <p className="text-xs font-mono text-[var(--muted)]">
          Borrow liquid Ansem backed by BULLET or open automated leveraged
          positions.
        </p>
        {!showTradingPaused && rpcError && (
          <p className="text-xs font-mono text-amber-600 pt-2">
            {rpcError}
          </p>
        )}
        {showTradingPaused && (
          <p className="text-xs font-mono text-amber-600 pt-2">
            Trading is paused — new borrows, leverage, mint, and burn are disabled until the protocol re-enables trading.
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 slvr-card bank-card p-6 space-y-5">
          <div className="slvr-inset p-1 flex font-mono text-xs font-bold border border-[var(--card-border)]/10">
            <button
              onClick={() => {
                setMode("borrow");
                setAmount("");
              }}
              className={`flex-1 py-2.5 rounded-lg btn-haptic ${
                mode === "borrow"
                  ? "bg-gradient-to-r from-[var(--accent)] to-[var(--accent-dark)] text-[var(--accent-foreground)] shadow-sm"
                  : "text-[var(--muted)] hover:text-[var(--foreground)]"
              }`}
            >
              SIMPLE BORROW
            </button>
            <button
              onClick={() => {
                setMode("leverage");
                setAmount("");
              }}
              className={`flex-1 py-2.5 rounded-lg btn-haptic ${
                mode === "leverage"
                  ? "bg-gradient-to-r from-[var(--accent)] to-[var(--accent-dark)] text-[var(--accent-foreground)] shadow-sm"
                  : "text-[var(--muted)] hover:text-[var(--foreground)]"
              }`}
            >
              1-CLICK LOOP
            </button>
          </div>

          <div className="space-y-5">
            <div className="surface-panel p-5 sm:p-6 rounded-2xl">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-[var(--foreground)]">
                  {mode === "borrow" ? "You borrow" : "Total Ansem to loop"}
                </span>
                <span className="text-sm text-[var(--muted)]">
                  ~${formatSpyUsd(amount || 0)}
                </span>
              </div>

              <div className="flex items-center justify-between mt-4 gap-3">
                <div className="flex items-center shrink-0">
                  <Image
                    src="/ansem-logo.png"
                    alt="ANSEM"
                    width={32}
                    height={32}
                    className="w-8 h-8 rounded-full object-cover"
                  />
                  <span className="text-xl font-bold ml-2 text-[var(--foreground)]">
                    ANSEM
                  </span>
                </div>
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0"
                  step="any"
                  min="0"
                  className="text-3xl sm:text-4xl font-mono text-right bg-transparent outline-none w-1/2 min-w-0 focus:ring-0 placeholder-[var(--muted)] text-[var(--foreground)]"
                />
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mt-6">
                {mode === "borrow" ? (
                  <span className="text-xs text-[var(--muted)]">
                    Max borrowable: {formatVal(maxBorrowableAnsem)} ANSEM (~$
                    {formatSpyUsd(maxBorrowableAnsem)})
                  </span>
                ) : (
                  <span className="hidden sm:block" aria-hidden />
                )}
                <div className="flex items-center gap-2 shrink-0 sm:ml-auto">
                  {mode === "borrow" ? (
                    <button
                      type="button"
                      onClick={() => setAmount(maxBorrowableAnsem)}
                      className="px-4 py-1.5 rounded-full surface-pill border text-sm font-medium hover:brightness-95 transition-colors"
                    >
                      MAX
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleMaxLoop}
                      disabled={balancesLoading}
                      className="px-4 py-1.5 rounded-full surface-pill border text-sm font-medium hover:brightness-95 transition-colors disabled:opacity-50"
                    >
                      MAX LOOP
                    </button>
                  )}
                  <Link
                    href="/mint-and-burn"
                    className="px-4 py-1.5 rounded-full surface-pill border text-sm font-medium hover:brightness-95 transition-colors"
                  >
                    Get $ANSEM
                  </Link>
                </div>
              </div>
            </div>

            <div className="surface-panel p-5 sm:p-6 rounded-2xl">
              <span className="text-sm font-semibold text-[var(--foreground)] block">
                Choose your loan duration
              </span>

              <div className="flex items-center justify-between mt-4 mb-4 gap-3">
                <button
                  type="button"
                  onClick={() => setBorrowDays(1)}
                  className="px-4 py-1.5 rounded-full surface-pill border text-sm font-medium hover:brightness-95 transition-colors shrink-0"
                >
                  MIN
                </button>

                <div className="text-[var(--muted)] text-center">
                  <span className="text-2xl font-bold text-[var(--foreground)]">
                    {borrowDays}
                  </span>{" "}
                  days
                </div>

                <button
                  type="button"
                  onClick={() => setBorrowDays(365)}
                  className="px-4 py-1.5 rounded-full surface-pill border text-sm font-medium hover:brightness-95 transition-colors shrink-0"
                >
                  MAX
                </button>
              </div>

              <div className="px-1">
                <PremiumSlider
                  min={1}
                  max={365}
                  value={borrowDays}
                  onValueChange={(val) => setBorrowDays(val)}
                />
              </div>

              <div className="flex justify-between items-center mt-6 pt-4 border-t border-[var(--card-border)]/40">
                <span className="font-semibold text-[var(--foreground)] text-base">
                  Estimated Borrow APR
                </span>
                <span className="font-bold text-lg text-[var(--accent)]">
                  {formatAprPercent(estimatedBorrowApr)}
                </span>
              </div>

              {mode === "borrow" ? (
                <div className="flex items-center gap-2 mt-3 text-sm font-medium text-[var(--accent)]">
                  <ShieldCheck className="w-4 h-4 shrink-0" aria-hidden />
                  <span>Borrow up to 99% LTV</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 mt-3 text-sm font-medium text-[var(--accent)]">
                  <RefreshCw className="w-4 h-4 shrink-0" aria-hidden />
                  <span>
                    1-click loop — enter target size; you only pay bake + interest +
                    over-collat
                  </span>
                </div>
              )}
            </div>
          </div>

          {Number(amount) > 0 &&
            (mode === "borrow" ? (
              <div className="space-y-3 px-1 animate-fade-in">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-[var(--muted)] flex items-center gap-1.5">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 16 16"
                      fill="currentColor"
                      className="w-3.5 h-3.5 text-[var(--muted)] shrink-0"
                      aria-hidden
                    >
                      <path d="M3.5 0a.5.5 0 0 1 .5.5V1h8V.5a.5.5 0 0 1 1 0V1h1a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2h1V.5a.5.5 0 0 1 .5-.5M2 4v10h12V4z" />
                    </svg>
                    Expiration Date
                  </span>
                  <span className="font-medium text-[var(--foreground)]">
                    {borrowBreakdown.expirationLabel}
                  </span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-[var(--muted)]">Collateral required</span>
                  <span className="font-medium text-[var(--foreground)] text-right">
                    {formatVal(borrowBreakdown.collateralBullet)} BULLET{" "}
                    <span className="text-[var(--muted)]">
                      ({formatVal(borrowBreakdown.collateralAnsemEq)} ANSEM)
                    </span>
                  </span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-[var(--muted)]">Loan amount</span>
                  <span className="font-medium text-[var(--foreground)]">
                    {formatVal(borrowBreakdown.loanAmount)} ANSEM
                  </span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-[var(--muted)]">
                    Interest Fee{" "}
                    <span className="text-[var(--muted)] text-xs">
                      (paid upfront)
                    </span>
                  </span>
                  <span className="font-medium text-[var(--foreground)]">
                    {formatVal(borrowBreakdown.interestFee)} ANSEM
                  </span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-[var(--muted)]">Total Received</span>
                  <span className="font-medium text-[var(--foreground)]">
                    {formatVal(borrowBreakdown.totalReceived)} ANSEM
                  </span>
                </div>
              </div>
            ) : (
              <div className="surface-panel p-5 sm:p-6 rounded-2xl space-y-2.5 animate-fade-in">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-[var(--muted)] flex items-center gap-1.5">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 16 16"
                      fill="currentColor"
                      className="w-3.5 h-3.5 text-[var(--muted)]"
                      aria-hidden
                    >
                      <path d="M3.5 0a.5.5 0 0 1 .5.5V1h8V.5a.5.5 0 0 1 1 0V1h1a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2h1V.5a.5.5 0 0 1 .5-.5M2 4v10h12V4z" />
                    </svg>
                    Expiration Date
                  </span>
                  <span className="font-medium text-[var(--foreground)]">
                    {leverageBreakdown.expirationLabel}
                  </span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-[var(--muted)]">Recorded Borrow Amount</span>
                  <span className="font-medium text-[var(--foreground)]">
                    {formatVal(leverageBreakdown.loanAmount)} ANSEM
                  </span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-[var(--muted)]">Leverage Baking Fee</span>
                  <span className="font-medium text-[var(--foreground)]">
                    {formatVal(leverageBreakdown.mintFee)} ANSEM
                  </span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-[var(--muted)]">Interest Fee</span>
                  <span className="font-medium text-[var(--foreground)]">
                    {formatVal(leverageBreakdown.interestFee)} ANSEM
                  </span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-[var(--muted)]">
                    Over-collateralization Amount
                  </span>
                  <span className="font-medium text-[var(--foreground)]">
                    {formatVal(leverageBreakdown.overCollat)} ANSEM
                  </span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-[var(--muted)]">Leveraged Position</span>
                  <span className="font-medium text-[var(--foreground)] text-right">
                    {formatVal(leverageBreakdown.leveragedPosition)} BULLET{" "}
                    <span className="text-[var(--muted)] text-xs">
                      ({leverageBreakdown.leverageMultiple}x)
                    </span>
                  </span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-[var(--muted)]">Total Payable</span>
                  <span className="font-bold text-[var(--foreground)]">
                    {formatVal(leverageBreakdown.totalRequired)} ANSEM
                  </span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-[var(--muted)]">Available ANSEM Balance</span>
                  <span className="font-medium text-[var(--foreground)]">
                    {formatVal(ansemBalNum)} ANSEM
                  </span>
                </div>
              </div>
            ))}

          {hasLoan && (
            <div className="p-3 bg-[rgba(101,234,126,0.1)] rounded-xl border border-[var(--accent)]/35 font-mono text-xs text-[var(--accent)] font-bold text-center">
              ⚠️ You already have an active loan. Repay or close your current
              loan before opening a new one.
            </div>
          )}

          <button
            onClick={handleCreateLoan}
            disabled={
              isLoading ||
              !amount ||
              Number(amount) <= 0 ||
              (mode === "borrow" &&
                (showTradingPaused ||
                  hasLoan ||
                  Number(amount) > Number(maxBorrowableAnsem) ||
                  insufficientBulletCollateral)) ||
              (mode === "leverage" &&
                (showTradingPaused ||
                  hasLoan ||
                  insufficientLeverageFees ||
                  parseBalanceNumber(amount) <= 0))
            }
            className="w-full py-4 rounded-full btn-primary font-mono font-bold text-xs tracking-wider uppercase disabled:opacity-50"
          >
            {!connected
              ? "CONNECT WALLET"
              : showTradingPaused
                ? "TRADING PAUSED"
                : hasLoan
                  ? "USE ACCOUNT WITH NO LOANS"
                  : mode === "borrow" &&
                      Number(amount) > Number(maxBorrowableAnsem)
                    ? "EXCEEDS MAX BORROWABLE"
                    : mode === "borrow" && insufficientBulletCollateral
                      ? "INSUFFICIENT BULLET COLLATERAL"
                      : mode === "leverage" && insufficientLeverageFees
                        ? "INSUFFICIENT ANSEM FOR FEES"
                        : mode === "borrow"
                          ? "EXECUTE BORROW"
                          : "LOOP"}
          </button>
        </div>

        <div className="lg:col-span-5 flex flex-col justify-start gap-3">
          <div className="slvr-card bank-card p-6 space-y-4">
            <div className="border-b border-[var(--card-border)]/10 pb-3 flex justify-between items-center">
              <h3 className="text-sm font-serif font-bold text-[var(--foreground)]">
                Your Active Loans
              </h3>
              <span
                className={`slvr-pill px-2 py-0.5 text-[10px] font-mono font-bold ${
                  isExpired ? "text-red-600" : "text-[var(--accent-dark)]"
                }`}
              >
                {loanData.hasLoan ? (isExpired ? "EXPIRED" : "ACTIVE") : "NO LOANS"}
              </span>
            </div>

            {loanData.hasLoan ? (
              <div className="space-y-4 font-mono">
                <div className="slvr-inset p-3.5 flex justify-between items-center">
                  <div className="space-y-1">
                    <span className="text-[10px] text-[var(--muted)] uppercase block">
                      Total Debt
                    </span>
                    <span className="text-lg font-bold text-[var(--foreground)]">
                      <AnimatedNumber value={loanData.borrowed} /> ANSEM
                    </span>
                  </div>
                  <button
                    onClick={() => handleManageLoan("closePosition")}
                    disabled={isLoading || isExpired}
                    className="px-2.5 py-1 btn-primary rounded-lg font-bold text-[10px] btn-haptic disabled:opacity-50"
                  >
                    CLOSE ALL
                  </button>
                </div>

                <div className="slvr-inset p-3.5 space-y-1 text-xs">
                  <div className="flex justify-between text-[var(--muted)]">
                    <span>Locked Collateral:</span>
                    <span className="font-bold text-[var(--foreground)]">
                      {formatVal(loanData.collateral)} BULLET
                    </span>
                  </div>
                  <div className="flex justify-between text-[var(--muted)]">
                    <span>Expiry Date:</span>
                    <span className="font-bold text-[var(--foreground)]">
                      {loanData.endDate}
                    </span>
                  </div>
                </div>

                {isExpired && (
                  <p className="text-[10px] font-mono text-red-500 text-center">
                    Loan expired — repay is disabled. Any wallet can liquidate.
                  </p>
                )}

                <div className="grid grid-cols-1 gap-2 text-[10px] font-bold">
                  <button
                    onClick={() => {
                      setActiveAction("repay");
                      setActionAmount("");
                    }}
                    disabled={isExpired}
                    className={`py-2 rounded-lg border btn-haptic disabled:opacity-50 ${
                      activeAction === "repay"
                        ? "bg-gradient-to-r from-[var(--accent)] to-[var(--accent-dark)] text-[var(--accent-foreground)]"
                        : "bg-[var(--inset)] text-[var(--foreground)]"
                    }`}
                  >
                    REPAY LOAN
                  </button>
                  {isExpired && (
                    <button
                      onClick={handleLiquidate}
                      disabled={isLoading}
                      className="py-2 rounded-lg border border-red-500/40 text-red-500 btn-haptic disabled:opacity-50"
                    >
                      LIQUIDATE EXPIRED LOAN
                    </button>
                  )}
                </div>

                {activeAction === "repay" && (
                  <div className="slvr-inset p-3 space-y-3 border border-[var(--card-border)]/20">
                    <div className="flex justify-between text-[10px] font-bold text-[var(--muted)] uppercase">
                      <span>Repay Amount</span>
                      <button
                        onClick={() => setActionAmount(loanData.borrowed)}
                        className="text-[var(--foreground)] underline"
                      >
                        Close Entire Position
                      </button>
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        value={actionAmount}
                        onChange={(e) => setActionAmount(e.target.value)}
                        placeholder="0.0"
                        className="flex-1 bg-[var(--inset)] border border-[var(--card-border)]/50 rounded text-[var(--foreground)] px-2 py-1 text-sm font-bold focus:outline-none"
                      />
                      <button
                        onClick={() =>
                          handleManageLoan(
                            actionAmount === loanData.borrowed
                              ? "closePosition"
                              : "repay"
                          )
                        }
                        disabled={isLoading}
                        className="px-3 bg-gradient-to-r from-[var(--accent)] to-[var(--accent-dark)] text-[var(--accent-foreground)] rounded text-xs font-bold btn-haptic disabled:opacity-50"
                      >
                        CONFIRM
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs font-mono text-[var(--muted)] text-center py-6">
                You currently have no open loans or active leverage positions.
              </p>
            )}

            <div className="slvr-inset p-3.5 space-y-2 font-mono text-xs border-t border-[var(--card-border)]/5">
              <div className="flex justify-between text-[var(--muted)]">
                <span>BULLET Wallet Balance:</span>
                <span className="font-bold text-[var(--foreground)]">
                  {formatVal(bulletBalance)} BULLET
                </span>
              </div>
              <div className="flex justify-between text-[var(--muted)]">
                <span>ANSEM Wallet Balance:</span>
                <span className="font-bold text-[var(--foreground)]">
                  {formatVal(ansemBalance)} ANSEM
                </span>
              </div>
            </div>
          </div>

          <div className="slvr-card bank-card p-5 font-mono text-xs space-y-2 bg-[var(--inset)]/40">
            <span className="font-bold text-[var(--foreground)] block">
              No Price Liquidation Risk
            </span>
            <p className="text-[var(--muted)] text-[11px] leading-relaxed">
              BULLET loans utilize strict 100% floor backing. You can safely
              borrow liquid Ansem without market price liquidations.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
