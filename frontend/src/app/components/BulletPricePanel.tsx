"use client";

import { Skeleton } from "@/app/components/Skeleton";
import { TooltipInfo } from "@/app/components/TooltipInfo";
import type { ArbitrageDirection } from "@/app/lib/protocolPrice";

interface PriceMetricCardProps {
  label: string;
  tooltip: string;
  spyValue: number | string | null;
  usdValue: number | null;
  isLoading?: boolean;
  isIndicativeUsd?: boolean;
  accent?: boolean;
  sublabel?: string;
  unit?: "ANSEM" | "BULLET";
}

function formatPriceAmount(value: number | string): string {
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n) || n <= 0) return "—";
  return n.toFixed(4);
}

function PriceMetricCard({
  label,
  tooltip,
  spyValue,
  usdValue,
  isLoading,
  isIndicativeUsd,
  accent,
  sublabel,
  unit = "ANSEM",
}: PriceMetricCardProps) {
  return (
    <div className="slvr-card bank-card p-4 text-center">
      <span className="text-[10px] font-mono text-[var(--muted)] uppercase tracking-widest block mb-1 flex items-center justify-center">
        {label}
        <TooltipInfo content={tooltip} />
      </span>
      <div
        className={`text-xl font-mono font-bold ${
          accent ? "text-[var(--accent-dark)]" : "text-[var(--foreground)]"
        }`}
      >
        {isLoading || spyValue == null ? (
          <Skeleton className="h-6 w-20 mx-auto" />
        ) : (
          <span className="tabular-nums">{formatPriceAmount(spyValue)}</span>
        )}{" "}
        <span className="text-xs text-[var(--muted)]">{unit}</span>
      </div>
      <div className="text-xs text-[var(--muted)] mt-1">
        {usdValue != null ? (
          <>
            ~ ${usdValue.toFixed(2)}
            {isIndicativeUsd ? <span className="opacity-70"> · indicative</span> : null}
          </>
        ) : (
          "—"
        )}
      </div>
      {sublabel ? (
        <span className="text-[9px] font-mono text-[var(--accent-dark)] font-bold block mt-1">
          {sublabel}
        </span>
      ) : null}
    </div>
  );
}

interface BulletPricePanelProps {
  protocolBulletInSpy: string | number;
  protocolBulletUsd: number;
  marketBulletInSpy: number | null;
  marketBulletUsd: number | null;
  backingRatioPct: string;
  isLoadingProtocol?: boolean;
  isLoadingMarket?: boolean;
  isIndicativeUsd?: boolean;
  arbitrageSpreadPct?: number | null;
  arbitrageHint?: string | null;
  arbitrageDirection?: ArbitrageDirection;
  className?: string;
}

/** Protocol floor vs optional market — market left blank until an AMM exists on Solana. */
export function BulletPricePanel({
  protocolBulletInSpy,
  protocolBulletUsd,
  marketBulletInSpy,
  marketBulletUsd,
  backingRatioPct,
  isLoadingProtocol,
  isLoadingMarket,
  isIndicativeUsd,
  arbitrageSpreadPct,
  arbitrageHint,
  className = "",
}: BulletPricePanelProps) {
  return (
    <div className={`space-y-3 ${className}`}>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <PriceMetricCard
          label="Protocol Price"
          tooltip="Mint/burn floor: Ansem per 1 BULLET (treasury backing ÷ supply)."
          spyValue={protocolBulletInSpy}
          usdValue={protocolBulletUsd}
          isLoading={isLoadingProtocol}
          isIndicativeUsd={isIndicativeUsd}
          sublabel="Mint & Burn · ANSEM per BULLET"
          unit="ANSEM"
        />
        <PriceMetricCard
          label="Market"
          tooltip="Secondary market mid-price when an AMM is available. Currently protocol-only on Devnet."
          spyValue={marketBulletInSpy}
          usdValue={marketBulletUsd}
          isLoading={isLoadingMarket && marketBulletInSpy == null}
          isIndicativeUsd
          sublabel="Coming soon"
          unit="ANSEM"
        />
        <div className="slvr-card bank-card p-4 text-center">
          <span className="text-[10px] font-mono text-[var(--muted)] uppercase tracking-widest block mb-1 flex items-center justify-center">
            Backing Ratio
            <TooltipInfo content="Ansem reserves per circulating BULLET (backing ÷ supply)." />
          </span>
          <div className="text-xl font-mono font-bold text-[var(--accent-dark)]">
            {backingRatioPct}%
          </div>
          <span className="text-[9px] font-mono text-[var(--muted)] block mt-2">
            ANSEM per BULLET
          </span>
        </div>
      </div>

      {arbitrageHint && arbitrageSpreadPct != null ? (
        <div className="slvr-card bank-card px-4 py-3 text-center border border-[var(--accent-dark)]/15 space-y-2">
          <p className="text-[10px] sm:text-xs font-mono text-[var(--accent-dark)] font-semibold">
            Arbitrage · {arbitrageSpreadPct > 0 ? "+" : ""}
            {arbitrageSpreadPct.toFixed(2)}% vs protocol
          </p>
          <p className="text-[10px] font-mono text-[var(--muted)]">{arbitrageHint}</p>
        </div>
      ) : null}
    </div>
  );
}
