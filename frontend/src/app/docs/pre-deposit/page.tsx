import Link from "next/link";
import { DocsShell } from "@/app/docs/components/DocsShell";

export default function DocsPreDepositPage() {
  return (
    <DocsShell
      title="Genesis Pre-Deposit"
      description="Early Ansem deposits before public trading goes live."
    >
      <p>
        Genesis vaults let users deposit Ansem during the presale window. After
        finalize, depositors claim pro-rata BULLET from the tier vault.
      </p>

      <h2>How it works</h2>
      <ol>
        <li>
          Open <Link href="/pre-deposit">Pre-Deposit</Link> and pick a tier (VIP,
          Community, Public).
        </li>
        <li>Deposit Ansem up to your per-wallet allocation cap.</li>
        <li>Withdraw anytime before the tier is finalized.</li>
        <li>
          After authority calls <code>finalize_genesis</code>, deposits close and
          BULLET is minted into the tier bullet vault.
        </li>
        <li>Claim your BULLET allocation pro-rata to your deposit share.</li>
      </ol>

      <h2>Tier parameters</h2>
      <p>
        Each tier has its own fee (bps), total deposit cap, and max allocation
        per wallet. Check the Pre-Deposit UI for live caps and countdown.
      </p>

      <h2>After launch</h2>
      <p>
        Once trading is enabled, use <Link href="/mint-and-burn">Mint &amp; Burn</Link>{" "}
        and <Link href="/loans">Loans</Link> for ongoing protocol access.
      </p>
    </DocsShell>
  );
}
