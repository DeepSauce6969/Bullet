"use client";

import { useMemo } from "react";

interface AnimatedNumberProps {
  value: string | number;
  decimals?: number;
}

function formatValue(value: string | number, decimals: number): string {
  const n = typeof value === "string" ? parseFloat(value) || 0 : value;
  if (n === 0) return "0.00";
  if (n < 0.0001) return n.toFixed(6);
  return parseFloat(n.toFixed(decimals)).toString();
}

export function AnimatedNumber({ value, decimals = 4 }: AnimatedNumberProps) {
  const display = useMemo(() => formatValue(value, decimals), [value, decimals]);
  return <span className="tabular-nums">{display}</span>;
}
