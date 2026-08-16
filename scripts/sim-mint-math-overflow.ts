/**
 * Simulate mint_bullet against the live deployed program.
 * Uses the correct Token-2022 account list so account mismatch is not confused
 * with curve MathOverflow. After the u128 math upgrade is deployed, expect a
 * non-MathOverflow failure (e.g. missing user ATA / insufficient funds).
 *
 * Usage: npx tsx scripts/sim-mint-math-overflow.ts
 */
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
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

const MINT_DISC = Buffer.from([9, 170, 106, 201, 179, 12, 221, 147]);

async function main() {
  const connection = new Connection(RPC, "confirmed");
  // Fake user — simulation only (no funded ATAs). Separates account errors from math.
  const user = Keypair.generate().publicKey;
  const userAnsem = getAssociatedTokenAddressSync(ANSEM_MINT, user);
  const userBullet = getAssociatedTokenAddressSync(
    BULLET_MINT,
    user,
    false,
    TOKEN_2022_PROGRAM_ID
  );
  const feeAta = getAssociatedTokenAddressSync(ANSEM_MINT, FEE_RECIPIENT);

  const amount = 1_000_000_000n; // 1000 Ansem — product overflows u64; u128 path should not
  const data = Buffer.alloc(16);
  MINT_DISC.copy(data, 0);
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
      { pubkey: userAnsem, isSigner: false, isWritable: true },
      { pubkey: userBullet, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  const tx = new Transaction().add(ix);
  tx.feePayer = user;
  const { blockhash } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;

  const sim = await connection.simulateTransaction(tx);
  console.log("err:", JSON.stringify(sim.value.err));
  console.log("logs:");
  for (const l of sim.value.logs ?? []) console.log(" ", l);

  const joined = (sim.value.logs ?? []).join("\n");
  if (joined.includes("MathOverflow") || joined.includes("6011")) {
    console.log("\nDeployed program still hits MathOverflow (6011) — u128 fix not live yet.");
  } else {
    console.log("\nNo MathOverflow — either u128 fix is live, or an earlier account/token check failed.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
