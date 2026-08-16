/**
 * Set protocol max_supply on the deployed program (authority = ~/.config/solana/id.json).
 * Usage: npx tsx scripts/set-max-supply-devnet.ts [humanAmount]
 * Default: 5_000_000 BULLET
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
  const deployed = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "deployed-devnet.json"), "utf8")
  );
  const human = Number(process.argv[2] ?? "5000000");
  const maxSupply = BigInt(Math.floor(human)) * 1_000_000n;

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
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const programId = new PublicKey(deployed.programId);
  const protocol = new PublicKey(deployed.protocol);

  const data = Buffer.alloc(16);
  crypto
    .createHash("sha256")
    .update("global:set_max_supply")
    .digest()
    .subarray(0, 8)
    .copy(data, 0);
  data.writeBigUInt64LE(maxSupply, 8);

  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: false },
      { pubkey: protocol, isSigner: false, isWritable: true },
    ],
    data,
  });

  const sig = await sendAndConfirmTransaction(
    connection,
    new Transaction().add(ix),
    [payer],
    { commitment: "confirmed" }
  );
  console.log("set_max_supply OK", human, "BULLET");
  console.log("sig", sig);
  console.log(
    "explorer",
    `https://explorer.solana.com/tx/${sig}?cluster=devnet`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
