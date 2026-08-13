"use client";

import { deployment } from "@/app/config/deployment";

interface NetworkBadgeProps {
  className?: string;
}

/** Chain-aware badge — Solana Devnet for Bullet. */
export function NetworkBadge({ className = "" }: NetworkBadgeProps) {
  return (
    <div
      className={`inline-flex flex-wrap items-center justify-center gap-x-2 gap-y-1 px-3 sm:px-4 py-1.5 rounded-full bg-[var(--card)] border border-[var(--accent-dark)]/20 font-mono text-[10px] sm:text-xs font-bold text-[var(--accent-dark)] shadow-sm max-w-full ${className}`}
    >
      <span>{deployment.networkLabel}</span>
      <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse shrink-0" />
      <span>{deployment.statusLabel}</span>
    </div>
  );
}

interface TestPhaseBannerProps {
  className?: string;
}

/** Shown during Solana Devnet test phase. */
export function TestPhaseBanner({ className = "" }: TestPhaseBannerProps) {
  if (!deployment.isTestPhase) return null;

  return (
    <p
      className={`text-[10px] sm:text-xs font-mono text-[var(--muted)] max-w-xl mx-auto leading-relaxed px-2 ${className}`}
    >
      Bullet is live on Solana Devnet with mock Ansem. Claim test Ansem on Mint &amp; Burn to try
      mint, burn, borrow, and leverage.
    </p>
  );
}
