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
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import deployed from "../deployed-devnet.json";

const RPC = "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey(deployed.programId);
const PROTOCOL = new PublicKey(deployed.protocol);
const BULLET_MINT = new PublicKey(deployed.bulletMint);
const ANSEM_MINT = new PublicKey(deployed.ansemMint);
const VAULT = new PublicKey(deployed.vault);
const POL_VAULT = new PublicKey(deployed.polVault);
const FEE_RECIPIENT = new PublicKey(deployed.feeRecipient);

function sighash(name: string) {
  return crypto.createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

async function main() {
  const payer = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(path.join(os.homedir(), ".config/solana/id.json"), "utf8")))
  );
  const connection = new Connection(RPC, "confirmed");
  const user = payer.publicKey;
  const userAnsem = getAssociatedTokenAddressSync(ANSEM_MINT, user);
  const userBullet = getAssociatedTokenAddressSync(BULLET_MINT, user, false, TOKEN_2022_PROGRAM_ID);
  const feeAta = getAssociatedTokenAddressSync(ANSEM_MINT, FEE_RECIPIENT);

  const amount = 100_000_000n; // 100 ANSEM
  const data = Buffer.alloc(16);
  sighash("mint_bullet").copy(data, 0);
  data.writeBigUInt64LE(amount, 8);

  const beforeAnsem = (await getAccount(connection, userAnsem)).amount;
  const tx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(user, userBullet, user, BULLET_MINT, TOKEN_2022_PROGRAM_ID),
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
  const sig = await sendAndConfirmTransaction(connection, tx, [payer], { commitment: "confirmed" });
  const afterAnsem = (await getAccount(connection, userAnsem)).amount;
  const bullet = await getAccount(connection, userBullet, "confirmed", TOKEN_2022_PROGRAM_ID);
  console.log(JSON.stringify({
    sig,
    ansemBefore: beforeAnsem.toString(),
    ansemAfter: afterAnsem.toString(),
    bulletBal: bullet.amount.toString(),
    bulletHuman: Number(bullet.amount) / 1e6,
  }, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
