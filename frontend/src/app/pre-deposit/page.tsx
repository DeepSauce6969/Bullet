"use client";

import React, { useState, useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { showTxToast } from "@/app/utils/toast";
import { CountdownTimer } from "@/app/components/CountdownTimer";
import { VaultTierCard } from "@/app/components/VaultTierCard";
import {
  useBulletActions,
  useGenesisVaults,
  useTokenBalances,
} from "@/lib/hooks";
import { parseUnits, type GenesisVaultView } from "@/lib/bullet";

function mintPriceForFee(feePercent: number): string {
  return (1 + feePercent / 100).toFixed(4);
}

function formatCompact(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${Math.round(num / 1_000)}K`;
  return num.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export default function PreDepositPage() {
  const { connected } = useWallet();
  const { setVisible } = useWalletModal();
  const { ansemBalance, refetch: refetchBalances } = useTokenBalances();
  const { vaults, isLoading: vaultsLoading, refetch } = useGenesisVaults();
  const actions = useBulletActions();

  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [txTier, setTxTier] = useState<number | null>(null);

  const setVaultAmount = useCallback((tier: number, value: string) => {
    setAmounts((prev) => ({ ...prev, [tier]: value }));
  }, []);

  const refetchAll = () => {
    refetch();
    refetchBalances();
  };

  const handleDeposit = async (info: GenesisVaultView) => {
    if (!connected) {
      setVisible(true);
      return;
    }
    if (!info.exists || !info.presaleActive) {
      showTxToast.error("This vault is not open for deposits.");
      return;
    }
    const amount = amounts[info.tier] ?? "";
    const inputNum = Number(amount);
    if (!amount || inputNum <= 0 || Number.isNaN(inputNum)) {
      showTxToast.error("Please enter a valid amount.");
      return;
    }
    if (inputNum > info.remainingAllocation) {
      showTxToast.error(
        `Exceeds remaining allocation (${info.remainingAllocation} ANSEM).`
      );
      return;
    }
    if (inputNum > Number(ansemBalance)) {
      showTxToast.error(`Insufficient ANSEM (${ansemBalance} available).`);
      return;
    }

    setTxTier(info.tier);
    try {
      const sig = await actions.depositGenesis(
        info.tier,
        parseUnits(amount)
      );
      showTxToast.success(`Deposited ${amount} ANSEM to ${info.name}`, sig);
      setVaultAmount(info.tier, "");
      refetchAll();
    } catch (e: unknown) {
      showTxToast.error(e instanceof Error ? e.message : "Deposit failed");
    } finally {
      setTxTier(null);
    }
  };

  const handleWithdraw = async (info: GenesisVaultView) => {
    if (!connected) {
      setVisible(true);
      return;
    }
    setTxTier(info.tier);
    try {
      const sig = await actions.withdrawGenesis(info.tier);
      showTxToast.success(`Withdrew deposit from ${info.name}`, sig);
      refetchAll();
    } catch (e: unknown) {
      showTxToast.error(e instanceof Error ? e.message : "Withdraw failed");
    } finally {
      setTxTier(null);
    }
  };

  const handleClaim = async (info: GenesisVaultView) => {
    if (!connected) {
      setVisible(true);
      return;
    }
    setTxTier(info.tier);
    try {
      const sig = await actions.claimGenesis(info.tier);
      showTxToast.success(`Claimed BULLET from ${info.name}`, sig);
      refetchAll();
    } catch (e: unknown) {
      showTxToast.error(e instanceof Error ? e.message : "Claim failed");
    } finally {
      setTxTier(null);
    }
  };

  const getCardButtonState = (info: GenesisVaultView) => {
    const loading = txTier === info.tier;

    if (!connected) {
      return {
        label: "Connect Wallet",
        variant: "primary" as const,
        disabled: false,
        loading: false,
        showInput: false,
        className: "",
        action: "connect" as const,
      };
    }

    if (!info.exists) {
      return {
        label: "Vault Not Deployed",
        variant: "outline" as const,
        disabled: true,
        loading: false,
        showInput: false,
        className: "text-amber-400 border-amber-400/40 cursor-not-allowed",
        action: "none" as const,
      };
    }

    if (info.isFinalized) {
      if (info.userClaimed) {
        return {
          label: "Claimed",
          variant: "outline" as const,
          disabled: true,
          loading: false,
          showInput: false,
          className: "",
          action: "none" as const,
        };
      }
      if (info.userContribution > 0) {
        return {
          label: loading ? "Claiming..." : "Claim",
          variant: "primary" as const,
          disabled: loading,
          loading,
          showInput: false,
          className: "",
          action: "claim" as const,
        };
      }
      return {
        label: "Finalized",
        variant: "outline" as const,
        disabled: true,
        loading: false,
        showInput: false,
        className: "opacity-70 cursor-not-allowed",
        action: "none" as const,
      };
    }

    if (!info.presaleActive) {
      return {
        label: "Presale Inactive",
        variant: "outline" as const,
        disabled: true,
        loading: false,
        showInput: false,
        className: "text-amber-400 border-amber-400/40 cursor-not-allowed",
        action: "none" as const,
      };
    }

    if (loading) {
      return {
        label: "Signing...",
        variant: "primary" as const,
        disabled: true,
        loading: true,
        showInput: true,
        className: "",
        action: "deposit" as const,
      };
    }

    return {
      label: "Deposit",
      variant: "primary" as const,
      disabled: false,
      loading: false,
      showInput: true,
      className: "",
      action: "deposit" as const,
    };
  };

  const anyMissing = vaults.length > 0 && vaults.every((v) => !v.exists);

  return (
    <div className="max-w-5xl mx-auto px-4 pt-2 pb-6 sm:pt-4 sm:pb-10 space-y-8 sm:space-y-10">
      <section className="text-center space-y-6">
        <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-[var(--foreground)] tracking-wide uppercase">
          BULLET GENESIS
        </h1>
        <CountdownTimer />
      </section>

      {anyMissing && (
        <div
          role="status"
          className="rounded-xl border border-[var(--accent)]/40 bg-[rgba(101,234,126,0.08)] px-4 py-3 text-center text-sm font-mono text-[var(--foreground)]"
        >
          Genesis vault accounts are not on-chain yet. Program upgrade +{" "}
          <code className="text-[var(--accent)]">init-genesis-vaults</code>{" "}
          required (~3 SOL deploy). Deposits will work once vaults exist.
        </div>
      )}

      <section className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-5">
        {(vaults.length ? vaults : []).map((info) => {
          const btn = getCardButtonState(info);
          const isActive = info.exists && info.presaleActive && !info.isFinalized;
          const isDepositTarget = btn.action === "deposit" && btn.showInput;

          return (
            <div key={info.id} className="flex flex-col gap-2">
              <VaultTierCard
                name={info.name}
                fee={info.fee}
                isClosed={!info.presaleActive && !info.isFinalized}
                isActive={isActive}
                tvl={formatCompact(info.totalRaised)}
                depositCap={formatCompact(info.depositCap || 0)}
                progressPercent={info.progressPercent}
                yourCapLabel={
                  !connected
                    ? "—"
                    : info.userContribution > 0
                      ? `${formatCompact(info.userContribution)} in`
                      : "eligible"
                }
                yourCapEligible={connected}
                price={mintPriceForFee(info.feePercent)}
                isLoading={vaultsLoading}
                amount={
                  isDepositTarget ? (amounts[info.tier] ?? "") : undefined
                }
                onAmountChange={
                  isDepositTarget
                    ? (val) => setVaultAmount(info.tier, val)
                    : undefined
                }
                onMaxClick={
                  isDepositTarget
                    ? () =>
                        setVaultAmount(
                          info.tier,
                          Math.min(
                            Number(ansemBalance) || 0,
                            info.remainingAllocation
                          ).toString()
                        )
                    : undefined
                }
                showDepositInput={btn.showInput}
                buttonLabel={btn.label}
                buttonVariant={btn.variant}
                buttonDisabled={btn.disabled}
                buttonLoading={btn.loading}
                buttonClassName={btn.className}
                onButtonClick={(e) => {
                  e?.preventDefault?.();
                  if (btn.action === "connect") {
                    setVisible(true);
                    return;
                  }
                  if (btn.action === "deposit") void handleDeposit(info);
                  if (btn.action === "claim") void handleClaim(info);
                }}
              />
              {connected &&
                info.exists &&
                !info.isFinalized &&
                info.userContribution > 0 && (
                  <button
                    type="button"
                    disabled={txTier === info.tier}
                    onClick={() => void handleWithdraw(info)}
                    className="text-xs font-mono font-bold text-[var(--muted)] hover:text-[var(--accent)] underline disabled:opacity-50"
                  >
                    Withdraw deposit
                  </button>
                )}
            </div>
          );
        })}
      </section>
    </div>
  );
}
