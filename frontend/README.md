# Bullet Frontend

Next.js 15 UI for the Bullet protocol (banknote-style design, Solana wallet stack).

## Dev

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Config

See `src/lib/bullet.ts` (Token-2022 live deploy):

- `PROGRAM_ID` — `Gz7TX19wG7y4k8qCHt5eWQEpUMn6ALosV27PsWJDaAzJ`
- `ANSEM_MINT` — mock `6Pk6iwk927RAypbWhVwCBi6nH8Heo7Zpxkv9EvrHJWnA` (devnet faucet on Mint & Burn)
- `CLUSTER` — `devnet`
- `NEXT_PUBLIC_SOLANA_RPC_URL` — optional dedicated RPC (Helius/QuickNode). Public `api.devnet.solana.com` rate-limits (429); without a private RPC the app throttles requests and keeps last-known protocol state so the UI does not falsely show “Trading paused”.
