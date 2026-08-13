"use client";

import React from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { Info } from 'lucide-react';

export function TooltipInfo({ content }: { content: string }) {
  return (
    <Tooltip.Provider delayDuration={200}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button className="text-[var(--muted)] hover:text-[var(--foreground)] transition-colors inline-flex ml-1.5 align-middle outline-none">
            <Info size={14} />
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content 
            className="z-50 max-w-[240px] bg-[var(--foreground)] text-[var(--card)] text-[10px] font-mono p-2.5 rounded-lg shadow-xl leading-relaxed"
            sideOffset={5}
          >
            {content}
            <Tooltip.Arrow className="fill-[var(--foreground)]" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}