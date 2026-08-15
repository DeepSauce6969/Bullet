/**
 * Simulate leverage against deployed devnet program (no wallet UI required).
 *
 * Usage:
 *   npx ts-node --compiler-options '{"module":"commonjs"}' scripts/simulate-leverage-devnet.ts
 *   # or from frontend/:
 *   node --import tsx ../scripts/simulate-leverage-devnet.ts
 *
 * Env:
 *   LEVERAGE_AMOUNT  — human ANSEM notional (default 10)
 *   LEVERAGE_DAYS    — loan days (default 30)
 *   LEVERAGE_USER    — optional base58 pubkey of a funded ANSEM holder
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
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOG = "/opt/cursor/logs/debug.log";
const RPC = "https://api.devnet.solana.com";

function dlog(
  hypothesisId: string,
  message: string,
  data: Record<string, unknown>
) {
  fs.appendFileSync(
    LOG,
    JSON.stringify({
      hypothesisId,
      location: "scripts/simulate-leverage-devnet.ts",
      message,
      data,
      timestamp: Date.now(),
      runId: "sim-script",
    }) + "\n"
  );
}

function sighash(name: string): Buffer {
  return crypto
    .createHash("sha256")
    .update(`global:${name}`)
    .digest()
    .subarray(0, 8);
}

function loanPda(
  programId: PublicKey,
  protocol: PublicKey,
  borrower: PublicKey,
  loanIndex: bigint
): PublicKey {
  const idx = Buffer.alloc(8);
  idx.writeBigUInt64LE(loanIndex);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("loan"), protocol.toBuffer(), borrower.toBuffer(), idx],
    programId
  )[0];
}

async function main() {
  const deployed = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "deployed-devnet.json"), "utf8")
  );
  const connection = new Connection(RPC, "confirmed");
  const programId = new PublicKey(deployed.programId);
  const ansemMint = new PublicKey(deployed.ansemMint);
  const protocol = new PublicKey(deployed.protocol);
  const bulletMint = new PublicKey(deployed.bulletMint);
  const vault = new PublicKey(deployed.vault);
  const polVault = new PublicKey(deployed.polVault);
  const collateralVault = new PublicKey(deployed.collateralVault);
  const feeRecipient = new PublicKey(deployed.feeRecipient);
  const feeAta = new PublicKey(deployed.feeAta);

  const amountHuman = Number(process.env.LEVERAGE_AMOUNT ?? "10");
  const days = Number(process.env.LEVERAGE_DAYS ?? "30");
  const amount = BigInt(Math.floor(amountHuman * 1e6));

  const protoInfo = await connection.getAccountInfo(protocol);
  if (!protoInfo) throw new Error("protocol missing on devnet");
  const d = Buffer.from(protoInfo.data);
  let o = 8 + 32 * 7 + 2;
  const totalMinted = d.readBigUInt64LE(o);
  o += 8;
  const maxSupply = d.readBigUInt64LE(o);
  o += 8;
  const totalBorrowed = d.readBigUInt64LE(o);
  o += 8;
  const totalSupply = d.readBigUInt64LE(o);
  o += 8;
  const loanCount = d.readBigUInt64LE(o);
  o += 8;
  const tradingEnabled = d[o] !== 0;

  const vaultAcc = await getAccount(connection, vault);

  // Resolve a funded user: env override, else recent program signer with ANSEM
  let user: PublicKey | null = process.env.LEVERAGE_USER
    ? new PublicKey(process.env.LEVERAGE_USER)
    : null;

  if (!user) {
    const sigs = await connection.getSignaturesForAddress(programId, {
      limit: 20,
    });
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
      if (signer.equals(protocol) || signer.equals(feeRecipient)) continue;
      try {
        const ata = getAssociatedTokenAddressSync(ansemMint, signer);
        const acc = await getAccount(connection, ata);
        if (acc.amount > 1_000_000n) {
          user = signer;
          break;
        }
      } catch {
        /* continue */
      }
    }
  }
  if (!user) throw new Error("No funded LEVERAGE_USER found");

  const userAnsem = getAssociatedTokenAddressSync(ansemMint, user);
  const userBullet = getAssociatedTokenAddressSync(bulletMint, user);
  const userBal = await getAccount(connection, userAnsem);
  const loan = loanPda(programId, protocol, user, loanCount);

  const data = Buffer.alloc(18);
  sighash("leverage").copy(data, 0);
  data.writeBigUInt64LE(amount, 8);
  data.writeUInt16LE(days, 16);

  const tx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(
      user,
      userBullet,
      user,
      bulletMint
    ),
    new TransactionInstruction({
      programId,
      keys: [
        { pubkey: user, isSigner: true, isWritable: true },
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

  const { blockhash } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = user;

  const snapshot = {
    tradingEnabled,
    loanCount: loanCount.toString(),
    totalSupply: totalSupply.toString(),
    totalMinted: totalMinted.toString(),
    totalBorrowed: totalBorrowed.toString(),
    maxSupply: maxSupply.toString(),
    vaultAmount: vaultAcc.amount.toString(),
    user: user.toBase58(),
    userAnsemBal: userBal.amount.toString(),
    amount: amount.toString(),
    days,
    loan: loan.toBase58(),
  };
  console.log("snapshot", snapshot);
  dlog("H0", "protocol snapshot before simulate", snapshot);

  const sim = await connection.simulateTransaction(tx);
  const result = {
    err: sim.value.err,
    units: sim.value.unitsConsumed,
    logs: sim.value.logs,
  };
  console.log(JSON.stringify(result, null, 2));
  dlog("H_floor", "simulateTransaction result", result as unknown as Record<string, unknown>);

  if (sim.value.err) {
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  dlog("H_sim", "script fatal", { error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
