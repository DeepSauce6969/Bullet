"use client";

import { useProtocolMetrics } from "@/lib/hooks";

/** Placeholder Ansem USD (devnet mock has no reliable oracle feed). */
export const ANSEM_USD_PRICE = 0.01;

/**
 * Lightweight price helpers for Bullet UI.
 * Protocol floor comes from on-chain metrics; market/arbitrage are placeholders (no AMM yet).
 */
export function useTokenPrices() {
  const { data, isLoading } = useProtocolMetrics();
  const floor = Number(data.floorPrice) || 1;
  const protocolTimeUsd = floor * ANSEM_USD_PRICE;

  return {
    protocolTimeInSpy: data.floorPrice,
    protocolTimeUsd,
    marketTimeInSpy: null as number | null,
    marketTimeUsd: null as number | null,
    backingRatioPct: data.backingRatio,
    arbitrageSpreadPct: null as number | null,
    arbitrageHint: null as string | null,
    arbitrageDirection: null as null,
    isIndicativeUsd: true,
    isLoading,
    isLoadingFloor: isLoading,
    isLoadingMarket: false,
    formatSpyUsd: (val: string | number) =>
      (Number(val || 0) * ANSEM_USD_PRICE).toFixed(2),
    formatTimeUsd: (val: string | number) =>
      (Number(val || 0) * floor * ANSEM_USD_PRICE).toFixed(2),
  };
}
