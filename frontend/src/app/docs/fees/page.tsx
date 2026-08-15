import Link from "next/link";
import { DocsShell } from "@/app/docs/components/DocsShell";

export default function DocsFeesPage() {
  return (
    <DocsShell
      title="Fees & APR"
      description="Protocol fees, borrow interest, and leverage cost breakdown."
    >
      <h2>Mint & burn</h2>
      <table>
        <thead>
          <tr>
            <th>Parameter</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Protocol fee</td>
            <td>2.5% (250 bps)</td>
          </tr>
          <tr>
            <td>User receives</td>
            <td>97.5% of curve output</td>
          </tr>
          <tr>
            <td>Fee split</td>
            <td>70% backing · 15% POL · 15% fee recipient</td>
          </tr>
        </tbody>
      </table>

      <h2>Borrow interest</h2>
      <table>
        <thead>
          <tr>
            <th>Parameter</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>APY</td>
            <td>3.9% (390 bps)</td>
          </tr>
          <tr>
            <td>Base borrow fee</td>
            <td>0.1% (10 bps)</td>
          </tr>
          <tr>
            <td>LTV</td>
            <td>99% (9,900 bps)</td>
          </tr>
          <tr>
            <td>Payment</td>
            <td>Upfront at loan open</td>
          </tr>
        </tbody>
      </table>

      <h2>Leverage fees</h2>
      <ul>
        <li><strong>Bake fee:</strong> 1% of Ansem notional</li>
        <li><strong>Over-collateralization:</strong> 1% of post-bake Ansem</li>
        <li><strong>Interest:</strong> same as borrow, on the borrow leg</li>
      </ul>

      <h2>Genesis tiers</h2>
      <p>
        Tier skim fees apply on finalize (0–150 bps depending on tier). See
        live tier cards on <Link href="/pre-deposit">Pre-Deposit</Link>.
      </p>

      <p className="docs-callout">
        On-chain formulas mirror <code>sdk/math.ts</code> in the repo.
      </p>
    </DocsShell>
  );
}
