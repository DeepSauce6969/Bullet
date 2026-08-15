#!/usr/bin/env bash
# Upgrade the EXISTING Bullet program on Solana Devnet.
# Keeps program id 4PTGwC7KTRZhjhKgXXrD9WTRyoCb8cpKWy6HAsaMXvBj (does NOT deploy a new id).
#
# Required secret:
#   Upgrade authority keypair whose pubkey is:
#     5RE5aMBxrUkD9iEfX5Tj5E5CCpNZhdGptswAV8nYF1bK
#   Format: Solana CLI JSON byte-array keypair file, e.g.
#     [12,34,56,...]   (64 integers, same as `solana-keygen new` / Phantom export as JSON)
#   Place it at one of:
#     $UPGRADE_AUTHORITY_KEYPAIR   (env override, preferred)
#     ~/.config/solana/bullet-upgrade-authority.json
#
# Do NOT run `anchor keys sync` — that would change declare_id! / program id.
# Fee payer needs ~2–4 SOL on devnet (authority key or ~/.config/solana/id.json).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export PATH="${HOME}/.avm/bin:${HOME}/.local/share/solana/install/active_release/bin:${HOME}/.cargo/bin:${PATH}"

PROGRAM_ID="4PTGwC7KTRZhjhKgXXrD9WTRyoCb8cpKWy6HAsaMXvBj"
EXPECTED_AUTHORITY="5RE5aMBxrUkD9iEfX5Tj5E5CCpNZhdGptswAV8nYF1bK"
AUTHORITY_KEYPAIR="${UPGRADE_AUTHORITY_KEYPAIR:-${HOME}/.config/solana/bullet-upgrade-authority.json}"

if [[ ! -f "$AUTHORITY_KEYPAIR" ]]; then
  echo "Missing upgrade authority keypair at:"
  echo "  $AUTHORITY_KEYPAIR"
  echo ""
  echo "Provide the Solana JSON keypair for pubkey $EXPECTED_AUTHORITY"
  echo "via UPGRADE_AUTHORITY_KEYPAIR=/path/to/keypair.json"
  exit 1
fi

AUTHORITY_PUBKEY="$(solana-keygen pubkey "$AUTHORITY_KEYPAIR")"
if [[ "$AUTHORITY_PUBKEY" != "$EXPECTED_AUTHORITY" ]]; then
  echo "Wrong keypair: got $AUTHORITY_PUBKEY"
  echo "Expected upgrade authority: $EXPECTED_AUTHORITY"
  exit 1
fi

solana config set --url https://api.devnet.solana.com >/dev/null

echo "=== Current on-chain program ==="
solana program show "$PROGRAM_ID"

echo ""
echo "=== Building (no key sync) ==="
# Use existing declare_id; do not regenerate program keypair
anchor build --no-idl

SO_PATH="target/deploy/bullet.so"
if [[ ! -f "$SO_PATH" ]]; then
  echo "Missing $SO_PATH after build"
  exit 1
fi

echo ""
echo "=== Upgrading program $PROGRAM_ID ==="
echo "Upgrade authority: $AUTHORITY_PUBKEY"
echo "Artifact: $SO_PATH"

# Deploy/upgrade in place — same program id, authority signs the upgrade.
solana program deploy "$SO_PATH" \
  --program-id "$PROGRAM_ID" \
  --upgrade-authority "$AUTHORITY_KEYPAIR" \
  --url https://api.devnet.solana.com

echo ""
echo "=== Post-upgrade ==="
solana program show "$PROGRAM_ID"

echo ""
echo "Verify leverage no longer hits FloorWouldDecrease:"
echo "  npx tsx scripts/simulate-leverage-devnet.ts"
