/**
 * Simulate mint_bullet against the live Token-2022 deploy.
 * Usage: MINT_AMOUNT=100 npx tsx scripts/sim-mint-math-overflow.ts
 */
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
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
  const userBullet = getAssociatedTokenAddressSync(
    BULLET_MINT,
    user,
    false,
    TOKEN_2022_PROGRAM_ID
  );
  const feeAta = getAssociatedTokenAddressSync(ANSEM_MINT, FEE_RECIPIENT);

  const ansemBal = await getAccount(connection, userAnsem);
  const human = Number(process.env.MINT_AMOUNT ?? "100");
  const amount = BigInt(Math.floor(human * 1e6));
  console.log({
    user: user.toBase58(),
    ansemBal: ansemBal.amount.toString(),
    mintAnsem: amount.toString(),
    bulletMintOwner: (await connection.getAccountInfo(BULLET_MINT))?.owner.toBase58(),
  });

  const data = Buffer.alloc(16);
  MINT_DISC.copy(data, 0);
  data.writeBigUInt64LE(amount, 8);

  const tx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(
      user,
      userBullet,
      user,
      BULLET_MINT,
      TOKEN_2022_PROGRAM_ID
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
        { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    })
  );

  tx.feePayer = user;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  const sim = await connection.simulateTransaction(tx);
  console.log("err:", JSON.stringify(sim.value.err));
  console.log("units:", sim.value.unitsConsumed);
  for (const l of sim.value.logs ?? []) console.log(" ", l);
  if ((sim.value.logs ?? []).join("\n").includes("MathOverflow")) process.exit(1);
  if (sim.value.err == null) console.log("\nOK: mint sim succeeded");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
