/**
 * Init 3 genesis pre-deposit vaults on devnet (VIP / Community / Public).
 * Token-2022: includes bullet_token_program in account list.
 * Usage: npx tsx scripts/init-genesis-vaults.ts
 */
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Patched by redeploy-devnet.sh after keys sync
const PROGRAM_ID = new PublicKey("Gz7TX19wG7y4k8qCHt5eWQEpUMn6ALosV27PsWJDaAzJ");
const RPC = "https://api.devnet.solana.com";

const TIERS = [
  { tier: 0, name: "VIP Genesis", feeBps: 0, depositCap: 250_000n * 1_000_000n, maxAlloc: 25_000n * 1_000_000n },
  { tier: 1, name: "Community", feeBps: 250, depositCap: 500_000n * 1_000_000n, maxAlloc: 10_000n * 1_000_000n },
  { tier: 2, name: "Public", feeBps: 350, depositCap: 1_000_000n * 1_000_000n, maxAlloc: 5_000n * 1_000_000n },
];

function loadKeypair(p: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
}

function sighash(name: string): Buffer {
  return crypto.createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

function pda(seeds: (Buffer | Uint8Array)[]): PublicKey {
  return PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
}

async function main() {
  const deployedPath = path.join(__dirname, "..", "deployed-devnet.json");
  const deployed = JSON.parse(fs.readFileSync(deployedPath, "utf8"));
  const payer = loadKeypair(path.join(os.homedir(), ".config", "solana", "id.json"));
  const connection = new Connection(RPC, "confirmed");

  const protocol = new PublicKey(deployed.protocol);
  const ansemMint = new PublicKey(deployed.ansemMint);
  const bulletMint = new PublicKey(deployed.bulletMint);

  console.log("Payer:", payer.publicKey.toBase58());
  console.log("Balance:", (await connection.getBalance(payer.publicKey)) / 1e9, "SOL");

  const vaults: Record<string, unknown> = {};

  for (const t of TIERS) {
    const genesisVault = pda([Buffer.from("genesis_vault"), Buffer.from([t.tier])]);
    const tokenVault = pda([Buffer.from("genesis_ansem"), Buffer.from([t.tier])]);
    const bulletVault = pda([Buffer.from("genesis_bullet"), Buffer.from([t.tier])]);

    const existing = await connection.getAccountInfo(genesisVault);
    if (existing) {
      console.log(`${t.name} already exists:`, genesisVault.toBase58());
      vaults[t.name] = {
        tier: t.tier,
        genesisVault: genesisVault.toBase58(),
        tokenVault: tokenVault.toBase58(),
        bulletVault: bulletVault.toBase58(),
        feeBps: t.feeBps,
      };
      continue;
    }

    // init_genesis_vault(tier u8, fee_bps u16, deposit_cap u64, max_allocation u64)
    const data = Buffer.alloc(8 + 1 + 2 + 8 + 8);
    sighash("init_genesis_vault").copy(data, 0);
    data.writeUInt8(t.tier, 8);
    data.writeUInt16LE(t.feeBps, 9);
    data.writeBigUInt64LE(t.depositCap, 11);
    data.writeBigUInt64LE(t.maxAlloc, 19);

    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: protocol, isSigner: false, isWritable: false },
        { pubkey: ansemMint, isSigner: false, isWritable: false },
        { pubkey: bulletMint, isSigner: false, isWritable: false },
        { pubkey: genesisVault, isSigner: false, isWritable: true },
        { pubkey: tokenVault, isSigner: false, isWritable: true },
        { pubkey: bulletVault, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      ],
      data,
    });

    const sig = await sendAndConfirmTransaction(
      connection,
      new Transaction().add(ix),
      [payer],
      { commitment: "confirmed" }
    );
    console.log(`${t.name} init ok:`, genesisVault.toBase58(), sig);

    vaults[t.name] = {
      tier: t.tier,
      genesisVault: genesisVault.toBase58(),
      tokenVault: tokenVault.toBase58(),
      bulletVault: bulletVault.toBase58(),
      feeBps: t.feeBps,
      depositCap: Number(t.depositCap / 1_000_000n),
      maxAllocation: Number(t.maxAlloc / 1_000_000n),
      initTx: sig,
    };
  }

  deployed.genesisVaults = vaults;
  fs.writeFileSync(deployedPath, JSON.stringify(deployed, null, 2));
  console.log("Updated", deployedPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
