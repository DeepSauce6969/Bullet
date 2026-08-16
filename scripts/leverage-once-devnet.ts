/**
 * One-shot: open a real leverage position on the freshly deployed devnet program.
 * Usage: npx tsx scripts/leverage-once-devnet.ts
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

async function main() {
  const deployed = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "deployed-devnet.json"), "utf8")
  );
  const payer = Keypair.fromSecretKey(
    Uint8Array.from(
      JSON.parse(
        fs.readFileSync(
          path.join(os.homedir(), ".config", "solana", "id.json"),
          "utf8"
        )
      )
    )
  );
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const programId = new PublicKey(deployed.programId);
  const ansemMint = new PublicKey(deployed.ansemMint);
  const protocol = new PublicKey(deployed.protocol);
  const bulletMint = new PublicKey(deployed.bulletMint);
  const vault = new PublicKey(deployed.vault);
  const polVault = new PublicKey(deployed.polVault);
  const collateralVault = new PublicKey(deployed.collateralVault);
  const feeRecipient = new PublicKey(deployed.feeRecipient);
  const feeAta = new PublicKey(deployed.feeAta);

  const amount = 10_000_000n; // 10 ANSEM
  const days = 30;
  const disc = crypto
    .createHash("sha256")
    .update("global:leverage")
    .digest()
    .subarray(0, 8);
  const data = Buffer.alloc(18);
  disc.copy(data, 0);
  data.writeBigUInt64LE(amount, 8);
  data.writeUInt16LE(days, 16);

  const protoInfo = await connection.getAccountInfo(protocol);
  if (!protoInfo) throw new Error("protocol missing");
  const d = Buffer.from(protoInfo.data);
  let o = 8 + 32 * 7 + 2;
  o += 8; // totalMinted
  o += 8; // maxSupply
  o += 8; // totalBorrowed
  o += 8; // totalSupply
  const loanCount = d.readBigUInt64LE(o);
  const idx = Buffer.alloc(8);
  idx.writeBigUInt64LE(loanCount);
  const loan = PublicKey.findProgramAddressSync(
    [
      Buffer.from("loan"),
      protocol.toBuffer(),
      payer.publicKey.toBuffer(),
      idx,
    ],
    programId
  )[0];

  const userAnsem = getAssociatedTokenAddressSync(ansemMint, payer.publicKey);
  const userBullet = getAssociatedTokenAddressSync(bulletMint, payer.publicKey);

  const tx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(
      payer.publicKey,
      userBullet,
      payer.publicKey,
      bulletMint
    ),
    new TransactionInstruction({
      programId,
      keys: [
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: protocol, isSigner: false, isWritable: true },
        { pubkey: bulletMint, isSigner: false, isWritable: true },
        { pubkey: ansemMint, isSigner: false, isWritable: false },
        { pubkey: vault, isSigner: false, isWritable: true },
        { pubkey: polVault, isSigner: false, isWritable: true },
        { pubkey: collateralVault, isSigner: false, isWritable: true },
        { pubkey: feeRecipient, isSigner: false, isWritable: false },
        { pubkey: feeAta, isSigner: false, isWritable: true },
        { pubkey: userAnsem, isSigner: false, isWritable: true },
        { pubkey: userBullet, isSigner: false, isWritable: true },
        { pubkey: loan, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    })
  );

  const sig = await sendAndConfirmTransaction(connection, tx, [payer], {
    commitment: "confirmed",
  });
  console.log("LEVERAGE_OK", sig);
  console.log(
    "explorer",
    `https://explorer.solana.com/tx/${sig}?cluster=devnet`
  );
  const bal = await getAccount(connection, userAnsem);
  console.log("userAnsem remaining", bal.amount.toString());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
