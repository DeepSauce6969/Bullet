/**
 * Probe Meteora DLMM pool creation against the live Token-2022 BULLET mint.
 *
 * Expected until a Meteora token badge is granted: mint validation fails
 * because TransferHook program + authority are still set (required for our
 * DEX tax). DAMM v2 is not a fallback — it does not forward transfer-hook
 * extra accounts, so an active hook cannot settle on DAMM transfers.
 *
 * Usage: npx tsx scripts/probe-meteora-dlmm-pool.ts
 */
import DLMM, {
  ActivationType,
  deriveCustomizablePermissionlessLbPair,
  deriveTokenBadge,
  LBCLMM_PROGRAM_IDS,
} from "@meteora-ag/dlmm";
import { getMint, getTransferHook, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { Connection, Keypair, PublicKey, sendAndConfirmTransaction } from "@solana/web3.js";
import BN from "bn.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const RPC = "https://api.devnet.solana.com";
const WSOL = new PublicKey("So11111111111111111111111111111111111111112");

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
  const mint = new PublicKey(deployed.bulletMint);
  const programId = new PublicKey(LBCLMM_PROGRAM_IDS.devnet);

  const mintAccount = await getMint(connection, mint, "confirmed", TOKEN_2022_PROGRAM_ID);
  const hook = getTransferHook(mintAccount);
  console.log("BULLET mint", mint.toBase58());
  console.log("decimals", mintAccount.decimals, "freeze", mintAccount.freezeAuthority?.toBase58() ?? "None");
  console.log("transfer hook program", hook?.programId.toBase58() ?? "unset");
  console.log("transfer hook authority", hook?.authority.toBase58() ?? "unset");
  console.log("DLMM program (devnet)", programId.toBase58());

  const [lbPair] = deriveCustomizablePermissionlessLbPair(mint, WSOL, programId);
  const [badge] = deriveTokenBadge(mint, programId);
  const badgeInfo = await connection.getAccountInfo(badge, "confirmed");
  console.log("would-be DLMM pair", lbPair.toBase58());
  console.log("token badge PDA", badge.toBase58(), badgeInfo ? "EXISTS" : "missing (expected)");
  console.log("quote", "WSOL", WSOL.toBase58());

  try {
    const tx = await DLMM.createCustomizablePermissionlessLbPair2(
      connection,
      new BN(100),
      mint,
      WSOL,
      new BN(0),
      new BN(10),
      ActivationType.Slot,
      false,
      payer.publicKey,
      undefined,
      undefined,
      undefined,
      undefined,
      { cluster: "devnet" }
    );
    const sig = await sendAndConfirmTransaction(connection, tx, [payer], {
      skipPreflight: false,
      commitment: "confirmed",
    });
    console.log("UNEXPECTED SUCCESS — pool created", sig);
  } catch (err: any) {
    console.log("\nMeteora create pool FAILED (expected until token badge):");
    console.log(err?.message ?? err);
    const logs: string[] | undefined =
      err?.logs ??
      err?.transactionLogs ??
      (typeof err?.getLogs === "function" ? await err.getLogs().catch(() => undefined) : undefined);
    if (logs?.length) {
      console.log("logs:");
      for (const line of logs) console.log(" ", line);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
