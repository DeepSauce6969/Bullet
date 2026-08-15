import Link from "next/link";
import { DocsShell } from "@/app/docs/components/DocsShell";

export default function DocsRisksPage() {
  return (
    <DocsShell
      title="Risks"
      description="Understand smart-contract, meme, and liquidity risks before using Bullet."
    >
      <h2>Meme backing</h2>
      <p>
        Bullet&apos;s floor is denominated in <strong>Ansem</strong>, not USD. The
        floor can rise in Ansem terms while the USD value of Ansem dumps. You are
        exposed to meme volatility even when the protocol math is working as
        designed.
      </p>

      <h2>Smart contract risk</h2>
      <p>
        The program is unaudited experimental software. Bugs, exploits, or
        misconfiguration can cause loss of funds. Only deposit what you can
        afford to lose.
      </p>

      <h2>LTV & leverage</h2>
      <p>
        Loans and leverage use up to <strong>99% LTV</strong> on a volatile asset.
        While Bullet does not liquidate on price moves, you still carry duration
        risk — expired loans lose collateral to liquidation.
      </p>

      <h2>Devnet vs mainnet</h2>
      <p>
        The current app may point at Solana devnet with mock Ansem. Addresses and
        behavior on mainnet will differ. Verify network badge and contract page
        before transacting.
      </p>

      <h2>No investment advice</h2>
      <p>
        Documentation and analytics are informational only. Nothing here is
        financial advice.
      </p>

      <p className="docs-callout">
        Back to <Link href="/docs">Overview</Link> · Trade on{" "}
        <Link href="/mint-and-burn">Mint &amp; Burn</Link>
      </p>
    </DocsShell>
  );
}
