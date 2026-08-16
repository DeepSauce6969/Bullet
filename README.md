# Bullet

**Ansem-backed** up-only protocol on Solana — mint / burn / loans / leverage, **no Uniswap v4 hooks**.

## Backing asset

| Network | Token | Mint |
|---------|-------|------|
| Solana mainnet | Ansem | `9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump` |

Protocol token: **$BULLET** (6 decimals, max supply **5,000,000** by default).

## Scope

| Feature | Bullet |
|---------|--------|
| Mint (Ansem → BULLET) | Yes |
| Burn (BULLET → Ansem) | Yes |
| Floor up-only | Yes (`Backing / supply`) |
| Loans ~99% LTV | Yes |
| Leverage one-click | Yes |
| Liquidate expired loans | Yes |
| Fee split 70/15/15 | Yes (backing / POL / bribes) |
| Uniswap v4 hook | **No** — protocol mint/burn is the primary market |
| Hydrex bribes | Bribe wallet only (no ve3,3 DEX wiring yet) |

## Mechanics

```
Backing = vault_Ansem + total_borrowed
Floor   = Backing / total_supply   (never decreases)
```

- **Mint**: 5% fee, user gets 95% of curve output; 70% of fee stays in backing.
- **Burn**: redeem pro-rata Ansem at 95%; same fee split.
- **Borrow**: lock BULLET, borrow ≤ 99% LTV in Ansem; interest = 7.8% APY × days/365 + 0.2% base, paid upfront.
- **Leverage**: 2% bake + interest on borrow leg + 2% over-collateral; mints leveraged BULLET into collateral vault.
- **DEX trading**: 8% transfer fee on registered pool swaps (Token-2022 hook); wallet-to-wallet transfers blocked.
- **Genesis pre-deposit**: tier fees 0% / 2.5% / 4% (VIP / Community / Public); **100% of tier fee → POL** on finalize.
- **Liquidate**: after expiry, burn collateral; borrowed Ansem stays in backing math → floor rises for holders.

## Repo layout

```
programs/bullet/   Anchor program
sdk/math.ts        Client-side fee/floor helpers
tests/bullet.ts    Localnet smoke tests
```

## Setup (Windows)

Toolchain is **not** pre-installed on this machine. Install then build:

1. [Rust](https://rustup.rs/)
2. [Solana CLI](https://docs.solana.com/cli/install-solana-cli-tools) (`solana-install init 1.18.26` or Agave)
3. Anchor via AVM:
   ```powershell
   cargo install --git https://github.com/coral-xyz/anchor avm --locked
   avm install 0.30.1
   avm use 0.30.1
   ```
4. In this repo:
   ```powershell
   yarn install
   anchor keys sync   # regenerates program id if needed
   anchor build
   anchor test
   ```

### Mainnet init

Pass the real Ansem mint at `initialize`:

```ts
ansemMint: new PublicKey("9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump")
```

Create the bribe wallet’s Ansem ATA before the first mint/burn/borrow.

## Instructions

| IX | Description |
|----|-------------|
| `initialize` | Create protocol PDA, BULLET mint, vaults |
| `mint_bullet` | Deposit Ansem → mint BULLET |
| `burn_bullet` | Burn BULLET → Ansem |
| `borrow` | Loan Ansem vs BULLET collateral |
| `repay` | Repay principal, unlock collateral |
| `leverage` | One-click leveraged position |
| `liquidate` | Expire loan → burn collateral |
| `set_fee_recipient` | Update bribe wallet |

## Risk note

Bullet’s floor is denominated in **Ansem** (a meme), not USD. The floor can rise in Ansem terms while the USD value dumps. Loans/leverage at 99% LTV on a volatile meme liquidate easily.

## Program id (placeholder)

`B32QL2ecw22eUTmoqrsq7a5EDJRkpsiq4EapKGrFk26s` — run `anchor keys sync` before deploy so the keypair matches.
