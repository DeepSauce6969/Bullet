/**
 * Authority: update a genesis vault fee_bps (VIP 0 / Community 250 / Public 350).
 * Usage: npx tsx scripts/set-genesis-fee-bps.ts <tier> <feeBps>
 * Example: npx tsx scripts/set-genesis-fee-bps.ts 2 350
 */
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

async function main() {
  const tier = Number(process.argv[2]);
  const feeBps = Number(process.argv[3]);
  if (!Number.isInteger(tier) || tier < 0 || tier > 2) {
    throw new Error("tier must be 0, 1, or 2");
  }
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 10_000) {
    throw new Error("feeBps must be 0..10000");
  }

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
  const programId = new PublicKey(deployed.programId);
  const protocol = new PublicKey(deployed.protocol);
  const [genesisVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("genesis_vault"), Buffer.from([tier])],
    programId
  );

  const data = Buffer.alloc(10);
  crypto
    .createHash("sha256")
    .update("global:set_genesis_fee_bps")
    .digest()
    .subarray(0, 8)
    .copy(data, 0);
  data.writeUInt16LE(feeBps, 8);

  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: false },
      { pubkey: protocol, isSigner: false, isWritable: false },
      { pubkey: genesisVault, isSigner: false, isWritable: true },
    ],
    data,
  });

  const sig = await sendAndConfirmTransaction(
    connection,
    new Transaction().add(ix),
    [payer],
    { commitment: "confirmed" }
  );
  console.log(`set_genesis_fee_bps tier=${tier} feeBps=${feeBps}`);
  console.log("vault", genesisVault.toBase58());
  console.log("sig", sig);

  // Keep deployed-devnet.json in sync for Public (tier 2) etc.
  const names = ["VIP Genesis", "Community", "Public"] as const;
  const name = names[tier];
  if (deployed.genesisVaults?.[name]) {
    deployed.genesisVaults[name].feeBps = feeBps;
    fs.writeFileSync(
      path.join(__dirname, "..", "deployed-devnet.json"),
      JSON.stringify(deployed, null, 2) + "\n"
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
