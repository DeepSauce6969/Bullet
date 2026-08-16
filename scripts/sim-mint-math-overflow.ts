/**
 * Simulate mint_bullet against the live Dae3 program (classic SPL Token mint).
 * Uses a funded wallet so the sim reaches curve math (not AccountNotFound).
 *
 * Usage: npx tsx scripts/sim-mint-math-overflow.ts
 *        MINT_AMOUNT=1000 npx tsx scripts/sim-mint-math-overflow.ts
 */
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  Connection,
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
  const user = process.env.MINT_USER
    ? new PublicKey(process.env.MINT_USER)
    : FEE_RECIPIENT;
  const userAnsem = getAssociatedTokenAddressSync(ANSEM_MINT, user);
  const userBullet = getAssociatedTokenAddressSync(BULLET_MINT, user);
  const feeAta = getAssociatedTokenAddressSync(ANSEM_MINT, FEE_RECIPIENT);

  const ansemBal = await getAccount(connection, userAnsem);
  const human = Number(process.env.MINT_AMOUNT ?? "1000");
  const amount = BigInt(Math.floor(human * 1e6));
  console.log({
    user: user.toBase58(),
    ansemBal: ansemBal.amount.toString(),
    mintAnsem: amount.toString(),
  });

  const data = Buffer.alloc(16);
  MINT_DISC.copy(data, 0);
  data.writeBigUInt64LE(amount, 8);

  const tx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(
      user,
      userBullet,
      user,
      BULLET_MINT
    ),
    new TransactionInstruction({
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
        { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    })
  );

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
    console.log("\nOK: mint sim succeeded (no MathOverflow).");
  } else {
    console.log(
      "\nNo MathOverflow — sim failed earlier/later for another reason (see logs)."
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
