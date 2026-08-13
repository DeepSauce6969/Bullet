"use client";

import React from 'react';

interface HoverTooltipProps {
  content: string;
  /** Optional className for the trigger wrapper */
  className?: string;
}

/**
 * Lightweight "?" tooltip — pure Tailwind (group / group-hover), no portal libs.
 */
export function HoverTooltip({ content, className = '' }: HoverTooltipProps) {
  return (
    <span className={`relative inline-flex items-center group ${className}`}>
      <button
        type="button"
        aria-label={content}
        className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-[var(--muted)]/40 text-[9px] font-mono font-bold leading-none text-[var(--muted)] transition-colors hover:border-[var(--foreground)]/50 hover:text-[var(--foreground)] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)]"
      >
        ?
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-max max-w-[220px] -translate-x-1/2 rounded-lg bg-[#1A1A1A] px-2.5 py-2 text-left text-[10px] font-mono font-normal normal-case tracking-normal text-white/95 opacity-0 shadow-xl transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {content}
        <span
          aria-hidden="true"
          className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-[#1A1A1A]"
        />
      </span>
    </span>
  );
}
