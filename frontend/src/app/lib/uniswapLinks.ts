import type { ArbitrageDirection } from "@/app/lib/protocolPrice";

/** No Uniswap deep links on Solana Bullet. */
export function isUniswapDeepLinkSupported(): boolean {
  return false;
}

export function getArbitrageUniswapSwapUrl(
  _direction?: ArbitrageDirection
): string | null {
  return null;
}
