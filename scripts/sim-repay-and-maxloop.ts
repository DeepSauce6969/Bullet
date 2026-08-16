/**
 * 1) Simulate repay against an active loan (classic Token accounts).
 * 2) Print MAX LOOP vs simple-borrow max for a sample wallet.
 */
import {
  TOKEN_PROGRAM_ID,
  getAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import * as crypto from "crypto";
import deployed from "../deployed-devnet.json";

const RPC = "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey(deployed.programId);
const PROTOCOL = new PublicKey(deployed.protocol);
const BULLET_MINT = new PublicKey(deployed.bulletMint);
const ANSEM_MINT = new PublicKey(deployed.ansemMint);
const VAULT = new PublicKey(deployed.vault);
const COLLATERAL_VAULT = new PublicKey(deployed.collateralVault);

function sighash(name: string): Buffer {
  return crypto.createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

function estimateInterest(borrowAmt: number, days: number): number {
  // Mirror frontend estimateInterest roughly: APY + base fee — use on-chain formula via constants
  const INTEREST_APY_BPS = 1000; // 10%
  const BASE_BORROW_FEE_BPS = 50; // 0.5%
  const BPS = 10000;
  const apy = (borrowAmt * INTEREST_APY_BPS * days) / (BPS * 365);
  const base = (borrowAmt * BASE_BORROW_FEE_BPS) / BPS;
  return apy + base;
}

function computeMaxLeverageFromAnsem(ansemBal: number, days: number): number {
  const LTV = 0.99;
  const LEVERAGE_BAKE = 0.02;
  const LEVERAGE_OVERCOLLAT = 0.02;
  if (!(ansemBal > 0)) return 0;
  let lo = 0;
  let hi = ansemBal / 0.02;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const bakeFee = mid * LEVERAGE_BAKE;
    const userAnsem = mid - bakeFee;
    const loanAmount = userAnsem * LTV;
    const overCollat = userAnsem * LEVERAGE_OVERCOLLAT;
    const interest = estimateInterest(loanAmount, days);
    const totalRequired = bakeFee + interest + overCollat;
    if (totalRequired <= ansemBal) lo = mid;
    else hi = mid;
  }
  return lo;
}

async function main() {
  const connection = new Connection(RPC, "confirmed");

  // Find Loan accounts owned by program
  const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
    filters: [{ dataSize: 8 + 32 + 32 + 8 + 8 + 8 + 1 + 7 }], // rough — better use memcmp
  });
  console.log("program accounts:", accounts.length);

  // Loan layout: disc(8) + protocol(32) + borrower(32) + collateral(8) + borrowed(8) + end_ts(8) + active(1) + ...
  // Also try known loan from leverage sim / scan with loan discriminator
  const loanDisc = sighash("account:Loan"); // Anchor account discriminator
  // Actually Anchor account disc is sha256("account:Loan")[0..8]
  const LOAN_DISC = crypto.createHash("sha256").update("account:Loan").digest().subarray(0, 8);

  const loans = await connection.getProgramAccounts(PROGRAM_ID, {
    filters: [{ memcmp: { offset: 0, bytes: "" } }], // placeholder
  }).catch(() => [] as never[]);

  // Manual filter
  const all = await connection.getProgramAccounts(PROGRAM_ID);
  const activeLoans: { pubkey: PublicKey; borrower: PublicKey; borrowed: bigint; collateral: bigint }[] = [];
  for (const a of all) {
    const d = a.account.data;
    if (d.length < 97) continue;
    if (!d.subarray(0, 8).equals(LOAN_DISC)) continue;
    const active = d[8 + 32 + 32 + 8 + 8 + 8] !== 0;
    if (!active) continue;
    const borrower = new PublicKey(d.subarray(8 + 32, 8 + 64));
    const collateral = d.readBigUInt64LE(8 + 64);
    const borrowed = d.readBigUInt64LE(8 + 72);
    activeLoans.push({ pubkey: a.pubkey, borrower, borrowed, collateral });
  }
  console.log(
    "active loans:",
    activeLoans.map((l) => ({
      loan: l.pubkey.toBase58(),
      borrower: l.borrower.toBase58(),
      borrowed: l.borrowed.toString(),
      collateral: l.collateral.toString(),
    }))
  );

  if (activeLoans.length === 0) {
    console.log("No active loans to repay-sim");
  } else {
    const loan = activeLoans[0];
    const user = loan.borrower;
    const userAnsem = getAssociatedTokenAddressSync(ANSEM_MINT, user);
    const userBullet = getAssociatedTokenAddressSync(BULLET_MINT, user);
    let ansemOk = false;
    try {
      const acc = await getAccount(connection, userAnsem);
      ansemOk = acc.amount >= loan.borrowed;
      console.log("borrower ansem:", acc.amount.toString(), "need:", loan.borrowed.toString());
    } catch (e) {
      console.log("borrower ansem ATA missing");
    }

    const tx = new Transaction().add(
      new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: user, isSigner: true, isWritable: true },
          { pubkey: PROTOCOL, isSigner: false, isWritable: true },
          { pubkey: BULLET_MINT, isSigner: false, isWritable: true },
          { pubkey: ANSEM_MINT, isSigner: false, isWritable: false },
          { pubkey: VAULT, isSigner: false, isWritable: true },
          { pubkey: COLLATERAL_VAULT, isSigner: false, isWritable: true },
          { pubkey: userAnsem, isSigner: false, isWritable: true },
          { pubkey: userBullet, isSigner: false, isWritable: true },
          { pubkey: loan.pubkey, isSigner: false, isWritable: true },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        data: sighash("repay"),
      })
    );
    tx.feePayer = user;
    const { blockhash } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    const sim = await connection.simulateTransaction(tx);
    console.log("repay sim err:", JSON.stringify(sim.value.err));
    console.log("repay units:", sim.value.unitsConsumed);
    const joined = (sim.value.logs ?? []).join("\n");
    const anchor = (sim.value.logs ?? []).find((l) => l.includes("AnchorError") || l.includes("Error"));
    console.log("anchor/error line:", anchor ?? null);
    if (joined.includes("MathOverflow") || joined.includes("6011")) {
      console.log("FAIL: repay MathOverflow");
      process.exit(1);
    }
    // Also test OLD (mint non-writable) to show it would fail account constraint differently
    const badTx = new Transaction().add(
      new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: user, isSigner: true, isWritable: true },
          { pubkey: PROTOCOL, isSigner: false, isWritable: true },
          { pubkey: BULLET_MINT, isSigner: false, isWritable: false },
          { pubkey: ANSEM_MINT, isSigner: false, isWritable: false },
          { pubkey: VAULT, isSigner: false, isWritable: true },
          { pubkey: COLLATERAL_VAULT, isSigner: false, isWritable: true },
          { pubkey: userAnsem, isSigner: false, isWritable: true },
          { pubkey: userBullet, isSigner: false, isWritable: true },
          { pubkey: loan.pubkey, isSigner: false, isWritable: true },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        data: sighash("repay"),
      })
    );
    badTx.feePayer = user;
    badTx.recentBlockhash = blockhash;
    const badSim = await connection.simulateTransaction(badTx);
    console.log("repay with mint NON-writable err:", JSON.stringify(badSim.value.err));
  }

  // MAX LOOP vs borrow max
  const ansemBal = 1000; // human
  const bulletBal = 10;
  const floor = 1.066; // ~backing/supply
  const days = 30;
  const LTV = 0.99;
  const maxLoop = computeMaxLeverageFromAnsem(ansemBal, days);
  const maxBorrow = bulletBal * floor * LTV;
  console.log("\n=== MAX LOOP vs simple borrow (sample) ===");
  console.log({ ansemBal, bulletBal, floor, days, maxLoop, maxBorrow });
  console.log(
    "MAX LOOP >> borrow max?",
    maxLoop > maxBorrow * 5 ? "YES" : `ratio=${(maxLoop / Math.max(maxBorrow, 1e-9)).toFixed(2)}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
