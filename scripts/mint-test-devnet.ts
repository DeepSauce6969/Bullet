/**
 * Smoke-test mint on devnet: deposit 100 mock Ansem → mint BULLET.
 */
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotent,
  getAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";

const deployed = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "deployed-devnet.json"), "utf8")
);

function loadKeypair(p: string): Keypair {
  return Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8")))
  );
}

function sighash(name: string): Buffer {
  return crypto.createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

async function main() {
  const payer = loadKeypair(path.join(os.homedir(), ".config", "solana", "id.json"));
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const programId = new PublicKey(deployed.programId);
  const ansemMint = new PublicKey(deployed.ansemMint);
  const protocol = new PublicKey(deployed.protocol);
  const bulletMint = new PublicKey(deployed.bulletMint);
  const vault = new PublicKey(deployed.vault);
  const polVault = new PublicKey(deployed.polVault);
  const feeRecipient = new PublicKey(deployed.feeRecipient);
  const feeAta = new PublicKey(deployed.feeAta);

  const userAnsem = getAssociatedTokenAddressSync(ansemMint, payer.publicKey);
  const userBullet = await createAssociatedTokenAccountIdempotent(
    connection,
    payer,
    bulletMint,
    payer.publicKey
  );

  const amount = BigInt(100_000_000); // 100 Ansem (6 decimals)
  const data = Buffer.alloc(16);
  sighash("mint_bullet").copy(data, 0);
  data.writeBigUInt64LE(amount, 8);

  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: protocol, isSigner: false, isWritable: true },
      { pubkey: bulletMint, isSigner: false, isWritable: true },
      { pubkey: ansemMint, isSigner: false, isWritable: false },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: polVault, isSigner: false, isWritable: true },
      { pubkey: feeRecipient, isSigner: false, isWritable: false },
      { pubkey: feeAta, isSigner: false, isWritable: true },
      { pubkey: userAnsem, isSigner: false, isWritable: true },
      { pubkey: userBullet, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  console.log("Minting with 100 Ansem...");
  const sig = await sendAndConfirmTransaction(
    connection,
    new Transaction().add(ix),
    [payer]
  );
  console.log("mint sig:", sig);

  const bulletBal = await getAccount(connection, userBullet);
  const vaultBal = await getAccount(connection, vault);
  console.log("BULLET balance:", Number(bulletBal.amount) / 1e6);
  console.log("Vault Ansem:", Number(vaultBal.amount) / 1e6);
  console.log(
    "Explorer:",
    `https://explorer.solana.com/tx/${sig}?cluster=devnet`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
