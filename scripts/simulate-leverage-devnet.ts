/**
 * Simulate leverage against the deployed devnet program (no wallet UI).
 *
 *   npx tsx scripts/simulate-leverage-devnet.ts
 *   LEVERAGE_AMOUNT=10 LEVERAGE_DAYS=30 npx tsx scripts/simulate-leverage-devnet.ts
 *   LEVERAGE_USER=<base58> npx tsx scripts/simulate-leverage-devnet.ts
 *
 * After upgrading the on-chain program, a successful sim prints `"err": null`.
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
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RPC = "https://api.devnet.solana.com";

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
  o += 8; // totalMinted
  o += 8; // maxSupply
  const totalBorrowed = d.readBigUInt64LE(o);
  o += 8;
  const totalSupply = d.readBigUInt64LE(o);
  o += 8;
  const loanCount = d.readBigUInt64LE(o);
  o += 8;
  const tradingEnabled = d[o] !== 0;

  const vaultAcc = await getAccount(connection, vault);

  let user: PublicKey | null = process.env.LEVERAGE_USER
    ? new PublicKey(process.env.LEVERAGE_USER)
    : null;

  if (!user) {
    // Prefer fee recipient / deployer (init mints mock Ansem to them).
    try {
      const ata = getAssociatedTokenAddressSync(ansemMint, feeRecipient);
      const acc = await getAccount(connection, ata);
      if (acc.amount > 1_000_000n) user = feeRecipient;
    } catch {
      /* fall through */
    }
  }
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
  const userBullet = getAssociatedTokenAddressSync(
    bulletMint,
    user,
    false,
    TOKEN_2022_PROGRAM_ID
  );
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
      bulletMint,
      TOKEN_2022_PROGRAM_ID
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
        { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
        {
          pubkey: ASSOCIATED_TOKEN_PROGRAM_ID,
          isSigner: false,
          isWritable: false,
        },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    })
  );

  const { blockhash } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = user;

  console.log("snapshot", {
    tradingEnabled,
    loanCount: loanCount.toString(),
    totalSupply: totalSupply.toString(),
    totalBorrowed: totalBorrowed.toString(),
    vaultAmount: vaultAcc.amount.toString(),
    user: user.toBase58(),
    userAnsemBal: userBal.amount.toString(),
    amount: amount.toString(),
    days,
    loan: loan.toBase58(),
  });

  const sim = await connection.simulateTransaction(tx);
  const logs = sim.value.logs ?? [];
  const anchor = logs.find((l) => l.includes("AnchorError")) ?? null;
  console.log(
    JSON.stringify(
      {
        err: sim.value.err,
        units: sim.value.unitsConsumed,
        anchorError: anchor,
        logTail: logs.slice(-8),
      },
      null,
      2
    )
  );

  if (sim.value.err) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
