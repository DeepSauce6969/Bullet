import Link from "next/link";
import {
  DocsAddressRow,
  DocsCallout,
  DocsCodeBlock,
  DocsDefGrid,
  DocsHero,
  DocsKeyFacts,
  DocsSection,
  DocsSteps,
} from "@/app/docs/components/DocsBlocks";
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

export default function DocsPage() {
  return (
    <article className="docs-article">
      <DocsHero
        title="Everything about Bullet, in one place."
        subtitle="Ansem-backed up-only floor token on Solana — mint, burn, borrow, and leverage without leaving your wallet."
      />

      <DocsSection id="overview" title="Overview">
        <p>
          Bullet is a protocol to mint, burn, borrow, and lever BULLET against
          Ansem on Solana. You can browse live metrics, open positions, and
          manage loans straight from the app.
        </p>
        <p>
          Bullet never holds your wallet keys. Every mint, burn, borrow, and
          repay is a transaction your wallet asks you to approve.
        </p>

        <DocsKeyFacts>
          <li>
            The floor is denominated in <strong>Ansem</strong>, not USD — it can
            rise in Ansem terms while USD value moves independently.
          </li>
          <li>
            Max supply defaults to <strong>2,500 BULLET</strong> (6 decimals).
          </li>
          <li>
            Loans are <strong>time-based</strong>, not price-liquidated — expired
            positions can be liquidated after maturity.
          </li>
          <li>
            On devnet, use the faucet on{" "}
            <Link href="/mint-and-burn">Mint &amp; Burn</Link> for mock Ansem.
          </li>
        </DocsKeyFacts>
      </DocsSection>

      <DocsSection id="mechanics" title="How the floor works">
        <p>
          Bullet&apos;s redemption price is protocol accounting, not an AMM
          quote. Backing and supply move together so the floor never decreases
          in Ansem terms.
        </p>

        <DocsCodeBlock title="Core formulas">
          {`Backing = vault_Ansem + total_borrowed
Floor   = Backing / total_supply`}
        </DocsCodeBlock>

        <DocsSteps
          steps={[
            {
              title: "Mint",
              body: "Ansem enters the vault; BULLET supply grows. Most of the 2.5% fee stays in backing.",
            },
            {
              title: "Borrow",
              body: "BULLET collateral locks while borrowed Ansem stays in the backing calculation.",
            },
            {
              title: "Liquidate",
              body: "After expiry, collateral burns. Debt remains in backing — floor rises for holders.",
            },
          ]}
        />

        <DocsDefGrid
          items={[
            {
              term: "Floor",
              definition:
                "Protocol redemption value per BULLET in Ansem.",
            },
            {
              term: "Backing",
              definition:
                "Vault Ansem plus outstanding borrows counted in floor math.",
            },
            {
              term: "Market price",
              definition:
                "Secondary venue price — can trade above or below the protocol floor.",
            },
            {
              term: "Backing ratio",
              definition:
                "How fully outstanding BULLET is covered by protocol backing.",
            },
          ]}
        />

        <p>
          Live floor vs market spreads are on{" "}
          <Link href="/analytics">Analytics</Link>.
        </p>
      </DocsSection>

      <DocsSection id="mint-burn" title="Mint & burn">
        <p>
          Mint and burn are the primary on-ramp and off-ramp. Swap Ansem ↔
          BULLET at the protocol curve on{" "}
          <Link href="/mint-and-burn">Mint &amp; Burn</Link>.
        </p>

        <DocsSteps
          steps={[
            {
              title: "Deposit",
              body: "Send Ansem to mint BULLET at the floor minus the 2.5% protocol fee.",
            },
            {
              title: "Hold or borrow",
              body: "Use BULLET as collateral or track floor appreciation.",
            },
            {
              title: "Burn",
              body: "Redeem BULLET for Ansem pro-rata at the floor, net of outbound fees.",
            },
          ]}
        />

        <DocsCallout title="Trading pause">
          When <code>tradingEnabled</code> is false, mint and burn are disabled
          in the UI until the authority re-enables trading.
        </DocsCallout>
      </DocsSection>

      <DocsSection id="loans" title="Loans & leverage">
        <p>
          Borrow liquid Ansem against locked BULLET, or open a one-click
          leveraged position on <Link href="/loans">Bullet Loans</Link>.
        </p>

        <DocsDefGrid
          items={[
            {
              term: "LTV",
              definition: "Up to 99% — collateral value in Ansem terms.",
            },
            {
              term: "Interest",
              definition: "3.9% APY × days/365 + 0.1% base, paid upfront.",
            },
            {
              term: "Duration",
              definition: "1 to 365 days per loan.",
            },
            {
              term: "Leverage bake",
              definition: "1% of notional Ansem plus over-collateralization fees.",
            },
          ]}
        />

        <DocsCallout title="Expiry & liquidation">
          After <code>end_ts</code>, repay is disabled. Any wallet can liquidate
          — collateral burns and the debt stays in backing math. Manage positions
          on <Link href="/portfolio">Portfolio</Link>.
        </DocsCallout>

        <p>One active loan per wallet at a time.</p>
      </DocsSection>

      <DocsSection id="pre-deposit" title="Genesis pre-deposit">
        <p>
          Before public trading, deposit Ansem into tiered genesis vaults on{" "}
          <Link href="/pre-deposit">Pre-Deposit</Link>. After finalize, claim
          pro-rata BULLET.
        </p>

        <DocsSteps
          steps={[
            {
              title: "Deposit",
              body: "Lock Ansem in a tier up to your per-wallet allocation cap.",
            },
            {
              title: "Finalize",
              body: "Authority closes the tier; BULLET is minted for claims.",
            },
            {
              title: "Claim",
              body: "Withdraw your share of the tier bullet vault.",
            },
          ]}
        />
      </DocsSection>

      <DocsSection id="fees" title="Fees & APR">
        <DocsDefGrid
          items={[
            {
              term: "Mint / burn fee",
              definition: "2.5% — user receives 97.5% of curve output.",
            },
            {
              term: "Fee split",
              definition: "70% backing · 15% POL · 15% fee recipient.",
            },
            {
              term: "Borrow APY",
              definition: "3.9% annualized, scaled by loan duration.",
            },
            {
              term: "Base borrow fee",
              definition: "0.1% on principal, paid upfront with interest.",
            },
          ]}
        />

        <DocsCallout>
          On-chain formulas mirror <code>sdk/math.ts</code> in the repository.
        </DocsCallout>
      </DocsSection>

      <DocsSection
        id="contracts"
        title="A minimal, verifiable integration surface."
        kicker="Integration"
      >
        <p>
          Everything reads directly from Solana accounts. Index protocol and
          loan PDAs for a trust-minimized on-chain source of truth.
        </p>

        <h3 className="docs-subheading">Network</h3>
        <DocsDefGrid
          items={[
            { term: "Cluster", definition: "Solana Devnet (app default)" },
            { term: "Backing asset", definition: "Ansem (mock on devnet)" },
            { term: "Decimals", definition: "6 for BULLET and Ansem" },
          ]}
        />

        <h3 className="docs-subheading">Devnet addresses</h3>
        <div className="docs-address-list">
          <DocsAddressRow label="Program" address={PROGRAM_ID.toBase58()} />
          <DocsAddressRow label="Protocol PDA" address={PROTOCOL_PDA.toBase58()} />
          <DocsAddressRow label="BULLET mint" address={BULLET_MINT.toBase58()} />
          <DocsAddressRow label="Ansem mint (mock)" address={ANSEM_MINT.toBase58()} />
          <DocsAddressRow label="Vault" address={VAULT.toBase58()} />
          <DocsAddressRow label="POL vault" address={POL_VAULT.toBase58()} />
          <DocsAddressRow label="Collateral vault" address={COLLATERAL_VAULT.toBase58()} />
          <DocsAddressRow label="Fee recipient" address={FEE_RECIPIENT.toBase58()} />
        </div>

        <p className="docs-muted">
          Mainnet Ansem:{" "}
          <code>9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump</code>
        </p>

        <h3 className="docs-subheading">Instructions</h3>
        <DocsDefGrid
          items={[
            { term: "initialize", definition: "Create protocol, mint, vaults." },
            { term: "mint_bullet", definition: "Deposit Ansem → mint BULLET." },
            { term: "burn_bullet", definition: "Burn BULLET → Ansem." },
            { term: "borrow", definition: "Loan Ansem vs BULLET collateral." },
            { term: "repay", definition: "Repay principal, unlock collateral." },
            { term: "leverage", definition: "One-click leveraged position." },
            { term: "liquidate", definition: "Expired loan → burn collateral." },
          ]}
        />
      </DocsSection>

      <DocsSection id="risks" title="Risk disclosures">
        <p>
          BULLET is backed by Ansem, a volatile meme asset. Review addresses,
          liquidity, and transaction previews before signing.
        </p>

        <DocsKeyFacts>
          <li>The floor can rise in Ansem while USD value dumps.</li>
          <li>Smart contracts are experimental and unaudited.</li>
          <li>Loans at 99% LTV carry duration risk — expiry loses collateral.</li>
          <li>Displayed values are estimates, not execution guarantees.</li>
        </DocsKeyFacts>

        <p className="docs-muted">
          Bullet is an interface, not investment advice or a representation of
          token quality.
        </p>
      </DocsSection>
    </article>
  );
}
