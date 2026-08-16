# Bullet

Ansem-backed, up-only protocol on Solana. Two components:

- **Anchor program** (`programs/bullet/`) — the on-chain Solana program (Rust/Anchor `0.31.1`). Client tests in `tests/bullet.ts`, client helpers in `sdk/` and `scripts/`.
- **Frontend** (`frontend/`) — Next.js 15 dApp (Solana wallet stack) that reads the protocol on Solana devnet. This is the primary user-facing app.

See `README.md` and `frontend/README.md` for protocol mechanics and standard commands.

## Cursor Cloud specific instructions

The Solana + Anchor toolchain and Node deps are already installed in this environment (persisted in the VM). The startup update script only refreshes npm packages (`npm install` at the repo root and in `frontend/`); it does NOT reinstall the Solana/Anchor toolchain. The notes below are the non-obvious gotchas.

### Toolchain / PATH (non-obvious)

- Solana + Anchor are on `PATH` via `~/.bashrc`: `~/.local/share/solana/install/active_release/bin` and `/usr/local/cargo/bin`. New non-login shells should already pick these up; if `anchor`/`solana` are "not found", re-source `~/.bashrc`.
- Installed versions: `anchor-cli 0.31.1` (via `avm`), Agave/Solana `3.1.2`, host Rust `stable` (used for `avm`/IDL builds) plus the repo-pinned `1.85.0` (`rust-toolchain.toml`).

### Building the Anchor program — the critical gotcha

The committed `Cargo.lock` pins `edition2024` crates (e.g. `zeroize_derive 1.5.0`), which require **platform-tools ≥ v1.52 (Rust 1.89 / cargo 1.85+)**. `anchor build` fails otherwise with `feature 'edition2024' is required ... cargo 1.79.0`.

- `anchor build` (0.31.1) force-activates Solana `2.1.0`, whose bundled `cargo-build-sbf` uses platform-tools **v1.43 (cargo 1.79)** — too old. To avoid fighting this on every build, the `2.1.0` release dir is symlinked to the `3.1.2` release: `~/.local/share/solana/install/releases/2.1.0/solana-release -> ../3.1.2/solana-release`. This makes anchor's forced `2.1.0` resolve to v1.52 tools, so plain `anchor build` and `anchor test` work. Keep this symlink; if it's ever lost, `agave-install init 3.1.2` and re-create it (original is at `2.1.0/solana-release.orig`).
- First SBF build downloads platform-tools v1.52 into `~/.cache/solana/` (large, one-time). It is already cached here.

### BULLET Token-2022 + transfer hook (DEX-only)

- BULLET is a **Token-2022** mint with **`TransferFeeConfig`** (default **800 bps / 8%**, adjustable via fee authority) and a **`TransferHook`** pointing at `bullet-transfer-hook`.
- The hook **allows transfers only when source or destination is a registered DEX pool** (or an exempt protocol account). Wallet-to-wallet transfers are **blocked** unless exempt.
- `TransferFeeConfig` cannot distinguish buy/sell vs P2P on its own — the hook provides the DEX gate; the fee applies on transfers that pass the gate.
- Protocol paths use **mint/burn** (not `transfer`) so mint/burn/borrow/leverage are not taxed.
- Mint has **no freeze authority** (`None`) for Meteora DLMM permissionless compatibility.
- Hook program id: `DYEKb6VJpHqjGKNhoDyG1uijqFbdgn69yb8N3R4jAhzp`
- Local tests: `npm run test:localnet` (includes `tests/transfer_hook.ts`).

### Running the localnet tests

- `anchor test` uses `[provider] cluster = "Devnet"` from `Anchor.toml`, so plain `anchor test` targets **devnet**. For the local smoke tests (initialize/mint/borrow) run against a local validator instead:
  `anchor test --provider.cluster localnet`
- Localnet requires the program's deploy address to equal `declare_id!` in `programs/bullet/src/lib.rs` (and the hook's `declare_id!` in `programs/bullet-transfer-hook/src/lib.rs`). Matching program keypairs are git-ignored. Fresh `target/deploy/*-keypair.json` files won't match the committed ids (`Dae3D7…` / `DYEK…`). To run localnet tests: generate keypairs if missing, temporarily `anchor keys sync` (updates both `declare_id!`s + `Anchor.toml`), then `anchor test --provider.cluster localnet`. `TRANSFER_HOOK_PROGRAM_ID` in the bullet program tracks `bullet_transfer_hook::ID`, so it follows the synced hook id automatically. **Revert those tracked-file edits afterward** (`git checkout Anchor.toml programs/bullet/src/lib.rs programs/bullet-transfer-hook/src/lib.rs`) — do not commit them.
- A provider wallet at `~/.config/solana/id.json` is required; if missing, `solana-keygen new -o ~/.config/solana/id.json`. The local validator funds it automatically.

### Frontend

- `cd frontend && npm run dev` serves the app at http://localhost:3000. It reads live protocol state from Solana **devnet**; write actions (mint/burn/borrow/genesis deposit) need a connected browser wallet (Phantom/Solflare). Home + Mint/Burn quote math render without a wallet.
- Next.js warns about "multiple lockfiles" (root + `frontend/`); this is harmless.

### Lint / lockfile caveats

- Frontend lint (`cd frontend && npm run lint` → bare `eslint`) currently fails: there is no ESLint v9 flat config (`eslint.config.*`) in the repo, so ESLint 9 errors out. This is a pre-existing repo state, not an environment issue.
- Root lint is `npm run lint` → `prettier --check`. It reports style diffs on existing source and on `frontend/.next/` build output (no prettier-ignore); the command runs, it just isn't clean.
- `npm install` re-writes `frontend/package-lock.json` (committed lockfile was generated with a different npm version). This churn is expected; discard it (`git checkout frontend/package-lock.json`) if you don't intend to update deps.

### Devnet leverage / program upgrade / redeploy

- Old program `4PTGwC7…` (authority `5RE5a…`) still has the buggy leverage bytecode. If that authority key is lost, do a **fresh redeploy** instead of upgrade.
- Fresh redeploy (new program id, new PDAs, new mock Ansem): fund deployer `~/.config/solana/id.json` with ~5 SOL on devnet, then `npm run redeploy:devnet` (`scripts/redeploy-devnet.sh`). This runs keys sync → build → deploy → init → genesis → `sync-frontend-addresses`.
- After redeploy, commit updated `deployed-devnet.json`, `programs/bullet/src/lib.rs` `declare_id!`, `Anchor.toml`, and `frontend/src/lib/bullet.ts` addresses.
- Keep the deployer seed phrase **out of git** (`~/.config/solana/DEPLOYER_SEED.txt`, gitignored). Store it as a Cursor secret for future agents.
- Smoke check: `npm run simulate:leverage` (expect `"err": null`).
- In-place upgrade of `4PTGwC7…` only if you recover the `5RE5a…` keypair: `npm run upgrade:devnet`.
