"use client";

import React, { useState, useEffect, useMemo } from "react";
import { Skeleton } from "@/app/components/Skeleton";

interface CountdownTimerProps {
  /** Explicit target; otherwise uses NEXT_PUBLIC_GENESIS_END */
  targetDate?: Date;
  className?: string;
}

interface TimeLeft {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

function computeTimeLeft(targetMs: number): TimeLeft {
  const diff = Math.max(0, targetMs - Date.now());
  return {
    days: Math.floor(diff / (1000 * 60 * 60 * 24)),
    hours: Math.floor((diff / (1000 * 60 * 60)) % 24),
    minutes: Math.floor((diff / (1000 * 60)) % 60),
    seconds: Math.floor((diff / 1000) % 60),
  };
}

const UNITS = [
  { key: "days" as const, label: "DAYS" },
  { key: "hours" as const, label: "HOURS" },
  { key: "minutes" as const, label: "MINUTES" },
  { key: "seconds" as const, label: "SECONDS" },
];

const FALLBACK_ISO =
  process.env.NEXT_PUBLIC_GENESIS_END ?? "2026-12-31T00:00:00Z";

const CIRCLE_CLASS =
  "w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-[#0f0f0f] border border-[var(--accent)]/40 text-white flex items-center justify-center text-xl sm:text-2xl font-bold font-mono";

function VaultClosesInHeader() {
  return (
    <div className="flex items-center justify-center gap-4 w-full max-w-sm mx-auto mb-6">
      <div className="h-[2px] bg-[var(--card-border)]/50 flex-1" />
      <span className="uppercase text-sm font-bold tracking-widest text-[var(--muted)]">
        Vault closes in
      </span>
      <div className="h-[2px] bg-[var(--card-border)]/50 flex-1" />
    </div>
  );
}

/**
 * Genesis countdown — visual only (no EVM genesis contract).
 * Uses `targetDate` or `NEXT_PUBLIC_GENESIS_END`.
 */
export function CountdownTimer({
  targetDate,
  className = "",
}: CountdownTimerProps) {
  const targetMs = useMemo(() => {
    if (targetDate) return targetDate.getTime();
    return new Date(FALLBACK_ISO).getTime();
  }, [targetDate]);

  const [timeLeft, setTimeLeft] = useState<TimeLeft | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setTimeLeft(computeTimeLeft(targetMs));
    setReady(true);
    const timer = setInterval(() => {
      setTimeLeft(computeTimeLeft(targetMs));
    }, 1000);
    return () => clearInterval(timer);
  }, [targetMs]);

  return (
    <div className={`w-full ${className}`}>
      <VaultClosesInHeader />

      <div className="flex items-center justify-center gap-2 sm:gap-3">
        {UNITS.map((unit, index) => (
          <React.Fragment key={unit.key}>
            <div className="flex flex-col items-center gap-1.5">
              {!ready || !timeLeft ? (
                <Skeleton className="w-14 h-14 sm:w-16 sm:h-16 !rounded-full" />
              ) : (
                <div className={CIRCLE_CLASS}>{timeLeft[unit.key]}</div>
              )}
              <span className="text-[10px] sm:text-xs font-mono font-bold text-[var(--muted)] tracking-wider uppercase">
                {unit.label}
              </span>
            </div>
            {index < UNITS.length - 1 && (
              <span className="text-xl sm:text-2xl font-bold text-[var(--foreground)] mb-5">
                :
              </span>
            )}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
