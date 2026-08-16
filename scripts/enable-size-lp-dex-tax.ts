/**
 * Enable size-vs-LP DEX tax on the live Token-2022 mint:
 * 1) migrate HookConfig layout (pending refund fields)
 * 2) create fee_vault ATA owned by withdraw_auth PDA + register exempt
 * 3) set mint WithheldWithdraw authority → withdraw_auth PDA
 * 4) keep mint TransferFee at 800 bps (ceiling); settle_dex_tax_refund applies size/LP
 *
 * Usage: npx tsx scripts/enable-size-lp-dex-tax.ts
 */
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  AuthorityType,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createSetAuthorityInstruction,
  createSetTransferFeeInstruction,
  getAssociatedTokenAddressSync,
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

const RPC = "https://api.devnet.solana.com";
const DEX_TAX_MAX_BPS = 800;

function sighash(name: string): Buffer {
  return crypto
    .createHash("sha256")
    .update(`global:${name}`)
    .digest()
    .subarray(0, 8);
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
  const connection = new Connection(RPC, "confirmed");
  const hookProgram = new PublicKey(deployed.transferHookProgramId);
  const mint = new PublicKey(deployed.bulletMint);
  const hookConfig = new PublicKey(deployed.hookConfig);
  const extraMetas = new PublicKey(deployed.extraAccountMetaList);

  const [withdrawAuth] = PublicKey.findProgramAddressSync(
    [Buffer.from("withdraw_auth"), mint.toBuffer()],
    hookProgram
  );
  const feeVault = getAssociatedTokenAddressSync(
    mint,
    withdrawAuth,
    true,
    TOKEN_2022_PROGRAM_ID
  );

  console.log({
    withdrawAuth: withdrawAuth.toBase58(),
    feeVault: feeVault.toBase58(),
  });

  async function send(label: string, ixs: TransactionInstruction[]) {
    const sig = await sendAndConfirmTransaction(
      connection,
      new Transaction().add(...ixs),
      [payer],
      { commitment: "confirmed" }
    );
    console.log(label, sig);
    return sig;
  }

  // Migrate hook config if needed (add pending refund fields).
  const cfgInfo = await connection.getAccountInfo(hookConfig, "confirmed");
  if (!cfgInfo) throw new Error("hookConfig missing");
  // Expected: 8 + InitSpace with lifetime_volume + pending_dest + pending_amount
  // Conservative: if smaller than 728+32+8=768, migrate.
  const minLen = 8 + 720 + 32 + 8; // approx with pending fields
  if (cfgInfo.data.length < minLen) {
    await send("migrate_config_layout", [
      new TransactionInstruction({
        programId: hookProgram,
        keys: [
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          { pubkey: mint, isSigner: false, isWritable: false },
          { pubkey: hookConfig, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: sighash("migrate_config_layout"),
      }),
    ]);
  } else {
    console.log("hookConfig size ok", cfgInfo.data.length);
  }

  // Create fee vault ATA
  await send("create fee_vault ATA", [
    createAssociatedTokenAccountIdempotentInstruction(
      payer.publicKey,
      feeVault,
      withdrawAuth,
      mint,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    ),
  ]);

  // Exempt fee vault from DEX gate
  try {
    await send("register_exempt fee_vault", [
      new TransactionInstruction({
        programId: hookProgram,
        keys: [
          { pubkey: payer.publicKey, isSigner: true, isWritable: false },
          { pubkey: mint, isSigner: false, isWritable: false },
          { pubkey: hookConfig, isSigner: false, isWritable: true },
          { pubkey: feeVault, isSigner: false, isWritable: false },
        ],
        data: sighash("register_exempt_account"),
      }),
    ]);
  } catch (e: any) {
    console.log("exempt note:", e?.message ?? e);
  }

  // Ensure mint TransferFee = 800
  const mintAccount = await getMint(
    connection,
    mint,
    "confirmed",
    TOKEN_2022_PROGRAM_ID
  );
  const feeCfg = getTransferFeeConfig(mintAccount);
  const currentBps = feeCfg?.newerTransferFee.transferFeeBasisPoints ?? 0;
  const maxFee = feeCfg?.newerTransferFee.maximumFee ?? (1n << 64n) - 1n;
  if (currentBps !== DEX_TAX_MAX_BPS) {
    await send("SetTransferFee 800", [
      createSetTransferFeeInstruction(
        mint,
        payer.publicKey,
        [payer],
        DEX_TAX_MAX_BPS,
        maxFee,
        TOKEN_2022_PROGRAM_ID
      ),
    ]);
  } else {
    console.log("mint TransferFee already", currentBps);
  }

  // Set withdraw-withheld authority to PDA
  const withdrawAuthOnchain = feeCfg?.withdrawWithheldAuthority;
  if (
    !withdrawAuthOnchain ||
    !withdrawAuthOnchain.equals(withdrawAuth)
  ) {
    await send("set WithheldWithdraw → PDA", [
      createSetAuthorityInstruction(
        mint,
        payer.publicKey,
        AuthorityType.WithheldWithdraw,
        withdrawAuth,
        [],
        TOKEN_2022_PROGRAM_ID
      ),
    ]);
  } else {
    console.log("withdraw authority already PDA");
  }

  deployed.dexTaxModel = "size_vs_lp";
  deployed.dexTransferTaxBps = DEX_TAX_MAX_BPS;
  deployed.dexTaxMinBps = 400;
  deployed.dexTaxRMaxBps = 1000;
  deployed.withdrawAuth = withdrawAuth.toBase58();
  deployed.dexFeeVault = feeVault.toBase58();
  fs.writeFileSync(
    path.join(__dirname, "..", "deployed-devnet.json"),
    JSON.stringify(deployed, null, 2) + "\n"
  );
  console.log("done — size/LP model enabled (settle via settle_dex_tax_refund)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
