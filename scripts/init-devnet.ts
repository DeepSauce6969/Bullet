/**
 * Devnet init: create mock Ansem mint + initialize Bullet protocol.
 * Usage: npx ts-node --esm scripts/init-devnet.ts
 *    or: npx tsx scripts/init-devnet.ts
 */
import * as anchor from "@coral-xyz/anchor";
import {
  createMint,
  createAssociatedTokenAccount,
  getAssociatedTokenAddressSync,
  mintTo,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const PROGRAM_ID = new PublicKey("4PTGwC7KTRZhjhKgXXrD9WTRyoCb8cpKWy6HAsaMXvBj");
const RPC = "https://api.devnet.solana.com";
const MAX_SUPPLY = BigInt(2_500) * BigInt(1_000_000); // 2500 * 1e6

function loadKeypair(p: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(p, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function sighash(name: string): Buffer {
  const preimage = `global:${name}`;
  const crypto = require("crypto") as typeof import("crypto");
  return crypto.createHash("sha256").update(preimage).digest().subarray(0, 8);
}

async function main() {
  const kpPath = path.join(os.homedir(), ".config", "solana", "id.json");
  const payer = loadKeypair(kpPath);
  const connection = new Connection(RPC, "confirmed");
  console.log("Payer:", payer.publicKey.toBase58());
  console.log("Balance:", (await connection.getBalance(payer.publicKey)) / 1e9, "SOL");

  // 1) Mock Ansem mint (mainnet Ansem can't exist on devnet)
  console.log("Creating mock Ansem mint...");
  const ansemMint = await createMint(connection, payer, payer.publicKey, null, 6);
  console.log("Mock Ansem mint:", ansemMint.toBase58());

  // Fee recipient = payer for simplicity
  const feeRecipient = payer.publicKey;
  const feeAta = await createAssociatedTokenAccount(
    connection,
    payer,
    ansemMint,
    feeRecipient
  );
  console.log("Fee ATA:", feeAta.toBase58());

  // PDAs
  const [protocol] = PublicKey.findProgramAddressSync(
    [Buffer.from("protocol")],
    PROGRAM_ID
  );
  const [bulletMint] = PublicKey.findProgramAddressSync(
    [Buffer.from("bullet_mint")],
    PROGRAM_ID
  );
  const [vault] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault")],
    PROGRAM_ID
  );
  const [polVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("pol_vault")],
    PROGRAM_ID
  );
  const [collateralVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("collateral_vault")],
    PROGRAM_ID
  );

  // initialize(max_supply: u64, fee_recipient: Pubkey)
  const data = Buffer.alloc(8 + 8 + 32);
  sighash("initialize").copy(data, 0);
  data.writeBigUInt64LE(MAX_SUPPLY, 8);
  feeRecipient.toBuffer().copy(data, 16);

  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: protocol, isSigner: false, isWritable: true },
      { pubkey: bulletMint, isSigner: false, isWritable: true },
      { pubkey: ansemMint, isSigner: false, isWritable: false },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: polVault, isSigner: false, isWritable: true },
      { pubkey: collateralVault, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data,
  });

  console.log("Sending initialize...");
  const sig = await sendAndConfirmTransaction(
    connection,
    new Transaction().add(ix),
    [payer],
    { commitment: "confirmed" }
  );
  console.log("Initialize sig:", sig);

  // Fund payer with mock Ansem for testing
  const userAnsem = getAssociatedTokenAddressSync(ansemMint, payer.publicKey);
  // fee ATA already created for payer; reuse as user ATA if same
  const userAta =
    userAnsem.toBase58() === feeAta.toBase58()
      ? feeAta
      : await createAssociatedTokenAccount(connection, payer, ansemMint, payer.publicKey);
  await mintTo(connection, payer, ansemMint, userAta, payer, BigInt(1_000_000_000_000));
  console.log("Minted 1_000_000 mock Ansem to", userAta.toBase58());

  const out = {
    cluster: "devnet",
    programId: PROGRAM_ID.toBase58(),
    ansemMint: ansemMint.toBase58(),
    note: "Devnet mock Ansem — mainnet uses 9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump",
    protocol: protocol.toBase58(),
    bulletMint: bulletMint.toBase58(),
    vault: vault.toBase58(),
    polVault: polVault.toBase58(),
    collateralVault: collateralVault.toBase58(),
    feeRecipient: feeRecipient.toBase58(),
    feeAta: feeAta.toBase58(),
    initializeTx: sig,
    explorer: `https://explorer.solana.com/address/${PROGRAM_ID.toBase58()}?cluster=devnet`,
  };
  const outPath = path.join(__dirname, "..", "deployed-devnet.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log("Wrote", outPath);
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
