/**
 * Simulate burn_bullet against the live Dae3 program (classic SPL Token mint).
 * Prefers a wallet that already holds BULLET so the sim reaches curve math.
 *
 * Usage: npx tsx scripts/sim-burn-math-overflow.ts
 *        BURN_AMOUNT=1000 npx tsx scripts/sim-burn-math-overflow.ts
 */
import {
  TOKEN_PROGRAM_ID,
  getAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import deployed from "../deployed-devnet.json";

const RPC = "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey(deployed.programId);
const PROTOCOL = new PublicKey(deployed.protocol);
const BULLET_MINT = new PublicKey(deployed.bulletMint);
const ANSEM_MINT = new PublicKey(deployed.ansemMint);
const VAULT = new PublicKey(deployed.vault);
const POL_VAULT = new PublicKey(deployed.polVault);
const FEE_RECIPIENT = new PublicKey(deployed.feeRecipient);

const BURN_DISC = Buffer.from([137, 161, 76, 144, 165, 163, 220, 83]);

async function findBulletHolder(
  connection: Connection
): Promise<{ user: PublicKey; bal: bigint } | null> {
  const candidates = [FEE_RECIPIENT];
  if (process.env.BURN_USER) candidates.unshift(new PublicKey(process.env.BURN_USER));

  for (const user of candidates) {
    try {
      const ata = getAssociatedTokenAddressSync(BULLET_MINT, user);
      const acc = await getAccount(connection, ata);
      if (acc.amount > 0n) return { user, bal: acc.amount };
    } catch {
      /* continue */
    }
  }

  // Scan recent program signers for a BULLET holder.
  const sigs = await connection.getSignaturesForAddress(PROGRAM_ID, { limit: 40 });
  for (const s of sigs) {
    const tx = await connection.getTransaction(s.signature, {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    });
    if (!tx) continue;
    const keys = tx.transaction.message.getAccountKeys
      ? tx.transaction.message.getAccountKeys().staticAccountKeys
      : (tx.transaction.message as { accountKeys: PublicKey[] }).accountKeys;
    const signer = keys[0];
    try {
      const ata = getAssociatedTokenAddressSync(BULLET_MINT, signer);
      const acc = await getAccount(connection, ata);
      if (acc.amount > 1_000_000n) return { user: signer, bal: acc.amount };
    } catch {
      /* continue */
    }
  }
  return null;
}

async function main() {
  const connection = new Connection(RPC, "confirmed");
  const holder = await findBulletHolder(connection);
  if (!holder) throw new Error("No BULLET holder found for burn sim");

  const { user, bal } = holder;
  const userAnsem = getAssociatedTokenAddressSync(ANSEM_MINT, user);
  const userBullet = getAssociatedTokenAddressSync(BULLET_MINT, user);
  const feeAta = getAssociatedTokenAddressSync(ANSEM_MINT, FEE_RECIPIENT);

  const human = Number(process.env.BURN_AMOUNT ?? "1000");
  let amount = BigInt(Math.floor(human * 1e6));
  if (amount > bal) amount = bal;
  // Prefer a large burn that would overflow u64 path when possible.
  if (!process.env.BURN_AMOUNT && bal > amount) {
    amount = bal > 1_000_000_000n ? 1_000_000_000n : bal;
  }

  console.log({
    user: user.toBase58(),
    bulletBal: bal.toString(),
    burnBullet: amount.toString(),
  });

  const data = Buffer.alloc(16);
  BURN_DISC.copy(data, 0);
  data.writeBigUInt64LE(amount, 8);

  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: PROTOCOL, isSigner: false, isWritable: true },
      { pubkey: BULLET_MINT, isSigner: false, isWritable: true },
      { pubkey: ANSEM_MINT, isSigner: false, isWritable: false },
      { pubkey: VAULT, isSigner: false, isWritable: true },
      { pubkey: POL_VAULT, isSigner: false, isWritable: true },
      { pubkey: FEE_RECIPIENT, isSigner: false, isWritable: false },
      { pubkey: feeAta, isSigner: false, isWritable: true },
      { pubkey: userBullet, isSigner: false, isWritable: true },
      { pubkey: userAnsem, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  });

  const tx = new Transaction().add(ix);
  tx.feePayer = user;
  const { blockhash } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;

  const sim = await connection.simulateTransaction(tx);
  console.log("err:", JSON.stringify(sim.value.err));
  console.log("units:", sim.value.unitsConsumed);
  console.log("logs:");
  for (const l of sim.value.logs ?? []) console.log(" ", l);

  const joined = (sim.value.logs ?? []).join("\n");
  if (joined.includes("MathOverflow") || joined.includes("6011")) {
    console.log("\nFAIL: MathOverflow (6011) still live.");
    process.exit(1);
  }
  if (sim.value.err == null) {
    console.log("\nOK: burn sim succeeded (no MathOverflow).");
  } else {
    console.log(
      "\nNo MathOverflow — sim failed for another reason (see logs)."
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
