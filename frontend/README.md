# Bullet Frontend

Next.js 15 UI for the Bullet protocol (banknote-style design, Solana wallet stack).

## Dev

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Config

See `src/lib/bullet.ts`:

- `PROGRAM_ID` — `B32QL2ecw22eUTmoqrsq7a5EDJRkpsiq4EapKGrFk26s`
- `ANSEM_MINT` — `9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump`
- `CLUSTER` — `devnet`

Tx actions call typed stubs until the Anchor IDL is copied into `src/idl/bullet.json`.
