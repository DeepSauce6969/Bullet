import Link from "next/link";
import { DocsShell } from "@/app/docs/components/DocsShell";

export default function DocsLoansPage() {
  return (
    <DocsShell
      title="Loans & Leverage"
      description="Borrow liquid Ansem against BULLET or loop with one-click leverage."
    >
      <h2>Simple borrow</h2>
      <ul>
        <li>Lock BULLET as collateral in the protocol vault.</li>
        <li>Borrow up to <strong>99% LTV</strong> in Ansem.</li>
        <li>
          Interest = <strong>3.9% APY × days/365 + 0.1% base</strong>, paid
          upfront from your wallet.
        </li>
        <li>Choose loan duration between 1 and 365 days.</li>
        <li>Repay principal anytime before expiry to reclaim collateral.</li>
      </ul>

      <h2>One-click leverage</h2>
      <p>
        Leverage spends Ansem upfront on fees, mints BULLET collateral, and
        records debt — without paying borrowed Ansem to your wallet. You repay
        later to unlock the minted collateral.
      </p>
      <ul>
        <li><strong>1% bake fee</strong> on the notional Ansem input.</li>
        <li>
          <strong>1% over-collateralization</strong> on the post-bake amount.
        </li>
        <li>Interest on the borrow leg (same formula as simple borrow).</li>
        <li>Collateral is minted and locked until repay.</li>
      </ul>

      <h2>Expiry & liquidation</h2>
      <ul>
        <li>After <code>end_ts</code>, repay is disabled (<code>LoanExpired</code>).</li>
        <li>
          Any wallet can call <strong>liquidate</strong> — collateral is burned;
          borrowed Ansem stays in backing (floor rises for holders).
        </li>
        <li>
          Manage active loans on <Link href="/loans">Bullet Loans</Link> or{" "}
          <Link href="/portfolio">Portfolio</Link>.
        </li>
      </ul>

      <h2>One loan per wallet</h2>
      <p>
        You must close or repay your current loan before opening a new borrow or
        leverage position.
      </p>

      <p className="docs-callout">
        Meme-volatility risks at 99% LTV: <Link href="/docs/risks">Risks</Link>.
      </p>
    </DocsShell>
  );
}
