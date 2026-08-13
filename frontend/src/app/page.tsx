"use client";

import React from "react";
import Image from "next/image";
import { TooltipInfo } from "@/app/components/TooltipInfo";
import { Skeleton } from "@/app/components/Skeleton";
import { AnimatedNumber } from "@/app/components/AnimatedNumber";
import { NetworkBadge, TestPhaseBanner } from "@/app/components/NetworkBadge";
import { useProtocolMetrics } from "@/lib/hooks";
import { useTokenPrices } from "@/app/hooks/useTokenPrices";
import { deployment } from "@/app/config/deployment";

export default function HomePage() {
  const { data, isLoading } = useProtocolMetrics();
  const {
    protocolTimeUsd,
    marketTimeUsd,
    marketTimeInSpy,
    isIndicativeUsd,
    isLoading: isPricesLoading,
    isLoadingMarket,
  } = useTokenPrices();

  const floorPrice = Number(data.floorPrice);
  const backing = Number(data.backing);
  const totalSupply = Number(data.totalSupply);
  const activeBorrows = data.activeBorrows;

  return (
    <div className="max-w-5xl mx-auto my-2 sm:my-4 px-0 sm:px-4">
      <div className="slvr-card bank-card p-4 sm:p-6 lg:p-10 space-y-6 sm:space-y-8">
        <section className="text-center space-y-6 max-w-3xl mx-auto pt-2">
          <NetworkBadge />

          <div className="space-y-2">
            <div className="flex justify-center items-center my-2 px-2">
              <Image
                src="/BULLET-LOGO.png"
                alt="Bullet Logo"
                width={800}
                height={240}
                priority
                className="w-full max-w-xl h-auto object-contain rounded-lg shadow-sm"
              />
            </div>

            <h1 className="text-3xl sm:text-4xl font-serif text-[var(--accent-dark)] font-black tracking-wide">
              Bullet
            </h1>
            <h2 className="text-xl sm:text-2xl md:text-3xl font-serif text-[var(--accent-dark)] font-semibold tracking-wide px-2">
              {deployment.heroSubtitle}
            </h2>
            <TestPhaseBanner className="pt-1" />
          </div>

          <p className="text-sm sm:text-lg md:text-xl font-serif text-[var(--foreground)] max-w-2xl mx-auto leading-relaxed px-1">
            <span className="text-[var(--accent-dark)]">• Up only on Ansem</span> : Perpetually
            appreciating Ansem-backed token. Every minting, redeeming, borrowing, and defaulting
            increases value for all holders.
          </p>
        </section>

        <section className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3 pt-2">
          <div className="slvr-card bank-card p-3 sm:p-4 space-y-1">
            <span className="text-[10px] font-mono text-[var(--muted)] uppercase tracking-widest flex items-center gap-1">
              Protocol Price
              <TooltipInfo content="Mint/burn price: Ansem per BULLET from treasury backing ratio." />
            </span>
            <div className="text-lg sm:text-xl font-mono font-bold text-[var(--accent-dark)]">
              {isLoading ? (
                <Skeleton className="h-6 w-20" />
              ) : (
                <AnimatedNumber value={floorPrice.toString()} />
              )}{" "}
              <span className="text-xs text-[var(--muted)]">ANSEM</span>
            </div>
            <span className="text-[9px] font-mono text-[var(--muted)] block">
              ~ ${!isPricesLoading ? protocolTimeUsd.toFixed(2) : "—"} USD
              {isIndicativeUsd && !isPricesLoading ? " · indicative" : ""}
            </span>
            <span className="text-[9px] font-mono text-[var(--muted)] block">
              Market:{" "}
              {isLoadingMarket || marketTimeInSpy == null
                ? "—"
                : `${marketTimeInSpy.toFixed(4)} ANSEM · ~$${marketTimeUsd?.toFixed(2)}`}
            </span>
            <span className="text-[9px] font-mono text-[var(--accent-dark)] font-bold block">
              ↑ Up Only Floor
            </span>
          </div>

          <div className="slvr-card bank-card p-3 sm:p-4 space-y-1">
            <span className="text-[10px] font-mono text-[var(--muted)] uppercase tracking-widest flex items-center gap-1">
              Treasury Backing
              <TooltipInfo content="Total Ansem reserves backing all issued tokens." />
            </span>
            <div className="text-lg sm:text-xl font-mono font-bold text-[var(--foreground)]">
              {isLoading ? (
                <Skeleton className="h-6 w-20" />
              ) : (
                <AnimatedNumber value={backing.toString()} />
              )}{" "}
              <span className="text-xs text-[var(--muted)]">ANSEM</span>
            </div>
            <span className="text-[9px] font-mono text-[var(--muted)] block">
              100% Reserve Backed
            </span>
          </div>

          <div className="slvr-card bank-card p-3 sm:p-4 space-y-1">
            <span className="text-[10px] font-mono text-[var(--muted)] uppercase tracking-widest flex items-center gap-1">
              Active Borrows
              <TooltipInfo content="Total amount of Ansem currently borrowed out in vaults." />
            </span>
            <div className="text-lg sm:text-xl font-mono font-bold text-[var(--foreground)]">
              {isLoading ? (
                <Skeleton className="h-6 w-20" />
              ) : (
                <AnimatedNumber value={activeBorrows} />
              )}{" "}
              <span className="text-xs text-[var(--muted)]">ANSEM</span>
            </div>
            <span className="text-[9px] font-mono text-[var(--muted)] block">In Vaults</span>
          </div>

          <div className="slvr-card bank-card p-3 sm:p-4 space-y-1">
            <span className="text-[10px] font-mono text-[var(--muted)] uppercase tracking-widest flex items-center gap-1">
              Circulating Supply
              <TooltipInfo content="Current amount of BULLET tokens in circulation." />
            </span>
            <div className="text-lg sm:text-xl font-mono font-bold text-[var(--foreground)]">
              {isLoading ? (
                <Skeleton className="h-6 w-20" />
              ) : (
                <AnimatedNumber value={totalSupply.toString()} />
              )}{" "}
              <span className="text-xs text-[var(--accent-dark)]">BULLET</span>
            </div>
            <span className="text-[9px] font-mono text-[var(--muted)] block">Max Supply Cap</span>
          </div>
        </section>
      </div>
    </div>
  );
}
