"use client";

import React, { useState, useEffect } from "react";
import Image from "next/image";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { showTxToast, parseContractError } from "@/app/utils/toast";
import { AnimatedNumber } from "@/app/components/AnimatedNumber";
import { BulletPricePanel } from "@/app/components/BulletPricePanel";
import { useTokenPrices } from "@/app/hooks/useTokenPrices";
import {
  useBulletActions,
  useProtocolMetrics,
  useTokenBalances,
} from "@/lib/hooks";
import {
  estimateBurnReceive,
  estimateMintReceive,
  parseUnits,
} from "@/lib/bullet";

const SWAP_TOAST_ID = "swap-tx";

const PILL_BTN =
  "px-3 py-1 rounded-full surface-pill border text-xs font-medium hover:brightness-110 transition-colors";

function TokenBadge({ symbol }: { symbol: "ANSEM" | "BULLET" }) {
  if (symbol === "ANSEM") {
    return (
      <div className="flex items-center shrink-0">
        <Image
          src="/ansem-logo.png"
          alt="ANSEM"
          width={32}
          height={32}
          className="w-8 h-8 rounded-full object-cover"
        />
        <span className="text-xl font-bold ml-2 text-[var(--foreground)]">ANSEM</span>
      </div>
    );
  }
  return (
    <div className="flex items-center shrink-0">
      <Image
        src="/BULLET.png"
        alt="BULLET"
        width={32}
        height={32}
        className="w-8 h-8 rounded-full object-cover bg-black"
      />
      <span className="text-xl font-bold ml-2 text-[var(--foreground)]">BULLET</span>
    </div>
  );
}

export default function MintAndBurnPage() {
  const { connected, publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const { data: metrics, refetch: refetchMetrics } = useProtocolMetrics();
  const { ansemBalance, bulletBalance, refetch: refetchBalances } =
    useTokenBalances();
  const actions = useBulletActions();
  const [faucetLoading, setFaucetLoading] = useState(false);

  const [isMinting, setIsMinting] = useState(true);
  const [amount, setAmount] = useState("");
  const [estimatedReceive, setEstimatedReceive] = useState("0");
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  const {
    protocolBulletUsd,
    marketBulletUsd,
    marketBulletInSpy,
    backingRatioPct,
    isLoadingFloor,
    isLoadingMarket,
    isIndicativeUsd,
    arbitrageSpreadPct,
    arbitrageHint,
    arbitrageDirection,
    formatSpyUsd,
    formatBulletUsd,
  } = useTokenPrices();

  const floorPrice = metrics.floorPrice;
  const tradingEnabled = metrics.tradingEnabled;
  const payToken: "ANSEM" | "BULLET" = isMinting ? "ANSEM" : "BULLET";
  const receiveToken: "ANSEM" | "BULLET" = isMinting ? "BULLET" : "ANSEM";
  const payBalance = isMinting ? ansemBalance : bulletBalance;
  const receiveBalance = isMinting ? bulletBalance : ansemBalance;

  const refetchAll = () => {
    refetchBalances();
    refetchMetrics();
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!amount || Number(amount) <= 0) {
        setEstimatedReceive("0");
        return;
      }
      const fp = Number(floorPrice) || 1;
      if (isMinting) {
        setEstimatedReceive(estimateMintReceive(Number(amount), fp));
      } else {
        setEstimatedReceive(estimateBurnReceive(Number(amount), fp));
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [amount, isMinting, floorPrice]);

  const setHalf = () => {
    const bal = Number(payBalance || "0");
    if (bal <= 0) return;
    setAmount((bal / 2).toFixed(4));
  };

  const setMax = () => {
    const bal = Number(payBalance || "0");
    if (bal <= 0) return;
    setAmount(bal.toFixed(4));
  };

  const flipDirection = () => {
    setIsMinting((v) => !v);
    setAmount("");
    setEstimatedReceive("0");
  };

  const handleExecute = async () => {
    if (!connected) {
      setVisible(true);
      return;
    }
    if (!tradingEnabled) {
      showTxToast.error("Trading is currently disabled on the protocol.");
      return;
    }
    if (!amount || Number(amount) <= 0) {
      showTxToast.error("Please enter a valid amount.");
      return;
    }
    if (Number(amount) > Number(payBalance)) {
      showTxToast.error("Insufficient balance.");
      return;
    }

    setIsLoading(true);
    setStatusMessage(isMinting ? "Confirming Mint..." : "Confirming Burn...");
    showTxToast.loading(
      isMinting
        ? "Loading... Minting BULLET. Sign in your wallet."
        : "Loading... Burning BULLET. Sign in your wallet.",
      SWAP_TOAST_ID
    );

    try {
      const raw = parseUnits(amount);
      const sig = isMinting ? await actions.mint(raw) : await actions.burn(raw);

      setStatusMessage(isMinting ? "Mint Successful!" : "Burn Successful!");
      showTxToast.success(
        isMinting ? "BULLET minted successfully!" : "BULLET burned successfully!",
        sig,
        SWAP_TOAST_ID
      );
      setAmount("");
      refetchAll();
    } catch (error: unknown) {
      const parsed = parseContractError(error);
      setStatusMessage(parsed.message);
      showTxToast.error(parsed.message, SWAP_TOAST_ID);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFaucet = async () => {
    if (!publicKey) {
      setVisible(true);
      return;
    }
    setFaucetLoading(true);
    try {
      const res = await fetch("/api/faucet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: publicKey.toBase58() }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Faucet failed");
      showTxToast.success("Received 10,000 test Ansem", json.signature);
      refetchBalances();
    } catch (e: unknown) {
      showTxToast.error(e instanceof Error ? e.message : "Faucet failed");
    } finally {
      setFaucetLoading(false);
    }
  };

  const isAmountTooHigh = Number(amount || "0") > Number(payBalance);
  const isButtonDisabled =
    isLoading ||
    isAmountTooHigh ||
    !amount ||
    Number(amount) <= 0 ||
    !tradingEnabled;

  const buttonText = !connected
    ? "Connect Wallet"
    : !tradingEnabled
      ? "Trading Paused"
    : isLoading
      ? "Processing..."
      : isAmountTooHigh
        ? "Insufficient Balance"
        : isMinting
          ? "Mint BULLET"
          : "Burn BULLET";

  const getUsdValue = (val: string, tokenIsBullet: boolean) =>
    tokenIsBullet ? formatBulletUsd(val) : formatSpyUsd(val);

  return (
    <div className="max-w-[640px] mx-auto space-y-6 py-4 px-4">
      <BulletPricePanel
        protocolBulletInSpy={floorPrice}
        protocolBulletUsd={protocolBulletUsd}
        marketBulletInSpy={marketBulletInSpy}
        marketBulletUsd={marketBulletUsd}
        backingRatioPct={backingRatioPct}
        isLoadingProtocol={isLoadingFloor}
        isLoadingMarket={isLoadingMarket}
        isIndicativeUsd={isIndicativeUsd}
        arbitrageSpreadPct={arbitrageSpreadPct}
        arbitrageHint={arbitrageHint}
        arbitrageDirection={arbitrageDirection}
      />

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--accent-dark)]/15 bg-[var(--inset)]/40 px-4 py-3">
        <span className="text-xs font-mono text-[var(--muted)]">
          Devnet faucet — claim mock Ansem to mint
        </span>
        <button
          type="button"
          disabled={!connected || faucetLoading}
          onClick={handleFaucet}
          className="px-3 py-1.5 rounded-full bg-[var(--accent-dark)] text-white text-[10px] font-mono font-bold btn-haptic disabled:opacity-50"
        >
          {faucetLoading ? "…" : "CLAIM TEST ANSEM"}
        </button>
      </div>

      {!tradingEnabled && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs font-mono text-amber-700">
          Trading is paused — mint and burn are disabled until the protocol re-enables trading.
        </div>
      )}

      <div className="slvr-card bank-card p-5 sm:p-6 space-y-0">
        <h2 className="text-lg font-semibold text-[var(--foreground)] mb-5">Mint / Burn $BULLET</h2>

        <div className="surface-panel rounded-2xl p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <span className="text-sm text-[var(--muted)]">You pay</span>
            <span className="text-sm text-[var(--muted)]">
              ~${getUsdValue(amount, payToken === "BULLET")}
            </span>
          </div>

          <div className="flex items-center justify-between mt-3 gap-3">
            <TokenBadge symbol={payToken} />
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              step="any"
              min="0"
              className={`text-3xl sm:text-4xl font-mono text-right bg-transparent outline-none w-1/2 min-w-0 focus:ring-0 placeholder-gray-300 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${
                isAmountTooHigh ? "text-red-500" : "text-[var(--foreground)]"
              }`}
            />
          </div>

          <div className="flex items-center justify-between mt-4 gap-2">
            <span className="text-xs text-[var(--muted)]">
              Available: <AnimatedNumber value={payBalance} /> {payToken}
            </span>
            <div className="flex items-center gap-2">
              <button type="button" onClick={setHalf} className={PILL_BTN}>
                HALF
              </button>
              <button type="button" onClick={setMax} className={PILL_BTN}>
                MAX
              </button>
            </div>
          </div>
        </div>

        <div className="relative z-10 flex justify-center -my-3">
          <button
            type="button"
            onClick={flipDirection}
            aria-label="Flip mint/burn direction"
            className="w-10 h-10 rounded-xl bg-[var(--inset)] border border-[var(--card-border)]/50 flex items-center justify-center text-[var(--foreground)] hover:bg-[var(--stone)]/40 transition-colors shadow-sm"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-5 h-5"
            >
              <path d="M7 10V3M7 3L4 6M7 3l3 3" />
              <path d="M17 14v7M17 21l3-3M17 21l-3-3" />
            </svg>
          </button>
        </div>

        <div className="surface-panel rounded-2xl p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <span className="text-sm text-[var(--muted)]">You receive</span>
            <span className="text-sm text-[var(--muted)]">
              ~${getUsdValue(estimatedReceive, receiveToken === "BULLET")}
            </span>
          </div>

          <div className="flex items-center justify-between mt-3 gap-3">
            <TokenBadge symbol={receiveToken} />
            <input
              type="number"
              value={estimatedReceive}
              readOnly
              className="text-3xl sm:text-4xl font-mono text-right bg-transparent outline-none w-1/2 min-w-0 text-[var(--foreground)] [appearance:textfield]"
            />
          </div>

          <div className="mt-4">
            <span className="text-xs text-[var(--muted)]">
              Available: <AnimatedNumber value={receiveBalance} /> {receiveToken}
            </span>
          </div>
        </div>

        <div className="pt-5 text-sm">
          <div className="font-semibold text-[var(--foreground)]">
            1 BULLET ⇆ <AnimatedNumber value={floorPrice} /> ANSEM
          </div>
        </div>

        {statusMessage && (
          <div className="mt-4 text-center font-mono text-xs font-bold text-[var(--foreground)] surface-panel p-2.5 rounded-lg">
            {statusMessage}
          </div>
        )}

        <button
          type="button"
          onClick={() => {
            if (!connected) setVisible(true);
            else handleExecute();
          }}
          disabled={isButtonDisabled && connected}
          className={`mt-5 w-full py-4 rounded-full font-semibold text-sm tracking-wide btn-haptic disabled:opacity-50 ${
            isAmountTooHigh ? "bg-red-500 text-white" : "btn-primary"
          }`}
        >
          {buttonText}
        </button>

        <div className="mt-4 flex items-start gap-2 text-sm text-[var(--muted)]">
          <span className="mt-0.5 shrink-0" aria-hidden>
            ⓘ
          </span>
          <p>
            Each mint/burn has a 4% fee (70% backing / 15% POL / 15% fee recipient). Protocol
            mint and burn run on Solana Devnet — no AMM swap required.
          </p>
        </div>
      </div>
    </div>
  );
}
