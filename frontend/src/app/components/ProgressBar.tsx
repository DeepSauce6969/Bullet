"use client";

import React from 'react';

interface ProgressBarProps {
  value: number;
  max?: number;
  showLabel?: boolean;
  className?: string;
}

export function ProgressBar({ value, max = 100, showLabel = true, className = '' }: ProgressBarProps) {
  const percentage = Math.min(100, Math.max(0, (value / max) * 100));
  const displayPercent = percentage >= 99.95 ? percentage.toFixed(1) : Math.round(percentage);

  return (
    <div className={`space-y-1 ${className}`}>
      <div className="progress-bar">
        <div
          className="progress-bar-fill"
          style={{ width: `${percentage}%` }}
          role="progressbar"
          aria-valuenow={percentage}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
      {showLabel && (
        <div className="text-right">
          <span className="text-xs font-mono font-bold text-[var(--foreground)]">
            {displayPercent}%
          </span>
        </div>
      )}
    </div>
  );
}
