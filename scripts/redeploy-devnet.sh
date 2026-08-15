#!/usr/bin/env bash
# Full fresh redeploy of Bullet to Solana Devnet with the CURRENT wallet
# (~/.config/solana/id.json). Creates a NEW program id (does not upgrade 4PTGwC7…).
#
# Prerequisites:
#   - ~/.config/solana/id.json funded with ~5+ SOL on devnet
#   - Seed phrase saved securely (see ~/.config/solana/DEPLOYER_SEED.txt)
#
# Steps: keys sync → build → deploy → init protocol → genesis vaults → sync frontend

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export PATH="${HOME}/.avm/bin:${HOME}/.local/share/solana/install/active_release/bin:${HOME}/.cargo/bin:${PATH}"

solana config set --url https://api.devnet.solana.com >/dev/null

PAYER="$(solana-keygen pubkey ~/.config/solana/id.json)"
BAL="$(solana balance --lamports | awk '{print $1}')"
echo "Deployer: $PAYER"
echo "Balance lamports: $BAL"
if (( BAL < 4500000000 )); then
  echo "Need ~4.5+ SOL on devnet. Fund $PAYER at https://faucet.solana.com then re-run."
  exit 1
fi

echo ""
echo "=== Sync program id to target/deploy/bullet-keypair.json ==="
anchor keys sync
PROGRAM_ID="$(solana-keygen pubkey target/deploy/bullet-keypair.json)"
# Ensure all clusters in Anchor.toml match (anchor keys sync can miss some)
python3 - <<PY
from pathlib import Path
pid = "$PROGRAM_ID"
text = Path("Anchor.toml").read_text()
import re
text2 = re.sub(r'(bullet = ")[^"]+', r'\g<1>' + pid, text)
Path("Anchor.toml").write_text(text2)
print("Anchor.toml program ids →", pid)
PY

echo ""
echo "=== Build ==="
anchor build

echo ""
echo "=== Deploy program $PROGRAM_ID ==="
solana program deploy target/deploy/bullet.so \
  --program-id target/deploy/bullet-keypair.json \
  --url https://api.devnet.solana.com

solana program show "$PROGRAM_ID"

echo ""
echo "=== Init protocol (mock Ansem + initialize) ==="
# Patch PROGRAM_ID constant in init scripts to the new id, then run
python3 - <<PY
from pathlib import Path
pid = "$PROGRAM_ID"
for rel in ("scripts/init-devnet.ts", "scripts/init-genesis-vaults.ts", "scripts/mint-test-devnet.ts", "scripts/simulate-leverage-devnet.ts"):
    p = Path(rel)
    if not p.exists():
        continue
    t = p.read_text()
    import re
    t2 = re.sub(
        r'const PROGRAM_ID = new PublicKey\("[^"]+"\)',
        f'const PROGRAM_ID = new PublicKey("{pid}")',
        t,
        count=1,
    )
    # simulate script may load from deployed-devnet.json only — still ok
    if "const PROGRAM_ID" in t:
        p.write_text(t2)
        print("patched", rel)
PY

npx tsx scripts/init-devnet.ts

echo ""
echo "=== Init genesis vaults ==="
npx tsx scripts/init-genesis-vaults.ts

echo ""
echo "=== Sync frontend addresses ==="
npx tsx scripts/sync-frontend-addresses.ts

echo ""
echo "=== Smoke: simulate leverage ==="
npx tsx scripts/simulate-leverage-devnet.ts || true

echo ""
echo "DONE. New program id: $PROGRAM_ID"
echo "Upgrade authority / fee recipient: $PAYER"
echo "Save seed: ~/.config/solana/DEPLOYER_SEED.txt (DO NOT commit)"
echo "Review deployed-devnet.json and frontend/src/lib/bullet.ts"
