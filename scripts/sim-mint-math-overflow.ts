/**
 * Simulate mint_bullet against live deployed program to confirm error code.
 * Uses correct Token-2022 account list so failure is math, not account mismatch.
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
  // Fake user — simulation only; will fail on token balance if it gets past math,
  // but with 1000 Ansem mint we expect MathOverflow first on current program.
  const user = Keypair.generate().publicKey;
  const userAnsem = getAssociatedTokenAddressSync(ANSEM_MINT, user);
  const userBullet = getAssociatedTokenAddressSync(
    BULLET_MINT,
    user,
    false,
    TOKEN_2022_PROGRAM_ID
  );
  const feeAta = getAssociatedTokenAddressSync(ANSEM_MINT, FEE_RECIPIENT);

  const amount = 1_000_000_000n; // 1000 Ansem — overflows u64 mul on live supply
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
    console.log("\nCONFIRMED: simulation hits MathOverflow (6011) with correct Token-2022 accounts.");
  } else {
    console.log("\nDid not see MathOverflow — earlier account/token failure may have won.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
