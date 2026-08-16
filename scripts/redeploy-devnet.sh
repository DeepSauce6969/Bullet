#!/usr/bin/env bash
# Full fresh redeploy of Bullet + transfer-hook to Solana Devnet.
# Creates NEW program ids (does not upgrade the previous Dae3 deploy).
#
# Prerequisites:
#   - ~/.config/solana/id.json funded with ~8+ SOL on devnet
#   - Seed phrase saved securely (see ~/.config/solana/DEPLOYER_SEED.txt)
#
# Steps: keys sync → build → deploy bullet + hook → init → genesis → hook setup → sync frontend

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export PATH="${HOME}/.avm/bin:${HOME}/.local/share/solana/install/active_release/bin:${HOME}/.cargo/bin:${PATH}"

solana config set --url https://api.devnet.solana.com >/dev/null

PAYER="$(solana-keygen pubkey ~/.config/solana/id.json)"
BAL="$(solana balance --lamports | awk '{print $1}')"
echo "Deployer: $PAYER"
echo "Balance lamports: $BAL"
if (( BAL < 7000000000 )); then
  echo "Need ~7+ SOL on devnet for bullet + transfer-hook. Fund $PAYER then re-run."
  exit 1
fi

echo ""
echo "=== Sync program ids (bullet + bullet_transfer_hook) ==="
mkdir -p target/deploy
# Always mint a NEW bullet keypair — closed program ids cannot be redeployed.
solana-keygen new -o target/deploy/bullet-keypair.json --no-bip39-passphrase --force >/dev/null
if [[ ! -f target/deploy/bullet_transfer_hook-keypair.json ]]; then
  solana-keygen new -o target/deploy/bullet_transfer_hook-keypair.json --no-bip39-passphrase --force >/dev/null
fi

anchor keys sync

PROGRAM_ID="$(solana-keygen pubkey target/deploy/bullet-keypair.json)"
HOOK_ID="$(solana-keygen pubkey target/deploy/bullet_transfer_hook-keypair.json)"

python3 - <<PY
from pathlib import Path
import re
pid = "$PROGRAM_ID"
hid = "$HOOK_ID"
text = Path("Anchor.toml").read_text()
text = re.sub(r'(bullet = ")[^"]+', r'\g<1>' + pid, text)
text = re.sub(r'(bullet_transfer_hook = ")[^"]+', r'\g<1>' + hid, text)
Path("Anchor.toml").write_text(text)
print("Anchor.toml → bullet", pid)
print("Anchor.toml → bullet_transfer_hook", hid)
PY

# Patch declare_id in source if keys sync missed anything
python3 - <<PY
from pathlib import Path
import re
pid = "$PROGRAM_ID"
hid = "$HOOK_ID"
lib = Path("programs/bullet/src/lib.rs")
t = lib.read_text()
t2 = re.sub(r'declare_id!\("[^"]+"\)', f'declare_id!("{pid}")', t, count=1)
lib.write_text(t2)
hook = Path("programs/bullet-transfer-hook/src/lib.rs")
t = hook.read_text()
t2 = re.sub(r'declare_id!\("[^"]+"\)', f'declare_id!("{hid}")', t, count=1)
hook.write_text(t2)
print("declare_id patched")
PY

echo ""
echo "=== Build ==="
anchor build

echo ""
echo "=== Deploy transfer hook $HOOK_ID ==="
solana program deploy target/deploy/bullet_transfer_hook.so \
  --program-id target/deploy/bullet_transfer_hook-keypair.json \
  --url https://api.devnet.solana.com

echo ""
echo "=== Deploy bullet $PROGRAM_ID ==="
solana program deploy target/deploy/bullet.so \
  --program-id target/deploy/bullet-keypair.json \
  --url https://api.devnet.solana.com

solana program show "$PROGRAM_ID"
solana program show "$HOOK_ID"

echo ""
echo "=== Patch script PROGRAM_ID / HOOK_ID constants ==="
python3 - <<PY
from pathlib import Path
import re
pid = "$PROGRAM_ID"
hid = "$HOOK_ID"
for rel in (
    "scripts/init-devnet.ts",
    "scripts/init-genesis-vaults.ts",
    "scripts/mint-test-devnet.ts",
    "scripts/simulate-leverage-devnet.ts",
    "scripts/sim-mint-math-overflow.ts",
    "scripts/sim-burn-math-overflow.ts",
    "scripts/sim-repay-and-maxloop.ts",
):
    p = Path(rel)
    if not p.exists():
        continue
    t = p.read_text()
    t2 = re.sub(
        r'const PROGRAM_ID = new PublicKey\("[^"]+"\)',
        f'const PROGRAM_ID = new PublicKey("{pid}")',
        t,
        count=1,
    )
    t2 = re.sub(
        r'const TRANSFER_HOOK_PROGRAM_ID = new PublicKey\(\s*\n?\s*"[^"]+"\s*\n?\s*\)',
        f'const TRANSFER_HOOK_PROGRAM_ID = new PublicKey(\n  "{hid}"\n)',
        t2,
        count=1,
    )
    # Also single-line form
    t2 = re.sub(
        r'const TRANSFER_HOOK_PROGRAM_ID = new PublicKey\("[^"]+"\)',
        f'const TRANSFER_HOOK_PROGRAM_ID = new PublicKey("{hid}")',
        t2,
        count=1,
    )
    p.write_text(t2)
    print("patched", rel)
PY

echo ""
echo "=== Init protocol (mock Ansem + Token-2022 BULLET) ==="
npx tsx scripts/init-devnet.ts

echo ""
echo "=== Init genesis vaults ==="
npx tsx scripts/init-genesis-vaults.ts

echo ""
echo "=== Setup transfer hook (config + extras + exempts) ==="
npx tsx scripts/setup-transfer-hook-devnet.ts

echo ""
echo "=== Sync frontend addresses ==="
npx tsx scripts/sync-frontend-addresses.ts

echo ""
echo "=== Smoke: simulate leverage ==="
npx tsx scripts/simulate-leverage-devnet.ts || true

echo ""
echo "Redeploy complete."
echo "  bullet:  $PROGRAM_ID"
echo "  hook:    $HOOK_ID"
echo "  addresses: deployed-devnet.json + frontend/src/lib/bullet.ts"
