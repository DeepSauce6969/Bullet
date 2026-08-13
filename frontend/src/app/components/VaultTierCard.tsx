"use client";

import React from 'react';
import { ProgressBar } from '@/app/components/ProgressBar';
import { TokenIcon } from '@/app/components/TokenIcon';
import { Button } from '@/app/components/Button';
import { Skeleton } from '@/app/components/Skeleton';
import { HoverTooltip } from '@/app/components/HoverTooltip';

export interface VaultTierCardProps {
  name: string;
  fee: string;
  isClosed: boolean;
  isActive: boolean;
  tvl: string;
  depositCap: string;
  progressPercent: number;
  yourCapLabel: string;
  yourCapEligible: boolean;
  price: string;
  isLoading?: boolean;
  amount?: string;
  onAmountChange?: (value: string) => void;
  onMaxClick?: () => void;
  showDepositInput?: boolean;
  buttonLabel: string;
  buttonVariant: 'primary' | 'outline';
  buttonDisabled?: boolean;
  buttonLoading?: boolean;
  buttonClassName?: string;
  onButtonClick?: (e?: React.MouseEvent<HTMLButtonElement>) => void;
}

function StatLabel({
  label,
  tooltip,
}: {
  label: string;
  tooltip?: string;
}) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-mono font-bold text-[var(--muted)] uppercase tracking-wider">
      {label}
      {tooltip ? <HoverTooltip content={tooltip} /> : null}
    </span>
  );
}

function StatValue({
  label,
  value,
  tooltip,
  showToken = true,
  isLoading,
}: {
  label: string;
  value: string;
  tooltip?: string;
  showToken?: boolean;
  isLoading?: boolean;
}) {
  return (
    <div className="space-y-1">
      <StatLabel label={label} tooltip={tooltip} />
      <div className="flex items-center gap-1.5">
        {showToken && <TokenIcon />}
        {isLoading ? (
          <Skeleton className="h-5 w-16" />
        ) : (
          <span className="text-sm font-mono font-bold text-[var(--foreground)]">{value}</span>
        )}
      </div>
    </div>
  );
}

export function VaultTierCard({
  name,
  fee,
  isClosed,
  isActive,
  tvl,
  depositCap,
  progressPercent,
  yourCapLabel,
  yourCapEligible,
  price,
  isLoading,
  amount,
  onAmountChange,
  onMaxClick,
  showDepositInput,
  buttonLabel,
  buttonVariant,
  buttonDisabled,
  buttonLoading,
  buttonClassName = '',
  onButtonClick,
}: VaultTierCardProps) {
  return (
    <article
      className={`time-card p-5 sm:p-6 flex flex-col gap-4 h-full ${
        isActive && !isClosed ? 'time-card-active' : ''
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm sm:text-base font-bold text-[var(--foreground)] leading-tight">
          {name} ({fee})
        </h3>
        {isClosed && <span className="badge-closed shrink-0">CLOSED</span>}
      </div>

      {/* Stats Row 1 */}
      <div className="grid grid-cols-2 gap-4">
        <StatValue
          label="TVL"
          value={tvl}
          tooltip="Total ANSEM deposited in this vault so far."
          isLoading={isLoading}
        />
        <StatValue
          label="DEPOSIT CAP"
          value={depositCap}
          tooltip="This is the maximum amount you're allowed to deposit in this vault"
          isLoading={isLoading}
        />
      </div>

      {/* Progress */}
      <ProgressBar value={progressPercent} showLabel />

      {/* Stats Row 2 */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <StatLabel
            label="YOUR CAP"
            tooltip="Whether your connected wallet is eligible to deposit in this vault."
          />
          <p
            className={`text-sm font-mono font-bold ${
              yourCapEligible ? 'text-[var(--accent)]' : 'text-[var(--muted)]'
            }`}
          >
            {yourCapLabel}
          </p>
        </div>
        <StatValue
          label="PRICE"
          value={price}
          tooltip="The fixed price you'll pay per $ANSEM when this vault mints."
          isLoading={isLoading}
        />
      </div>

      {/* Deposit input (shown for eligible Deposit state) */}
      {showDepositInput && (
        <div className="time-inset p-3 flex items-center justify-between gap-2">
          <input
            type="number"
            value={amount ?? ''}
            onChange={(e) => onAmountChange?.(e.target.value)}
            placeholder="0.0"
            disabled={buttonDisabled && !buttonLoading}
            className="bg-transparent text-lg font-mono font-bold text-[var(--foreground)] focus:outline-none w-full disabled:opacity-50"
          />
          <button
            type="button"
            onClick={onMaxClick}
            disabled={buttonDisabled && !buttonLoading}
            className="px-2.5 py-1 rounded-lg bg-[var(--card)] font-mono font-bold text-xs text-[var(--foreground)] border border-[var(--card-border)] hover:bg-[var(--accent)] hover:text-[var(--accent-foreground)] transition btn-haptic disabled:opacity-50"
          >
            MAX
          </button>
        </div>
      )}

      {/* Action */}
      <div className="mt-auto pt-1">
        <Button
          type="button"
          variant={buttonVariant}
          fullWidth
          disabled={buttonDisabled}
          loading={buttonLoading}
          onClick={(e) => {
            e.preventDefault();
            onButtonClick?.(e);
          }}
          className={buttonClassName}
        >
          {buttonLabel}
        </Button>
      </div>
    </article>
  );
}
