/**
 * Post-init transfer-hook setup on devnet:
 * - initialize_config (800 bps DEX tax)
 * - initialize_extra_account_meta_list
 * - register_exempt_account for collateral + genesis bullet vaults
 *
 * Usage: npx tsx scripts/setup-transfer-hook-devnet.ts
 */
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
import * as path from "path";
import * as os from "os";

const RPC = "https://api.devnet.solana.com";
const DEX_TAX_BPS = 800;

function loadKeypair(p: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
}

function sighash(name: string): Buffer {
  return crypto.createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

async function main() {
  const deployedPath = path.join(__dirname, "..", "deployed-devnet.json");
  const deployed = JSON.parse(fs.readFileSync(deployedPath, "utf8"));
  const payer = loadKeypair(path.join(os.homedir(), ".config", "solana", "id.json"));
  const connection = new Connection(RPC, "confirmed");

  const hookProgramId = new PublicKey(
    deployed.transferHookProgramId ??
      (() => {
        throw new Error("deployed-devnet.json missing transferHookProgramId");
      })()
  );
  const mint = new PublicKey(deployed.bulletMint);
  const collateralVault = new PublicKey(deployed.collateralVault);

  const [hookConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("hook_config"), mint.toBuffer()],
    hookProgramId
  );
  const [extraAccountMetaList] = PublicKey.findProgramAddressSync(
    [Buffer.from("extra-account-metas"), mint.toBuffer()],
    hookProgramId
  );

  console.log("Hook program:", hookProgramId.toBase58());
  console.log("Mint:", mint.toBase58());
  console.log("Hook config:", hookConfig.toBase58());
  console.log("Extra metas:", extraAccountMetaList.toBase58());

  async function send(label: string, ix: TransactionInstruction) {
    const sig = await sendAndConfirmTransaction(
      connection,
      new Transaction().add(ix),
      [payer],
      { commitment: "confirmed" }
    );
    console.log(`${label}:`, sig);
    return sig;
  }

  // initialize_config(transfer_tax_bps: u16)
  {
    const existing = await connection.getAccountInfo(hookConfig);
    if (existing) {
      console.log("hook_config already exists — skip initialize_config");
    } else {
      const data = Buffer.alloc(10);
      sighash("initialize_config").copy(data, 0);
      data.writeUInt16LE(DEX_TAX_BPS, 8);
      await send(
        "initialize_config",
        new TransactionInstruction({
          programId: hookProgramId,
          keys: [
            { pubkey: payer.publicKey, isSigner: true, isWritable: true },
            { pubkey: mint, isSigner: false, isWritable: false },
            { pubkey: hookConfig, isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          ],
          data,
        })
      );
    }
  }

  // initialize_extra_account_meta_list
  {
    const existing = await connection.getAccountInfo(extraAccountMetaList);
    if (existing) {
      console.log("extra_account_meta_list already exists — skip");
    } else {
      await send(
        "initialize_extra_account_meta_list",
        new TransactionInstruction({
          programId: hookProgramId,
          keys: [
            { pubkey: payer.publicKey, isSigner: true, isWritable: true },
            { pubkey: mint, isSigner: false, isWritable: false },
            { pubkey: extraAccountMetaList, isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          ],
          data: sighash("initialize_extra_account_meta_list"),
        })
      );
    }
  }

  const exemptAccounts: { label: string; pubkey: PublicKey }[] = [
    { label: "collateral_vault", pubkey: collateralVault },
  ];
  const genesis = deployed.genesisVaults as
    | Record<string, { bulletVault?: string }>
    | undefined;
  if (genesis) {
    for (const [name, v] of Object.entries(genesis)) {
      if (v.bulletVault) {
        exemptAccounts.push({
          label: `genesis ${name} bullet_vault`,
          pubkey: new PublicKey(v.bulletVault),
        });
      }
    }
  }

  for (const acc of exemptAccounts) {
    await send(
      `register_exempt_account (${acc.label})`,
      new TransactionInstruction({
        programId: hookProgramId,
        keys: [
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          { pubkey: mint, isSigner: false, isWritable: false },
          { pubkey: hookConfig, isSigner: false, isWritable: true },
          { pubkey: acc.pubkey, isSigner: false, isWritable: false },
        ],
        data: sighash("register_exempt_account"),
      })
    );
  }

  deployed.hookConfig = hookConfig.toBase58();
  deployed.extraAccountMetaList = extraAccountMetaList.toBase58();
  deployed.dexTransferTaxBps = DEX_TAX_BPS;
  fs.writeFileSync(deployedPath, JSON.stringify(deployed, null, 2));
  console.log("Updated", deployedPath);
  console.log("Transfer hook setup complete.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
