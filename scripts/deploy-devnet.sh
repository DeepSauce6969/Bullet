#!/usr/bin/env bash
# Deploy Bullet to Solana Devnet.
# Requires ~3.5 SOL in ~/.config/solana/id.json
# Fund via https://faucet.solana.com (devnet) if CLI airdrop is rate-limited.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export PATH="${HOME}/.avm/bin:${HOME}/.local/share/solana/install/active_release/bin:${HOME}/.cargo/bin:${PATH}"

solana config set --url https://api.devnet.solana.com
solana balance

if [[ ! -f target/deploy/bullet.so ]]; then
  echo "Building..."
  anchor build --no-idl
fi

solana program deploy target/deploy/bullet.so --program-id target/deploy/bullet-keypair.json
solana program show "$(solana-keygen pubkey target/deploy/bullet-keypair.json)"
