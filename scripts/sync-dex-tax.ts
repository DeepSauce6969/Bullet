/**
 * Sync DEX transfer tax:
 * 1) migrate HookConfig layout if needed (+ lifetime_volume)
 * 2) update ExtraAccountMetaList so hook_config is writable
 * 3) refresh_tax_from_volume on hook config
 * 4) SetTransferFee on Token-2022 mint to match cached bps
 *
 * Usage: npx tsx scripts/sync-dex-tax.ts
 */
import {
  TOKEN_2022_PROGRAM_ID,
  createSetTransferFeeInstruction,
  getMint,
  getTransferFeeConfig,
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

function sighash(name: string): Buffer {
  return crypto
    .createHash("sha256")
    .update(`global:${name}`)
    .digest()
    .subarray(0, 8);
}

function dexTaxBpsFromVolume(lifetimeVolume: bigint): number {
  const STEP_50K = 50_000n * 1_000_000n;
  const STEP_250K = 250_000n * 1_000_000n;
  const STEP_1M = 1_000_000n * 1_000_000n;
  const STEP_5M = 5_000_000n * 1_000_000n;
  if (lifetimeVolume < STEP_50K) return 800;
  if (lifetimeVolume < STEP_250K) return 700;
  if (lifetimeVolume < STEP_1M) return 600;
  if (lifetimeVolume < STEP_5M) return 500;
  return 400;
}

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
  const connection = new Connection(
    "https://api.devnet.solana.com",
    "confirmed"
  );
  const hookProgram = new PublicKey(deployed.transferHookProgramId);
  const mint = new PublicKey(deployed.bulletMint);
  const hookConfig = new PublicKey(deployed.hookConfig);
  const extraMetas = new PublicKey(deployed.extraAccountMetaList);

  // Expected HookConfig size after migrate: 8 + InitSpace (with lifetime_volume u64)
  // Old size without lifetime_volume was 8 bytes smaller.
  const cfgInfo = await connection.getAccountInfo(hookConfig, "confirmed");
  if (!cfgInfo) throw new Error("hookConfig missing");
  console.log("hookConfig dataLen", cfgInfo.data.length);

  const HOOK_CONFIG_INIT_SPACE =
    32 + // authority
    32 + // mint
    2 + // transfer_tax_bps
    1 + // dex_pool_count
    1 + // exempt_count
    1 + // bump
    3 + // padding
    12 * 32 + // dex_pools
    8 * 32 + // exempt_accounts
    8; // lifetime_volume
  const newLen = 8 + HOOK_CONFIG_INIT_SPACE;

  if (cfgInfo.data.length < newLen) {
    console.log("migrate_config_layout…");
    const ix = new TransactionInstruction({
      programId: hookProgram,
      keys: [
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: hookConfig, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: sighash("migrate_config_layout"),
    });
    const sig = await sendAndConfirmTransaction(
      connection,
      new Transaction().add(ix),
      [payer],
      { commitment: "confirmed" }
    );
    console.log("migrate OK", sig);
  } else {
    console.log("hookConfig already migrated");
  }

  // Update ExtraAccountMetaList to writable hook_config
  console.log("update_extra_account_meta_list…");
  try {
    const ix = new TransactionInstruction({
      programId: hookProgram,
      keys: [
        { pubkey: payer.publicKey, isSigner: true, isWritable: false },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: hookConfig, isSigner: false, isWritable: false },
        { pubkey: extraMetas, isSigner: false, isWritable: true },
      ],
      data: sighash("update_extra_account_meta_list"),
    });
    const sig = await sendAndConfirmTransaction(
      connection,
      new Transaction().add(ix),
      [payer],
      { commitment: "confirmed" }
    );
    console.log("extra metas OK", sig);
  } catch (e: any) {
    console.log("extra metas update note:", e?.message ?? e);
  }

  // refresh_tax_from_volume
  console.log("refresh_tax_from_volume…");
  {
    const ix = new TransactionInstruction({
      programId: hookProgram,
      keys: [
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: hookConfig, isSigner: false, isWritable: true },
      ],
      data: sighash("refresh_tax_from_volume"),
    });
    const sig = await sendAndConfirmTransaction(
      connection,
      new Transaction().add(ix),
      [payer],
      { commitment: "confirmed" }
    );
    console.log("refresh OK", sig);
  }

  const cfgAfter = await connection.getAccountInfo(hookConfig, "confirmed");
  if (!cfgAfter) throw new Error("hookConfig missing after refresh");
  // layout: disc(8) + authority(32) + mint(32) + tax_bps(u16) ... lifetime_volume at end
  const taxBps = cfgAfter.data.readUInt16LE(8 + 32 + 32);
  const lifetimeVolume = cfgAfter.data.readBigUInt64LE(cfgAfter.data.length - 8);
  const expected = dexTaxBpsFromVolume(lifetimeVolume);
  console.log({ taxBps, lifetimeVolume: lifetimeVolume.toString(), expected });

  const mintAccount = await getMint(
    connection,
    mint,
    "confirmed",
    TOKEN_2022_PROGRAM_ID
  );
  const feeCfg = getTransferFeeConfig(mintAccount);
  const currentMintBps = feeCfg?.newerTransferFee.transferFeeBasisPoints ?? 0;
  console.log("mint transferFee bps", currentMintBps);

  if (currentMintBps !== taxBps) {
    console.log(`SetTransferFee ${currentMintBps} → ${taxBps}`);
    const maxFee =
      feeCfg?.newerTransferFee.maximumFee ?? (1n << 64n) - 1n;
    const ix = createSetTransferFeeInstruction(
      mint,
      payer.publicKey,
      [payer],
      taxBps,
      maxFee,
      TOKEN_2022_PROGRAM_ID
    );
    const sig = await sendAndConfirmTransaction(
      connection,
      new Transaction().add(ix),
      [payer],
      { commitment: "confirmed" }
    );
    console.log("SetTransferFee OK", sig);
  } else {
    console.log("mint fee already matches hook cache");
  }

  deployed.dexTransferTaxBps = taxBps;
  fs.writeFileSync(
    path.join(__dirname, "..", "deployed-devnet.json"),
    JSON.stringify(deployed, null, 2) + "\n"
  );
  console.log("done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
