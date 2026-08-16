/**
 * Full end-to-end smoke test against live Token-2022 devnet deploy.
 * Uses the deployer keypair (~/.config/solana/id.json).
 *
 *   npx tsx scripts/e2e-devnet-smoke.ts
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
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RPC = "https://api.devnet.solana.com";
const deployed = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "deployed-devnet.json"), "utf8")
);

const PROGRAM_ID = new PublicKey(deployed.programId);
const PROTOCOL = new PublicKey(deployed.protocol);
const BULLET_MINT = new PublicKey(deployed.bulletMint);
const ANSEM_MINT = new PublicKey(deployed.ansemMint);
const VAULT = new PublicKey(deployed.vault);
const POL_VAULT = new PublicKey(deployed.polVault);
const COLLATERAL_VAULT = new PublicKey(deployed.collateralVault);
const FEE_RECIPIENT = new PublicKey(deployed.feeRecipient);
const FEE_ATA = new PublicKey(deployed.feeAta);

type Result = { name: string; ok: boolean; detail: string };

function sighash(name: string): Buffer {
  return crypto.createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

function loadPayer(): Keypair {
  return Keypair.fromSecretKey(
    Uint8Array.from(
      JSON.parse(
        fs.readFileSync(path.join(os.homedir(), ".config/solana/id.json"), "utf8")
      )
    )
  );
}

function loanPda(borrower: PublicKey, loanIndex: bigint): PublicKey {
  const idx = Buffer.alloc(8);
  idx.writeBigUInt64LE(loanIndex);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("loan"), PROTOCOL.toBuffer(), borrower.toBuffer(), idx],
    PROGRAM_ID
  )[0];
}

function bulletAta(owner: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(BULLET_MINT, owner, false, TOKEN_2022_PROGRAM_ID);
}

async function readProtocol(connection: Connection) {
  const info = await connection.getAccountInfo(PROTOCOL);
  if (!info) throw new Error("protocol missing");
  const d = Buffer.from(info.data);
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
  return { totalMinted, maxSupply, totalBorrowed, totalSupply, loanCount, tradingEnabled };
}

async function bal(
  connection: Connection,
  ata: PublicKey,
  program: PublicKey = TOKEN_PROGRAM_ID
): Promise<bigint> {
  try {
    return (await getAccount(connection, ata, "confirmed", program)).amount;
  } catch {
    return 0n;
  }
}

async function send(
  connection: Connection,
  payer: Keypair,
  ixs: TransactionInstruction[],
  label: string
): Promise<string> {
  const tx = new Transaction().add(...ixs);
  const sig = await sendAndConfirmTransaction(connection, tx, [payer], {
    commitment: "confirmed",
  });
  console.log(`  ✓ ${label}: ${sig}`);
  return sig;
}

async function main() {
  const results: Result[] = [];
  const connection = new Connection(RPC, "confirmed");
  const payer = loadPayer();
  const user = payer.publicKey;
  const userAnsem = getAssociatedTokenAddressSync(ANSEM_MINT, user);
  const userBullet = bulletAta(user);

  console.log("=== E2E smoke — Token-2022 Bullet ===");
  console.log("program:", PROGRAM_ID.toBase58());
  console.log("user:", user.toBase58());
  console.log("sol:", (await connection.getBalance(user)) / 1e9);

  // 0) Sanity: mint is Token-2022
  {
    const mintInfo = await connection.getAccountInfo(BULLET_MINT);
    const owner = mintInfo?.owner.toBase58() ?? "missing";
    const ok = owner === TOKEN_2022_PROGRAM_ID.toBase58();
    results.push({
      name: "BULLET mint is Token-2022",
      ok,
      detail: `owner=${owner} space=${mintInfo?.data.length}`,
    });
    console.log(ok ? "✓" : "✗", "mint owner", owner);
  }

  // 0b) Hook config exists
  {
    const hook = new PublicKey(deployed.hookConfig);
    const info = await connection.getAccountInfo(hook);
    const ok = !!info;
    results.push({
      name: "transfer-hook config exists",
      ok,
      detail: ok ? hook.toBase58() : "missing",
    });
  }

  let proto = await readProtocol(connection);
  console.log("protocol snapshot", {
    tradingEnabled: proto.tradingEnabled,
    supply: proto.totalSupply.toString(),
    borrowed: proto.totalBorrowed.toString(),
    loanCount: proto.loanCount.toString(),
  });
  results.push({
    name: "trading enabled",
    ok: proto.tradingEnabled,
    detail: String(proto.tradingEnabled),
  });

  const ensureBulletAta = createAssociatedTokenAccountIdempotentInstruction(
    user,
    userBullet,
    user,
    BULLET_MINT,
    TOKEN_2022_PROGRAM_ID
  );

  // 1) MINT 50 ANSEM
  try {
    const before = await bal(connection, userBullet, TOKEN_2022_PROGRAM_ID);
    const amount = 50_000_000n;
    const data = Buffer.alloc(16);
    sighash("mint_bullet").copy(data, 0);
    data.writeBigUInt64LE(amount, 8);
    await send(
      connection,
      payer,
      [
        ensureBulletAta,
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
            { pubkey: FEE_ATA, isSigner: false, isWritable: true },
            { pubkey: userAnsem, isSigner: false, isWritable: true },
            { pubkey: userBullet, isSigner: false, isWritable: true },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          ],
          data,
        }),
      ],
      "mint 50 ANSEM"
    );
    const after = await bal(connection, userBullet, TOKEN_2022_PROGRAM_ID);
    const ok = after > before;
    results.push({
      name: "mint_bullet",
      ok,
      detail: `bullet ${before} → ${after} (+${after - before})`,
    });
  } catch (e) {
    results.push({ name: "mint_bullet", ok: false, detail: String(e) });
    console.error("mint failed", e);
  }

  // 2) BURN 10 BULLET
  try {
    const burnAmt = 10_000_000n;
    const beforeA = await bal(connection, userAnsem);
    const beforeB = await bal(connection, userBullet, TOKEN_2022_PROGRAM_ID);
    if (beforeB < burnAmt) throw new Error(`need ${burnAmt} BULLET, have ${beforeB}`);
    const data = Buffer.alloc(16);
    sighash("burn_bullet").copy(data, 0);
    data.writeBigUInt64LE(burnAmt, 8);
    await send(
      connection,
      payer,
      [
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
            { pubkey: FEE_ATA, isSigner: false, isWritable: true },
            { pubkey: userBullet, isSigner: false, isWritable: true },
            { pubkey: userAnsem, isSigner: false, isWritable: true },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
          ],
          data,
        }),
      ],
      "burn 10 BULLET"
    );
    const afterA = await bal(connection, userAnsem);
    const afterB = await bal(connection, userBullet, TOKEN_2022_PROGRAM_ID);
    results.push({
      name: "burn_bullet",
      ok: afterB < beforeB && afterA > beforeA,
      detail: `bullet ${beforeB}→${afterB}; ansem ${beforeA}→${afterA}`,
    });
  } catch (e) {
    results.push({ name: "burn_bullet", ok: false, detail: String(e) });
    console.error("burn failed", e);
  }

  // 3) BORROW ~5 ANSEM against BULLET (30 days)
  let borrowLoan: PublicKey | null = null;
  try {
    proto = await readProtocol(connection);
    borrowLoan = loanPda(user, proto.loanCount);
    const borrowAmt = 5_000_000n;
    const data = Buffer.alloc(18);
    sighash("borrow").copy(data, 0);
    data.writeBigUInt64LE(borrowAmt, 8);
    data.writeUInt16LE(30, 16);
    const beforeA = await bal(connection, userAnsem);
    await send(
      connection,
      payer,
      [
        new TransactionInstruction({
          programId: PROGRAM_ID,
          keys: [
            { pubkey: user, isSigner: true, isWritable: true },
            { pubkey: PROTOCOL, isSigner: false, isWritable: true },
            { pubkey: BULLET_MINT, isSigner: false, isWritable: true },
            { pubkey: ANSEM_MINT, isSigner: false, isWritable: false },
            { pubkey: VAULT, isSigner: false, isWritable: true },
            { pubkey: POL_VAULT, isSigner: false, isWritable: true },
            { pubkey: COLLATERAL_VAULT, isSigner: false, isWritable: true },
            { pubkey: FEE_RECIPIENT, isSigner: false, isWritable: false },
            { pubkey: FEE_ATA, isSigner: false, isWritable: true },
            { pubkey: userBullet, isSigner: false, isWritable: true },
            { pubkey: userAnsem, isSigner: false, isWritable: true },
            { pubkey: borrowLoan, isSigner: false, isWritable: true },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          ],
          data,
        }),
      ],
      "borrow 5 ANSEM / 30d"
    );
    const afterA = await bal(connection, userAnsem);
    const loanInfo = await connection.getAccountInfo(borrowLoan);
    results.push({
      name: "borrow",
      ok: !!loanInfo && afterA > beforeA,
      detail: `loan=${borrowLoan.toBase58()} ansem ${beforeA}→${afterA}`,
    });
  } catch (e) {
    results.push({ name: "borrow", ok: false, detail: String(e) });
    console.error("borrow failed", e);
  }

  // 4) REPAY borrow (close position)
  try {
    if (!borrowLoan) throw new Error("no borrow loan");
    await send(
      connection,
      payer,
      [
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
            { pubkey: borrowLoan, isSigner: false, isWritable: true },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
          ],
          data: sighash("repay"),
        }),
      ],
      "repay borrow (close)"
    );
    const loanInfo = await connection.getAccountInfo(borrowLoan);
    results.push({
      name: "repay (close borrow)",
      ok: !loanInfo, // closed account
      detail: loanInfo ? "loan still exists" : "loan account closed",
    });
  } catch (e) {
    results.push({ name: "repay (close borrow)", ok: false, detail: String(e) });
    console.error("repay failed", e);
  }

  // 5) LEVERAGE 20 ANSEM / 30d
  let levLoan: PublicKey | null = null;
  try {
    proto = await readProtocol(connection);
    levLoan = loanPda(user, proto.loanCount);
    const amount = 20_000_000n;
    const data = Buffer.alloc(18);
    sighash("leverage").copy(data, 0);
    data.writeBigUInt64LE(amount, 8);
    data.writeUInt16LE(30, 16);
    const collBefore = await bal(connection, COLLATERAL_VAULT, TOKEN_2022_PROGRAM_ID);
    await send(
      connection,
      payer,
      [
        ensureBulletAta,
        new TransactionInstruction({
          programId: PROGRAM_ID,
          keys: [
            { pubkey: user, isSigner: true, isWritable: true },
            { pubkey: PROTOCOL, isSigner: false, isWritable: true },
            { pubkey: BULLET_MINT, isSigner: false, isWritable: true },
            { pubkey: ANSEM_MINT, isSigner: false, isWritable: false },
            { pubkey: VAULT, isSigner: false, isWritable: true },
            { pubkey: POL_VAULT, isSigner: false, isWritable: true },
            { pubkey: COLLATERAL_VAULT, isSigner: false, isWritable: true },
            { pubkey: FEE_RECIPIENT, isSigner: false, isWritable: false },
            { pubkey: FEE_ATA, isSigner: false, isWritable: true },
            { pubkey: userAnsem, isSigner: false, isWritable: true },
            { pubkey: userBullet, isSigner: false, isWritable: true },
            { pubkey: levLoan, isSigner: false, isWritable: true },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          ],
          data,
        }),
      ],
      "leverage 20 ANSEM / 30d"
    );
    const collAfter = await bal(connection, COLLATERAL_VAULT, TOKEN_2022_PROGRAM_ID);
    const loanInfo = await connection.getAccountInfo(levLoan);
    results.push({
      name: "leverage",
      ok: !!loanInfo && collAfter > collBefore,
      detail: `loan=${levLoan.toBase58()} collateral ${collBefore}→${collAfter}`,
    });
  } catch (e) {
    results.push({ name: "leverage", ok: false, detail: String(e) });
    console.error("leverage failed", e);
  }

  // 6) CLOSE LEVERAGE (repay)
  try {
    if (!levLoan) throw new Error("no leverage loan");
    await send(
      connection,
      payer,
      [
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
            { pubkey: levLoan, isSigner: false, isWritable: true },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
          ],
          data: sighash("repay"),
        }),
      ],
      "close leverage (repay)"
    );
    const loanInfo = await connection.getAccountInfo(levLoan);
    results.push({
      name: "close leverage",
      ok: !loanInfo,
      detail: loanInfo ? "loan still exists" : "loan account closed",
    });
  } catch (e) {
    results.push({ name: "close leverage", ok: false, detail: String(e) });
    console.error("close leverage failed", e);
  }

  // 7) GENESIS deposit + withdraw (Public tier 2)
  try {
    const tier = 2;
    const genesisVault = PublicKey.findProgramAddressSync(
      [Buffer.from("genesis_vault"), Buffer.from([tier])],
      PROGRAM_ID
    )[0];
    const tokenVault = PublicKey.findProgramAddressSync(
      [Buffer.from("genesis_ansem"), Buffer.from([tier])],
      PROGRAM_ID
    )[0];
    const userDeposit = PublicKey.findProgramAddressSync(
      [Buffer.from("user_deposit"), genesisVault.toBuffer(), user.toBuffer()],
      PROGRAM_ID
    )[0];
    const depAmt = 100_000_000n; // 100 ANSEM
    const data = Buffer.alloc(16);
    sighash("deposit_genesis").copy(data, 0);
    data.writeBigUInt64LE(depAmt, 8);
    await send(
      connection,
      payer,
      [
        new TransactionInstruction({
          programId: PROGRAM_ID,
          keys: [
            { pubkey: user, isSigner: true, isWritable: true },
            { pubkey: genesisVault, isSigner: false, isWritable: true },
            { pubkey: tokenVault, isSigner: false, isWritable: true },
            { pubkey: userAnsem, isSigner: false, isWritable: true },
            { pubkey: userDeposit, isSigner: false, isWritable: true },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          ],
          data,
        }),
      ],
      "genesis deposit 100 ANSEM (Public)"
    );
    const depInfo = await connection.getAccountInfo(userDeposit);
    results.push({
      name: "genesis deposit",
      ok: !!depInfo,
      detail: `userDeposit=${userDeposit.toBase58()}`,
    });

    await send(
      connection,
      payer,
      [
        new TransactionInstruction({
          programId: PROGRAM_ID,
          keys: [
            { pubkey: user, isSigner: true, isWritable: true },
            { pubkey: genesisVault, isSigner: false, isWritable: true },
            { pubkey: tokenVault, isSigner: false, isWritable: true },
            { pubkey: userAnsem, isSigner: false, isWritable: true },
            { pubkey: userDeposit, isSigner: false, isWritable: true },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          ],
          data: sighash("withdraw_genesis"),
        }),
      ],
      "genesis withdraw"
    );
    const afterDep = await connection.getAccountInfo(userDeposit);
    results.push({
      name: "genesis withdraw",
      ok: !afterDep,
      detail: afterDep ? "deposit still open" : "deposit closed",
    });
  } catch (e) {
    results.push({ name: "genesis deposit/withdraw", ok: false, detail: String(e) });
    console.error("genesis failed", e);
  }

  // 8) Large mint that would have overflowed u64 on old deploy
  try {
    const amount = 2_000_000_000n; // 2000 ANSEM
    const data = Buffer.alloc(16);
    sighash("mint_bullet").copy(data, 0);
    data.writeBigUInt64LE(amount, 8);
    await send(
      connection,
      payer,
      [
        ensureBulletAta,
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
            { pubkey: FEE_ATA, isSigner: false, isWritable: true },
            { pubkey: userAnsem, isSigner: false, isWritable: true },
            { pubkey: userBullet, isSigner: false, isWritable: true },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          ],
          data,
        }),
      ],
      "mint 2000 ANSEM (u128 path)"
    );
    results.push({ name: "mint large (no MathOverflow)", ok: true, detail: "2000 ANSEM ok" });
  } catch (e) {
    const msg = String(e);
    results.push({
      name: "mint large (no MathOverflow)",
      ok: !/MathOverflow|6011|0x177b/i.test(msg),
      detail: msg.slice(0, 300),
    });
  }

  proto = await readProtocol(connection);
  const finalBullet = await bal(connection, userBullet, TOKEN_2022_PROGRAM_ID);
  const finalAnsem = await bal(connection, userAnsem);

  console.log("\n=== RESULTS ===");
  let pass = 0;
  let fail = 0;
  for (const r of results) {
    console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name} — ${r.detail}`);
    if (r.ok) pass++;
    else fail++;
  }
  console.log(`\n${pass}/${results.length} passed, ${fail} failed`);
  console.log("final balances", {
    bullet: finalBullet.toString(),
    ansem: finalAnsem.toString(),
    supply: proto.totalSupply.toString(),
    borrowed: proto.totalBorrowed.toString(),
    loans: proto.loanCount.toString(),
  });

  const outPath = "/opt/cursor/artifacts/e2e_devnet_smoke.json";
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        programId: PROGRAM_ID.toBase58(),
        results,
        pass,
        fail,
        final: {
          bullet: finalBullet.toString(),
          ansem: finalAnsem.toString(),
          supply: proto.totalSupply.toString(),
          borrowed: proto.totalBorrowed.toString(),
        },
      },
      null,
      2
    )
  );
  console.log("wrote", outPath);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
