import Link from "next/link";
import { DocsShell } from "@/app/docs/components/DocsShell";

export default function DocsMechanicsPage() {
  return (
    <DocsShell
      title="Floor Mechanics"
      description="How Bullet keeps an up-only Ansem floor for every holder."
    >
      <p>
        Bullet&apos;s floor is not an AMM price — it is a protocol accounting
        curve backed by Ansem in the vault plus outstanding borrows.
      </p>

      <pre>
        {`Backing = vault_Ansem + total_borrowed
Floor   = Backing / total_supply   (never decreases)`}
      </pre>

      <h2>Why the floor only goes up</h2>
      <ul>
        <li>
          <strong>Mint</strong> — most of the 2.5% fee stays in backing while
          supply increases less than the deposit.
        </li>
        <li>
          <strong>Burn</strong> — supply shrinks; backing after fees stays
          favorable to remaining holders.
        </li>
        <li>
          <strong>Borrow</strong> — borrowed Ansem remains in the backing
          calculation while BULLET collateral is locked.
        </li>
        <li>
          <strong>Liquidate</strong> — expired loans burn collateral; borrowed
          Ansem stays in backing math, raising the floor for everyone else.
        </li>
      </ul>

      <h2>Floor vs market price</h2>
      <p>
        The protocol floor is the redemption value inside Bullet. Market price on
        secondary venues can trade above or below that floor. When market &lt;
        floor, minting is attractive; when market &gt; floor, burning can
        arbitrage the spread. See live values on{" "}
        <Link href="/analytics">Analytics</Link>.
      </p>

      <h2>No price liquidations</h2>
      <p>
        Loans are backed by the protocol floor, not spot market volatility.
        Positions are time-based: after expiry, anyone can liquidate and burn
        the locked collateral. There is no margin call from a price dump alone.
      </p>

      <p className="docs-callout">
        Fee math and APR breakdowns live in{" "}
        <Link href="/docs/fees">Fees &amp; APR</Link>. Operational risks are in{" "}
        <Link href="/docs/risks">Risks</Link>.
      </p>
    </DocsShell>
  );
}
