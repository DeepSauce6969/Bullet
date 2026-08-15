"use client";

import React from "react";
import { TooltipInfo } from "@/app/components/TooltipInfo";
import { Skeleton } from "@/app/components/Skeleton";
import { AnimatedNumber } from "@/app/components/AnimatedNumber";
import { BulletPricePanel } from "@/app/components/BulletPricePanel";
import { useProtocolMetrics } from "@/lib/hooks";
import { useTokenPrices } from "@/app/hooks/useTokenPrices";
import { BUY_FEE_PCT, DEFAULT_MAX_SUPPLY, SELL_FEE_PCT } from "@/lib/bullet";

export default function AnalyticsPage() {
  const { data, isLoading, refetch } = useProtocolMetrics();
  const {
    protocolBulletUsd,
    marketBulletUsd,
    marketBulletInSpy,
    backingRatioPct,
    arbitrageSpreadPct,
    arbitrageHint,
    arbitrageDirection,
    isIndicativeUsd,
    isLoadingMarket,
  } = useTokenPrices();

  const backing = data.backing;
  const totalSupply = data.totalSupply;
  const totalMinted = data.totalMinted;
  const floorPrice = data.floorPrice;
  const backingRatio = backingRatioPct || data.backingRatio;
  const isStarted = data.tradingEnabled;

  return (
    <div className="max-w-5xl mx-auto space-y-8 py-4 px-4">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="space-y-1">
          <h1 className="text-3xl font-serif font-black tracking-tight text-[var(--foreground)]">
            Protocol Analytics
          </h1>
          <p className="text-xs font-mono text-[var(--muted)]">
            Real-time treasury backing, supply, and liquidity metrics
          </p>
        </div>

        <button onClick={() => refetch()} className="btn-primary px-4 py-2 text-xs shadow-sm">
          <span>REFRESH METRICS</span>
        </button>
      </div>

      <BulletPricePanel
        protocolBulletInSpy={floorPrice}
        protocolBulletUsd={protocolBulletUsd}
        marketBulletInSpy={marketBulletInSpy}
        marketBulletUsd={marketBulletUsd}
        backingRatioPct={backingRatio}
        isLoadingProtocol={isLoading}
        isLoadingMarket={isLoadingMarket}
        isIndicativeUsd={isIndicativeUsd}
        arbitrageSpreadPct={arbitrageSpreadPct}
        arbitrageHint={arbitrageHint}
        arbitrageDirection={arbitrageDirection}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
        <div className="slvr-card bank-card p-5 space-y-2">
          <div className="text-[var(--muted)]">
            <span className="text-[10px] font-mono uppercase tracking-widest flex items-center gap-1">
              Total Backing
              <TooltipInfo content="Total amount of Ansem held in the protocol treasury securing BULLET." />
            </span>
          </div>
          <div className="text-2xl font-mono font-bold text-[var(--foreground)]">
            {isLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <AnimatedNumber value={backing} />
            )}{" "}
            <span className="text-xs text-[var(--muted)]">ANSEM</span>
          </div>
          <span className="text-[10px] font-mono text-[var(--muted)] block">
            Reserve Ratio: {isLoading ? "..." : backingRatio}%
          </span>
        </div>

        <div className="slvr-card bank-card p-5 space-y-2">
          <div className="text-[var(--muted)]">
            <span className="text-[10px] font-mono uppercase tracking-widest flex items-center gap-1">
              Circulating Supply
              <TooltipInfo content="Total BULLET tokens currently in circulation." />
            </span>
          </div>
          <div className="text-2xl font-mono font-bold text-[var(--foreground)]">
            {isLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <AnimatedNumber value={totalSupply} />
            )}{" "}
            <span className="text-xs text-[var(--accent-dark)]">BULLET</span>
          </div>
          <span className="text-[10px] font-mono text-[var(--muted)] block">
            Active Circulating Supply
          </span>
        </div>

        <div className="slvr-card bank-card p-5 space-y-2">
          <div className="text-[var(--muted)]">
            <span className="text-[10px] font-mono uppercase tracking-widest flex items-center gap-1">
              Active Borrows
              <TooltipInfo content="Ansem currently borrowed against BULLET collateral." />
            </span>
          </div>
          <div className="text-2xl font-mono font-bold text-[var(--foreground)]">
            {isLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <AnimatedNumber value={data.activeBorrows} />
            )}{" "}
            <span className="text-xs text-[var(--muted)]">ANSEM</span>
          </div>
          <span className="text-[10px] font-mono text-[var(--muted)] block">In Vaults</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="slvr-card bank-card p-6 space-y-4">
          <div className="border-b border-[var(--card-border)]/10 pb-3 flex items-center justify-between">
            <h2 className="text-sm font-serif font-bold text-[var(--foreground)]">
              BULLET Token Distribution
            </h2>
          </div>

          <div className="space-y-3 font-mono text-xs">
            <div className="flex justify-between py-1.5 border-b border-[var(--card-border)]/5">
              <span className="text-[var(--muted)]">Circulating Supply:</span>
              <span className="font-bold text-[var(--foreground)]">
                {isLoading ? (
                  <Skeleton className="h-4 w-16 inline-block align-middle" />
                ) : (
                  <AnimatedNumber value={totalSupply} />
                )}{" "}
                BULLET
              </span>
            </div>

            <div className="flex justify-between py-1.5 border-b border-[var(--card-border)]/5">
              <span className="text-[var(--muted)]">Total Minted Historically:</span>
              <span className="font-bold text-[var(--foreground)]">
                {isLoading ? (
                  <Skeleton className="h-4 w-16 inline-block align-middle" />
                ) : (
                  <AnimatedNumber value={totalMinted} />
                )}{" "}
                BULLET
              </span>
            </div>

            <div className="flex justify-between py-1.5 border-b border-[var(--card-border)]/5">
              <span className="text-[var(--muted)] flex items-center gap-1">
                Max Supply Cap
                <TooltipInfo content="Hardcoded maximum amount of BULLET that can ever exist." />
              </span>
              <span className="font-bold text-[var(--accent-dark)]">
                {DEFAULT_MAX_SUPPLY.toLocaleString()} BULLET
              </span>
            </div>

            <div className="flex justify-between py-1.5">
              <span className="text-[var(--muted)]">Trading State:</span>
              {isLoading ? (
                <Skeleton className="h-4 w-24" />
              ) : (
                <span
                  className={`font-bold ${
                    isStarted ? "text-[var(--accent-dark)]" : "text-amber-700"
                  }`}
                >
                  {isStarted ? "INITIALIZED & ACTIVE" : "PENDING INITIALIZATION"}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="slvr-card bank-card p-6 space-y-4">
          <div className="border-b border-[var(--card-border)]/10 pb-3">
            <h2 className="text-sm font-serif font-bold text-[var(--foreground)]">
              Protocol Fee Parameters
            </h2>
          </div>

          <div className="space-y-3 font-mono text-xs">
            <div className="flex justify-between py-1.5 border-b border-[var(--card-border)]/5">
              <span className="text-[var(--muted)]">Buy Trading Fee:</span>
              <span className="font-bold text-[var(--foreground)]">{BUY_FEE_PCT}%</span>
            </div>

            <div className="flex justify-between py-1.5 border-b border-[var(--card-border)]/5">
              <span className="text-[var(--muted)]">Sell Trading Fee:</span>
              <span className="font-bold text-[var(--foreground)]">{SELL_FEE_PCT}%</span>
            </div>

            <div className="flex justify-between py-1.5 border-b border-[var(--card-border)]/5">
              <span className="text-[var(--muted)] flex items-center gap-1">
                Borrow Interest Formula
                <TooltipInfo content="Base fee is paid upfront. APY is annualized and added to debt over time." />
              </span>
              <span className="font-bold text-[var(--foreground)]">3.9% APY + 0.1% Base Fee</span>
            </div>

            <div className="flex justify-between py-1.5">
              <span className="text-[var(--muted)]">Max Borrow Duration:</span>
              <span className="font-bold text-[var(--foreground)]">365 Days</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
