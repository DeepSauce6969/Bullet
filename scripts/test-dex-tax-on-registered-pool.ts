/**
 * Prove size-vs-LP DEX tax (4–8%) without a Meteora listing.
 *
 * Meteora DLMM/DAMM reject Token-2022 mints whose TransferHook program +
 * authority are still set (need a Meteora token badge). This script:
 *   1. Creates a Token-2022 ATA that acts as a DEX pool vault
 *   2. Registers it via hook `register_dex_pool`
 *   3. Transfers small vs large BULLET into that vault (sells)
 *   4. Settles `settle_dex_tax_refund` when the size/LP target is below 8%
 *   5. Prints realized tax vs the on-chain curve
 *
 * Usage: npx tsx scripts/test-dex-tax-on-registered-pool.ts
 */
import {
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedWithFeeAndTransferHookInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  getMint,
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

const RPC = "https://api.devnet.solana.com";
const BPS_DENOM = 10_000n;
const DEX_TAX_MIN_BPS = 400;
const DEX_TAX_MAX_BPS = 800;
const DEX_TAX_R_MAX_BPS = 1_000n;

function sighash(name: string): Buffer {
  return crypto.createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

function calculateTransferFee(amount: bigint, bps: number): bigint {
  if (bps === 0 || amount === 0n) return 0n;
  return (amount * BigInt(bps) + 9_999n) / 10_000n;
}

/** Mirror of programs/bullet-transfer-hook/src/state.rs::dex_tax_bps_from_size */
function dexTaxBpsFromSize(amount: bigint, lpPre: bigint): number {
  if (lpPre === 0n) return DEX_TAX_MAX_BPS;
  const ratioBps = (amount * BPS_DENOM) / lpPre;
  const t = ratioBps < DEX_TAX_R_MAX_BPS ? ratioBps : DEX_TAX_R_MAX_BPS;
  return DEX_TAX_MIN_BPS + Number((BigInt(DEX_TAX_MAX_BPS - DEX_TAX_MIN_BPS) * t) / DEX_TAX_R_MAX_BPS);
}

function loadPayer(): Keypair {
  return Keypair.fromSecretKey(
    Uint8Array.from(
      JSON.parse(fs.readFileSync(path.join(os.homedir(), ".config/solana/id.json"), "utf8"))
    )
  );
}

async function main() {
  const deployed = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "deployed-devnet.json"), "utf8")
  );
  const payer = loadPayer();
  const connection = new Connection(RPC, "confirmed");
  const hookProgram = new PublicKey(deployed.transferHookProgramId);
  const mint = new PublicKey(deployed.bulletMint);
  const hookConfig = new PublicKey(deployed.hookConfig);
  const extraMetas = new PublicKey(deployed.extraAccountMetaList);
  const withdrawAuth = new PublicKey(deployed.withdrawAuth);
  const feeVault = new PublicKey(deployed.dexFeeVault);

  const mintInfo = await getMint(connection, mint, "confirmed", TOKEN_2022_PROGRAM_ID);
  const decimals = mintInfo.decimals;
  const userAta = getAssociatedTokenAddressSync(mint, payer.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const userBal = await getAccount(connection, userAta, "confirmed", TOKEN_2022_PROGRAM_ID);

  console.log("mint", mint.toBase58(), "decimals", decimals);
  console.log("wallet", payer.publicKey.toBase58());
  console.log("user BULLET", userBal.amount.toString());
  console.log("hook", hookProgram.toBase58());
  console.log("fee vault", feeVault.toBase58());

  function settleIx(dest: PublicKey): TransactionInstruction {
    return new TransactionInstruction({
      programId: hookProgram,
      keys: [
        { pubkey: mint, isSigner: false, isWritable: true },
        { pubkey: hookConfig, isSigner: false, isWritable: true },
        { pubkey: withdrawAuth, isSigner: false, isWritable: false },
        { pubkey: feeVault, isSigner: false, isWritable: true },
        { pubkey: dest, isSigner: false, isWritable: true },
        { pubkey: extraMetas, isSigner: false, isWritable: false },
        { pubkey: hookProgram, isSigner: false, isWritable: false },
        { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data: sighash("settle_dex_tax_refund"),
    });
  }

  async function settle(dest: PublicKey): Promise<string | null> {
    try {
      return await sendAndConfirmTransaction(
        connection,
        new Transaction().add(settleIx(dest)),
        [payer],
        { commitment: "confirmed" }
      );
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (msg.includes("NoPendingRefund") || msg.includes("0x177a")) {
        return null;
      }
      throw e;
    }
  }

  {
    const cfgInfo = await connection.getAccountInfo(hookConfig, "confirmed");
    if (cfgInfo && cfgInfo.data.length >= 768) {
      const pendingDest = new PublicKey(cfgInfo.data.subarray(728, 760));
      const pendingAmt = cfgInfo.data.readBigUInt64LE(760);
      if (pendingAmt > 0n && !pendingDest.equals(PublicKey.default)) {
        console.log(
          "settling leftover pending",
          pendingDest.toBase58(),
          pendingAmt.toString()
        );
        console.log("  leftover settle", await settle(pendingDest));
      }
    }
  }

  const poolKp = Keypair.generate();
  const dexVault = getAssociatedTokenAddressSync(
    mint,
    poolKp.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID
  );

  await sendAndConfirmTransaction(
    connection,
    new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: poolKp.publicKey,
        lamports: 20_000_000,
      }),
      createAssociatedTokenAccountInstruction(
        payer.publicKey,
        dexVault,
        poolKp.publicKey,
        mint,
        TOKEN_2022_PROGRAM_ID
      )
    ),
    [payer],
    { commitment: "confirmed" }
  );
  console.log("mock pool vault", dexVault.toBase58());
  console.log("pool owner", poolKp.publicKey.toBase58());

  const registerIx = new TransactionInstruction({
    programId: hookProgram,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: hookConfig, isSigner: false, isWritable: true },
      { pubkey: dexVault, isSigner: false, isWritable: false },
    ],
    data: sighash("register_dex_pool"),
  });
  const regSig = await sendAndConfirmTransaction(
    connection,
    new Transaction().add(registerIx),
    [payer],
    { commitment: "confirmed" }
  );
  console.log("register_dex_pool", regSig);

  async function sellIntoPool(rawAmount: bigint, label: string) {
    const vaultBefore = await getAccount(connection, dexVault, "confirmed", TOKEN_2022_PROGRAM_ID);
    const user0 = await getAccount(connection, userAta, "confirmed", TOKEN_2022_PROGRAM_ID);
    const feeVault0 = await getAccount(connection, feeVault, "confirmed", TOKEN_2022_PROGRAM_ID);

    const maxFee = calculateTransferFee(rawAmount, DEX_TAX_MAX_BPS);
    const lpPre = vaultBefore.amount;
    const expectedBps = dexTaxBpsFromSize(rawAmount, lpPre);
    const expectedTax = calculateTransferFee(rawAmount, expectedBps);
    const expectedRefund = maxFee - expectedTax;

    console.log(`\n=== ${label} ===`);
    console.log("  size", rawAmount.toString(), "lp_pre", lpPre.toString());
    console.log("  expected tax bps", expectedBps, "tax", expectedTax.toString(), "refund", expectedRefund.toString());

    const ix = await createTransferCheckedWithFeeAndTransferHookInstruction(
      connection,
      userAta,
      mint,
      dexVault,
      payer.publicKey,
      rawAmount,
      decimals,
      maxFee,
      [],
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );
    const sig = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [payer], {
      commitment: "confirmed",
    });
    console.log("  transfer", sig);

    const vaultMid = await getAccount(connection, dexVault, "confirmed", TOKEN_2022_PROGRAM_ID);
    const userMid = await getAccount(connection, userAta, "confirmed", TOKEN_2022_PROGRAM_ID);
    console.log("  sent from user", (user0.amount - userMid.amount).toString());
    console.log("  pool received before settle", (vaultMid.amount - vaultBefore.amount).toString());

    if (expectedRefund > 0n) {
      const settleSig = await settle(dexVault);
      console.log("  settle", settleSig);
    } else {
      console.log("  settle skipped (target already 8%, no refund)");
    }

    const vaultAfter = await getAccount(connection, dexVault, "confirmed", TOKEN_2022_PROGRAM_ID);
    const user1 = await getAccount(connection, userAta, "confirmed", TOKEN_2022_PROGRAM_ID);
    const feeVault1 = await getAccount(connection, feeVault, "confirmed", TOKEN_2022_PROGRAM_ID);
    const sent = user0.amount - user1.amount;
    const receivedNet = vaultAfter.amount - vaultBefore.amount;
    const taxKept = sent - receivedNet;
    const realizedBps = sent === 0n ? 0 : Number((taxKept * BPS_DENOM) / sent);
    console.log("  pool received after settle", receivedNet.toString());
    console.log("  tax kept", taxKept.toString(), `(${realizedBps} bps, expected ${expectedBps})`);
    console.log("  fee vault delta", (feeVault1.amount - feeVault0.amount).toString());
    if (taxKept !== expectedTax) {
      throw new Error(
        `tax mismatch: got ${taxKept} expected ${expectedTax} (${expectedBps} bps)`
      );
    }
  }

  // LP=0 → 8%. Then tiny vs seeded LP → ~4%. Then 10% of LP → 8%.
  await sellIntoPool(10_000_000n, "seed 10 BULLET (LP=0 → 8%)");
  await sellIntoPool(10_000n, "dust 0.01 BULLET vs ~9.2 LP (near 4%)");
  await sellIntoPool(1_000_000n, "1 BULLET ~10% of LP (8%)");

  console.log("\nOK — size-vs-LP DEX tax matches the 4–8% curve on a registered pool vault.");
  console.log("Meteora listing is a separate token-badge step (active TransferHook).");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
