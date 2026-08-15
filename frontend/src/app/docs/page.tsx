import Link from "next/link";
import { DocsShell } from "@/app/docs/components/DocsShell";

export default function DocsOverviewPage() {
  return (
    <DocsShell
      title="Bullet Protocol"
      description="Ansem-backed up-only floor token on Solana — mint, burn, borrow, and leverage."
    >
      <p>
        <strong>Bullet</strong> is an Ansem-backed protocol on Solana. Every mint,
        burn, borrow, and liquidation is designed so the protocol floor price in
        Ansem terms never decreases.
      </p>

      <h2>What you can do</h2>
      <ul>
        <li>
          <Link href="/mint-and-burn">Mint &amp; Burn</Link> — swap Ansem ↔ BULLET
          at the protocol floor
        </li>
        <li>
          <Link href="/loans">Loans &amp; Leverage</Link> — borrow liquid Ansem
          against BULLET collateral or open a one-click leveraged position
        </li>
        <li>
          <Link href="/pre-deposit">Genesis Pre-Deposit</Link> — early Ansem
          deposits before public launch
        </li>
        <li>
          <Link href="/analytics">Analytics</Link> — live floor, backing, supply,
          and fee metrics
        </li>
        <li>
          <Link href="/portfolio">Portfolio</Link> — manage balances and active
          loans
        </li>
      </ul>

      <h2>Backing asset</h2>
      <table>
        <thead>
          <tr>
            <th>Network</th>
            <th>Token</th>
            <th>Mint</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Mainnet</td>
            <td>Ansem</td>
            <td>
              <code>9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump</code>
            </td>
          </tr>
          <tr>
            <td>Devnet</td>
            <td>Mock Ansem</td>
            <td>
              <code>GC3hpHn9p2LtzWwM3WQrYPZXXsxULg53pPKfRoAs2gVW</code>
            </td>
          </tr>
        </tbody>
      </table>

      <p>
        Protocol token: <strong>$BULLET</strong> (6 decimals, max supply 2,500 by
        default).
      </p>

      <h2>Feature matrix</h2>
      <table>
        <thead>
          <tr>
            <th>Feature</th>
            <th>Bullet</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Mint (Ansem → BULLET)</td>
            <td>Yes</td>
          </tr>
          <tr>
            <td>Burn (BULLET → Ansem)</td>
            <td>Yes</td>
          </tr>
          <tr>
            <td>Floor up-only</td>
            <td>Yes</td>
          </tr>
          <tr>
            <td>Loans ~99% LTV</td>
            <td>Yes</td>
          </tr>
          <tr>
            <td>One-click leverage</td>
            <td>Yes</td>
          </tr>
          <tr>
            <td>Liquidate expired loans</td>
            <td>Yes</td>
          </tr>
          <tr>
            <td>Fee split 70/15/15</td>
            <td>Yes (backing / POL / bribes)</td>
          </tr>
        </tbody>
      </table>

      <p className="docs-callout">
        Read <Link href="/docs/mechanics">Floor Mechanics</Link> next to understand
        how backing and supply interact, or jump to{" "}
        <Link href="/docs/mint-burn">Mint &amp; Burn</Link> if you are ready to
        trade.
      </p>
    </DocsShell>
  );
}
