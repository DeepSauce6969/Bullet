import { DocsShell } from "@/app/docs/components/DocsShell";
import {
  ANSEM_MINT,
  BULLET_MINT,
  COLLATERAL_VAULT,
  FEE_RECIPIENT,
  POL_VAULT,
  PROGRAM_ID,
  PROTOCOL_PDA,
  VAULT,
} from "@/lib/bullet";

export default function DocsContractsPage() {
  return (
    <DocsShell
      title="Contracts"
      description="Devnet deployment addresses and on-chain instruction reference."
    >
      <h2>Devnet addresses</h2>
      <table>
        <tbody>
          <tr>
            <td>Program</td>
            <td>
              <code>{PROGRAM_ID.toBase58()}</code>
            </td>
          </tr>
          <tr>
            <td>Protocol PDA</td>
            <td>
              <code>{PROTOCOL_PDA.toBase58()}</code>
            </td>
          </tr>
          <tr>
            <td>BULLET mint</td>
            <td>
              <code>{BULLET_MINT.toBase58()}</code>
            </td>
          </tr>
          <tr>
            <td>Ansem mint (mock)</td>
            <td>
              <code>{ANSEM_MINT.toBase58()}</code>
            </td>
          </tr>
          <tr>
            <td>Vault</td>
            <td>
              <code>{VAULT.toBase58()}</code>
            </td>
          </tr>
          <tr>
            <td>POL vault</td>
            <td>
              <code>{POL_VAULT.toBase58()}</code>
            </td>
          </tr>
          <tr>
            <td>Collateral vault</td>
            <td>
              <code>{COLLATERAL_VAULT.toBase58()}</code>
            </td>
          </tr>
          <tr>
            <td>Fee recipient</td>
            <td>
              <code>{FEE_RECIPIENT.toBase58()}</code>
            </td>
          </tr>
        </tbody>
      </table>

      <h2>Instructions</h2>
      <table>
        <thead>
          <tr>
            <th>IX</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>initialize</code></td>
            <td>Create protocol PDA, BULLET mint, vaults</td>
          </tr>
          <tr>
            <td><code>mint_bullet</code></td>
            <td>Deposit Ansem → mint BULLET</td>
          </tr>
          <tr>
            <td><code>burn_bullet</code></td>
            <td>Burn BULLET → Ansem</td>
          </tr>
          <tr>
            <td><code>borrow</code></td>
            <td>Loan Ansem vs BULLET collateral</td>
          </tr>
          <tr>
            <td><code>repay</code></td>
            <td>Repay principal, unlock collateral</td>
          </tr>
          <tr>
            <td><code>leverage</code></td>
            <td>One-click leveraged position</td>
          </tr>
          <tr>
            <td><code>liquidate</code></td>
            <td>Expired loan → burn collateral</td>
          </tr>
          <tr>
            <td><code>set_fee_recipient</code></td>
            <td>Update bribe wallet (authority)</td>
          </tr>
        </tbody>
      </table>

      <p className="docs-callout text-[var(--muted)]">
        Mainnet Ansem: <code>9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump</code>
      </p>
    </DocsShell>
  );
}
