import Link from "next/link";
import { DocsShell } from "@/app/docs/components/DocsShell";

export default function DocsMintBurnPage() {
  return (
    <DocsShell
      title="Mint & Burn"
      description="Swap Ansem and BULLET directly through the protocol curve."
    >
      <p>
        Mint and burn are the primary on-ramp and off-ramp for BULLET. No Uniswap
        pool is required — the protocol mints and redeems against its own floor.
      </p>

      <h2>Mint (Ansem → BULLET)</h2>
      <ol>
        <li>Connect wallet with Ansem balance.</li>
        <li>
          On <Link href="/mint-and-burn">Mint &amp; Burn</Link>, enter Ansem
          amount and confirm.
        </li>
        <li>
          A <strong>2.5% protocol fee</strong> is taken; you receive{" "}
          <strong>97.5%</strong> of the curve output as BULLET.
        </li>
        <li>70% of the fee remains in backing (floor support).</li>
      </ol>

      <h2>Burn (BULLET → Ansem)</h2>
      <ol>
        <li>Hold BULLET in your wallet.</li>
        <li>Flip to burn mode on Mint &amp; Burn.</li>
        <li>
          Redeem pro-rata Ansem at the floor, again net of the 2.5% outbound fee.
        </li>
      </ol>

      <h2>Devnet faucet</h2>
      <p>
        On devnet, use <strong>Claim Test Ansem</strong> on the Mint &amp; Burn
        page to fund your wallet before your first mint.
      </p>

      <h2>Trading pause</h2>
      <p>
        If protocol <code>tradingEnabled</code> is false, mint and burn buttons
        are disabled in the app until the authority re-enables trading.
      </p>

      <p className="docs-callout">
        Full fee routing: <Link href="/docs/fees">Fees &amp; APR</Link>. Floor
        math: <Link href="/docs/mechanics">Floor Mechanics</Link>.
      </p>
    </DocsShell>
  );
}
