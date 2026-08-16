/**
 * Fetch live Bullet protocol state from devnet and report whether mint/burn
 * curve products (s*supply, t*backing) would overflow u64 before divide.
 * On-chain math.rs uses u128 intermediates; this script remains useful to
 * validate live magnitudes and the post-fix bigint path.
 *
 * Usage: npm run check:math-overflow
 *    or: npx tsx scripts/check-math-overflow.ts
 */
import { Connection, PublicKey } from "@solana/web3.js";
import deployed from "../deployed-devnet.json";

const RPC = "https://api.devnet.solana.com";
const U64_MAX = 2n ** 64n - 1n;

const PROTOCOL = new PublicKey(deployed.protocol);
const VAULT = new PublicKey(deployed.vault);
const BULLET_MINT = new PublicKey(deployed.bulletMint);

function readU64(data: Buffer, offset: number): bigint {
  return data.readBigUInt64LE(offset);
}

/** Mirror Protocol layout after 8-byte discriminator (see frontend decodeProtocol). */
function decodeProtocol(data: Buffer) {
  let o = 8;
  o += 32 * 7; // authority, bullet_mint, ansem_mint, vault, pol_vault, fee_recipient, collateral_vault
  o += 1 + 1; // bump, mint_bump
  const totalMinted = readU64(data, o); o += 8;
  const maxSupply = readU64(data, o); o += 8;
  const totalBorrowed = readU64(data, o); o += 8;
  const totalSupply = readU64(data, o); o += 8;
  const loanCount = readU64(data, o); o += 8;
  const tradingEnabled = data[o] === 1;
  return { totalMinted, maxSupply, totalBorrowed, totalSupply, loanCount, tradingEnabled };
}

function decodeTokenAmount(data: Buffer): bigint {
  // SPL Token account: amount at offset 64
  return readU64(data, 64);
}

function decodeMintSupply(data: Buffer): bigint {
  // Mint: supply at offset 36
  return readU64(data, 36);
}

function fmt(raw: bigint, decimals = 6): string {
  const neg = raw < 0n;
  const v = neg ? -raw : raw;
  const whole = v / 10n ** BigInt(decimals);
  const frac = (v % 10n ** BigInt(decimals)).toString().padStart(decimals, "0");
  return `${neg ? "-" : ""}${whole}.${frac}`;
}

function checkMul(a: bigint, b: bigint, label: string) {
  const product = a * b;
  const overflows = product > U64_MAX;
  console.log(`\n[${label}]`);
  console.log(`  a = ${a} (${fmt(a)})`);
  console.log(`  b = ${b} (${fmt(b)})`);
  console.log(`  a*b = ${product}`);
  console.log(`  U64_MAX = ${U64_MAX}`);
  console.log(`  overflows u64? ${overflows}`);
  if (overflows) {
    console.log(`  u128 result / denominator would be needed; product / U64_MAX ≈ ${(Number(product) / Number(U64_MAX)).toExponential(3)}`);
  }
  return { product, overflows };
}

async function main() {
  const connection = new Connection(RPC, "confirmed");

  const [protoInfo, vaultInfo, mintInfo] = await Promise.all([
    connection.getAccountInfo(PROTOCOL),
    connection.getAccountInfo(VAULT),
    connection.getAccountInfo(BULLET_MINT),
  ]);

  if (!protoInfo) throw new Error("Protocol account missing");
  if (!vaultInfo) throw new Error("Vault account missing");
  if (!mintInfo) throw new Error("Bullet mint missing");

  const proto = decodeProtocol(Buffer.from(protoInfo.data));
  const vaultBal = decodeTokenAmount(Buffer.from(vaultInfo.data));
  const mintSupply = decodeMintSupply(Buffer.from(mintInfo.data));
  const backing = vaultBal + proto.totalBorrowed;

  console.log("=== Live Bullet protocol (devnet) ===");
  console.log(`program: ${deployed.programId}`);
  console.log(`protocol: ${PROTOCOL.toBase58()}`);
  console.log(`tradingEnabled: ${proto.tradingEnabled}`);
  console.log(`vault balance: ${vaultBal} (${fmt(vaultBal)} Ansem)`);
  console.log(`totalBorrowed: ${proto.totalBorrowed} (${fmt(proto.totalBorrowed)})`);
  console.log(`backing: ${backing} (${fmt(backing)})`);
  console.log(`protocol.totalSupply: ${proto.totalSupply} (${fmt(proto.totalSupply)} BULLET)`);
  console.log(`mint.supply: ${mintSupply} (${fmt(mintSupply)})`);
  console.log(`totalMinted: ${proto.totalMinted} (${fmt(proto.totalMinted)})`);
  console.log(`maxSupply: ${proto.maxSupply} (${fmt(proto.maxSupply)})`);

  // Sample mint sizes: 1 Ansem, 100 Ansem, 1000 Ansem (raw 6-dec)
  const mintSamples = [
    1_000_000n, // 1
    100_000_000n, // 100
    1_000_000_000n, // 1000
  ];

  console.log("\n=== Mint path: ansem_to_bullet_gross = s * supply / (backing_after - s) ===");
  console.log("Pre-fix bug: u64 checked_mul(s, supply) before divide. Fixed path uses u128.");

  let mintOverflows = false;
  for (const s of mintSamples) {
    // After deposit, backing_for_curve = backing + s (fees skimmed after curve calc uses vault_after_in)
    const backingAfter = backing + s;
    const backingBefore = backingAfter - s; // == backing
    const mul = checkMul(s, proto.totalSupply, `mint s=${fmt(s)}`);
    if (mul.overflows) mintOverflows = true;
    if (backingBefore > 0n) {
      const grossU128 = mul.product / backingBefore;
      console.log(`  gross (u128) = ${grossU128} (${fmt(grossU128)} BULLET)`);
      console.log(`  net after 5% haircut = ${(grossU128 * 950n) / 1000n}`);
    }
  }

  // Also: floor_scaled = backing * 1e6 / supply
  console.log("\n=== floor_scaled = backing * 1e6 / supply ===");
  const floorMul = checkMul(backing, 1_000_000n, "floor_scaled");

  console.log("\n=== Burn path: bullet_to_ansem_gross = t * backing / supply ===");
  const burnSamples = [
    1_000_000n,
    100_000_000n,
    1_000_000_000n,
    proto.totalSupply > 0n ? proto.totalSupply / 100n || 1n : 1n,
  ];

  let burnOverflows = false;
  for (const t of burnSamples) {
    if (t === 0n || t > proto.totalSupply) continue;
    const mul = checkMul(t, backing, `burn t=${fmt(t)}`);
    if (mul.overflows) burnOverflows = true;
    if (proto.totalSupply > 0n) {
      const grossU128 = mul.product / proto.totalSupply;
      console.log(`  gross (u128) = ${grossU128} (${fmt(grossU128)} Ansem)`);
    }
  }

  // Threshold: smallest s where s * supply > U64_MAX
  if (proto.totalSupply > 0n) {
    const minSOverflow = U64_MAX / proto.totalSupply + 1n;
    console.log(`\n=== Overflow thresholds ===`);
    console.log(`Any mint with s >= ${minSOverflow} (${fmt(minSOverflow)} Ansem) overflows u64 mul vs supply`);
    if (backing > 0n) {
      const minTOverflow = U64_MAX / backing + 1n;
      console.log(`Any burn with t >= ${minTOverflow} (${fmt(minTOverflow)} BULLET) overflows u64 mul vs backing`);
    }
  }

  console.log("\n=== VERDICT ===");
  console.log(`mint path overflows u64 for typical amounts: ${mintOverflows}`);
  console.log(`burn path overflows u64 for typical amounts: ${burnOverflows}`);
  console.log(`floor_scaled overflows u64: ${floorMul.overflows}`);
  if (mintOverflows || burnOverflows) {
    console.log("NOTE: products exceed u64; on-chain must use u128 intermediates (math.rs does).");
  }

  // Post-fix check: same formulas with bigint (u128) succeed.
  console.log("\n=== Post-fix u128 path (mirrors fixed math.rs) ===");
  const s = 1_000_000_000n;
  const t = 1_000_000_000n;
  const mintGross = (s * proto.totalSupply) / backing;
  const burnGross = (t * backing) / proto.totalSupply;
  console.log(`mint 1000 Ansem → gross BULLET (u128) = ${mintGross} (${fmt(mintGross)})`);
  console.log(`burn 1000 BULLET → gross Ansem (u128) = ${burnGross} (${fmt(burnGross)})`);
  console.log(`both fit in u64 result? ${mintGross <= U64_MAX && burnGross <= U64_MAX}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
