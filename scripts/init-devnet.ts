/**
 * Devnet init: create mock Ansem mint + initialize Bullet protocol (Token-2022 BULLET).
 * Usage: npx tsx scripts/init-devnet.ts
 */
import {
  createMint,
  createAssociatedTokenAccount,
  getAssociatedTokenAddressSync,
  mintTo,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
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
import * as crypto from "crypto";

// Patched by redeploy-devnet.sh after keys sync
const PROGRAM_ID = new PublicKey("Gz7TX19wG7y4k8qCHt5eWQEpUMn6ALosV27PsWJDaAzJ");
const TRANSFER_HOOK_PROGRAM_ID = new PublicKey(
  "GJdqUFKpUHwLjVtcZMDnZDP5Mn8o9rsbiPLvUsg47BjY"
);
const RPC = "https://api.devnet.solana.com";
const MAX_SUPPLY = BigInt(5_000_000) * BigInt(1_000_000); // 5_000_000 * 1e6

function loadKeypair(p: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(p, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function sighash(name: string): Buffer {
  return crypto.createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

async function main() {
  const kpPath = path.join(os.homedir(), ".config", "solana", "id.json");
  const payer = loadKeypair(kpPath);
  const connection = new Connection(RPC, "confirmed");
  console.log("Payer:", payer.publicKey.toBase58());
  console.log("Balance:", (await connection.getBalance(payer.publicKey)) / 1e9, "SOL");

  console.log("Creating mock Ansem mint...");
  const ansemMint = await createMint(connection, payer, payer.publicKey, null, 6);
  console.log("Mock Ansem mint:", ansemMint.toBase58());

  const feeRecipient = payer.publicKey;
  const feeAta = await createAssociatedTokenAccount(
    connection,
    payer,
    ansemMint,
    feeRecipient
  );
  console.log("Fee ATA:", feeAta.toBase58());

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
      { pubkey: TRANSFER_HOOK_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data,
  });

  console.log("Sending initialize (Token-2022 BULLET + transfer hook)...");
  const sig = await sendAndConfirmTransaction(
    connection,
    new Transaction().add(ix),
    [payer],
    { commitment: "confirmed" }
  );
  console.log("Initialize sig:", sig);

  const userAnsem = getAssociatedTokenAddressSync(ansemMint, payer.publicKey);
  const userAta =
    userAnsem.toBase58() === feeAta.toBase58()
      ? feeAta
      : await createAssociatedTokenAccount(connection, payer, ansemMint, payer.publicKey);
  await mintTo(connection, payer, ansemMint, userAta, payer, BigInt(1_000_000_000_000));
  console.log("Minted 1_000_000 mock Ansem to", userAta.toBase58());

  const mintInfo = await connection.getAccountInfo(bulletMint);
  console.log("BULLET mint owner:", mintInfo?.owner.toBase58());
  console.log("BULLET mint space:", mintInfo?.data.length);

  const out = {
    cluster: "devnet",
    programId: PROGRAM_ID.toBase58(),
    transferHookProgramId: TRANSFER_HOOK_PROGRAM_ID.toBase58(),
    ansemMint: ansemMint.toBase58(),
    note: "Devnet mock Ansem — mainnet uses 9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump. BULLET is Token-2022 with DEX transfer hook.",
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
