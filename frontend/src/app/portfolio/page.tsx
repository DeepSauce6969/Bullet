"use client";

import React, { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { showTxToast } from "@/app/utils/toast";
import { TooltipInfo } from "@/app/components/TooltipInfo";
import { Skeleton } from "@/app/components/Skeleton";
import { AnimatedNumber } from "@/app/components/AnimatedNumber";
import { useBulletActions, useLoan, useTokenBalances } from "@/lib/hooks";

export default function PortfolioPage() {
  const { connected } = useWallet();
  const { setVisible } = useWalletModal();
  const { bulletBalance, refetch: refetchBalances } = useTokenBalances();
  const { loan: loanData, isLoading: isLoanLoading, refetch: refetchLoan } =
    useLoan();
  const actions = useBulletActions();
  const isExpired =
    loanData.hasLoan &&
    loanData.endTs > 0 &&
    loanData.endTs <= Math.floor(Date.now() / 1000);

  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [activeAction, setActiveAction] = useState<"none" | "repay">("none");
  const [actionAmount, setActionAmount] = useState("");

  const refetchAll = () => {
    refetchBalances();
    refetchLoan();
  };

  const executeAction = async (actionType: string) => {
    if (!connected) {
      setVisible(true);
      return;
    }

    setIsLoading(true);
    setStatusMessage("Submitting...");

    try {
      let sig: string | null = null;

      if (
        actionType === "repay" ||
        actionType === "closePosition" ||
        actionType === "flashClose"
      ) {
        if (!loanData.address) throw new Error("No active loan");
        showTxToast.info("Confirming repay...");
        sig = await actions.repay(loanData.address);
      } else if (actionType === "liquidate") {
        if (!isExpired) throw new Error("Loan has not expired yet");
        showTxToast.info("Confirming liquidation...");
        sig = await actions.liquidate(loanData.address);
      }

      if (sig) {
        setStatusMessage("Operation completed successfully!");
        showTxToast.success("Operation completed successfully!", sig);
        setActiveAction("none");
        setActionAmount("");
        refetchAll();
      }
    } catch (e: unknown) {
      const err = e as { message?: string };
      const errMsg = err?.message || "Transaction failed.";
      setStatusMessage(errMsg);
      showTxToast.error(errMsg);
    } finally {
      setIsLoading(false);
    }
  };

  const isAmountTooHigh =
    activeAction === "repay"
      ? Number(actionAmount || 0) > Number(loanData.borrowed)
      : false;

  return (
    <div className="max-w-4xl mx-auto space-y-6 py-4 px-4">
      <div className="text-center space-y-1">
        <h1 className="text-3xl font-serif font-black tracking-tight text-[var(--foreground)]">
          Portfolio
        </h1>
        <p className="text-xs font-mono text-[var(--muted)]">
          Personal Holdings & Loan Management
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="slvr-card bank-card p-5">
          <span className="text-[10px] font-mono text-[var(--muted)] uppercase tracking-widest block mb-1 flex items-center">
            BULLET Balance
            <TooltipInfo content="Your wallet balance of BULLET tokens." />
          </span>
          <div className="text-2xl font-mono font-bold text-[var(--foreground)]">
            <AnimatedNumber value={bulletBalance} />{" "}
            <span className="text-xs text-emerald-800">BULLET</span>
          </div>
        </div>

        <div className="slvr-card bank-card p-5">
          <span className="text-[10px] font-mono text-[var(--muted)] uppercase tracking-widest block mb-1 flex items-center">
            Total Debt
            <TooltipInfo content="Total borrowed Ansem across your active bullet vaults." />
          </span>
          <div className="text-2xl font-mono font-bold text-[var(--foreground)]">
            {isLoanLoading ? (
              <Skeleton className="h-8 w-28" />
            ) : (
              <AnimatedNumber value={loanData.borrowed} />
            )}{" "}
            <span className="text-xs text-[var(--muted)]">ANSEM</span>
          </div>
        </div>

        <div className="slvr-card bank-card p-5">
          <span className="text-[10px] font-mono text-[var(--muted)] uppercase tracking-widest block mb-1 flex items-center">
            Locked Collateral
            <TooltipInfo content="BULLET tokens currently locked to back your active Ansem debt." />
          </span>
          <div className="text-2xl font-mono font-bold text-[var(--accent)]">
            {isLoanLoading ? (
              <Skeleton className="h-8 w-28" />
            ) : (
              <AnimatedNumber value={loanData.collateral} />
            )}{" "}
            <span className="text-xs text-emerald-800">BULLET</span>
          </div>
        </div>
      </div>

      <div className="slvr-card bank-card p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-[var(--card-border)]/40 pb-3">
          <h2 className="text-sm font-serif font-bold text-[var(--foreground)]">
            Active Loan Contract
          </h2>
          <span
            className={`slvr-pill px-2.5 py-0.5 text-[10px] font-mono font-bold ${
              isExpired ? "text-red-700" : "text-emerald-800"
            }`}
          >
            {loanData.hasLoan ? (isExpired ? "EXPIRED" : "ACTIVE") : "NO LOANS"}
          </span>
        </div>

        {loanData.hasLoan ? (
          <div className="space-y-6">
            <div className="slvr-inset p-4 flex justify-between items-center gap-4">
              <div className="space-y-1 font-mono">
                <span className="text-lg font-bold text-[var(--foreground)]">
                  <AnimatedNumber value={loanData.borrowed} /> ANSEM
                </span>
                <p className="text-xs text-[var(--muted)]">
                  Collateral: <AnimatedNumber value={loanData.collateral} />{" "}
                  BULLET • Expiry: {loanData.endDate}
                </p>
              </div>
              <button
                onClick={() => executeAction("closePosition")}
                disabled={isLoading || isExpired}
                className="px-3.5 py-2 bg-[var(--accent)] text-[var(--accent-foreground)] rounded-xl font-bold hover:brightness-110 transition font-mono text-[10px] btn-haptic disabled:opacity-50"
              >
                CLOSE ALL
              </button>
            </div>

            {isExpired && (
              <p className="text-xs font-mono text-red-500 text-center">
                Loan expired — repay is disabled. Liquidate to burn collateral and clear the position.
              </p>
            )}

            <div className="grid grid-cols-2 gap-2 font-mono text-[10px] font-bold">
              <button
                onClick={() => {
                  setActiveAction("repay");
                  setActionAmount("");
                }}
                disabled={isExpired}
                className={`py-2 rounded-lg border btn-haptic disabled:opacity-50 ${
                  activeAction === "repay"
                    ? "bg-[var(--accent)] text-[var(--accent-foreground)] border-[var(--accent)]"
                    : "surface-pill border hover:border-[var(--accent)]"
                }`}
              >
                REPAY
              </button>
              <button
                onClick={() => executeAction("liquidate")}
                disabled={isLoading || !isExpired}
                className="py-2 rounded-lg border btn-haptic surface-pill border hover:border-red-500/50 text-red-500 disabled:opacity-50"
              >
                LIQUIDATE
              </button>
            </div>

            {activeAction !== "none" && (
              <div className="slvr-inset p-4 space-y-4 border border-[var(--card-border)]/40 bg-[var(--inset)]/60">
                <div className="flex justify-between items-center text-[10px] font-mono font-bold text-[var(--muted)] uppercase">
                  <span>Amount</span>
                  {activeAction === "repay" && (
                    <button
                      onClick={() => setActionAmount(loanData.borrowed)}
                      className="text-[var(--accent)] hover:underline"
                    >
                      Close Full Loan
                    </button>
                  )}
                </div>

                <div className="flex gap-3">
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={actionAmount}
                    onChange={(e) => setActionAmount(e.target.value)}
                    placeholder="0.0"
                    className={`flex-1 bg-[var(--inset)] border rounded-lg px-3 py-2 text-lg font-mono font-bold text-[var(--foreground)] focus:outline-none ${
                      isAmountTooHigh
                        ? "border-red-500 text-red-500"
                        : "border-[var(--card-border)]/40 focus:border-[var(--accent)]"
                    }`}
                  />
                  <button
                    onClick={() => {
                      if (
                        activeAction === "repay" &&
                        actionAmount === loanData.borrowed
                      ) {
                        executeAction("closePosition");
                      } else {
                        executeAction(activeAction);
                      }
                    }}
                    disabled={isLoading || isAmountTooHigh}
                    className="px-6 bg-[var(--accent)] text-[var(--accent-foreground)] rounded-lg font-mono font-bold text-xs hover:brightness-110 btn-haptic disabled:opacity-50 transition"
                  >
                    CONFIRM
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs font-mono text-[var(--muted)] text-center py-4">
            You do not have any active loans at the moment.
          </p>
        )}

        {statusMessage && (
          <div className="text-center font-mono text-xs font-bold text-[var(--accent)] surface-panel p-2.5 rounded-lg border border-[var(--card-border)]/40">
            {statusMessage}
          </div>
        )}
      </div>
    </div>
  );
}
