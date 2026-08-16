/**
 * Simulate burn_bullet on live deployed program with correct Token-2022 accounts.
 * Burn computes bullet_to_ansem_gross BEFORE the burn CPI, so MathOverflow surfaces
 * even without a funded user ATA (account validation may still fail first for missing ATA).
 *
 * Usage: npx tsx scripts/sim-burn-math-overflow.ts
 */
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import deployed from "../deployed-devnet.json";

const RPC = "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey(deployed.programId);
const PROTOCOL = new PublicKey(deployed.protocol);
const BULLET_MINT = new PublicKey(deployed.bulletMint);
const ANSEM_MINT = new PublicKey(deployed.ansemMint);
const VAULT = new PublicKey(deployed.vault);
const POL_VAULT = new PublicKey(deployed.polVault);
const FEE_RECIPIENT = new PublicKey(deployed.feeRecipient);

const BURN_DISC = Buffer.from([137, 161, 76, 144, 165, 163, 220, 83]);

async function main() {
  const connection = new Connection(RPC, "confirmed");
  const user = Keypair.generate().publicKey;
  const userAnsem = getAssociatedTokenAddressSync(ANSEM_MINT, user);
  const userBullet = getAssociatedTokenAddressSync(
    BULLET_MINT,
    user,
    false,
    TOKEN_2022_PROGRAM_ID
  );
  const feeAta = getAssociatedTokenAddressSync(ANSEM_MINT, FEE_RECIPIENT);

  const amount = 1_000_000_000n; // 1000 BULLET — t*backing overflows u64
  const data = Buffer.alloc(16);
  BURN_DISC.copy(data, 0);
  data.writeBigUInt64LE(amount, 8);

  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: PROTOCOL, isSigner: false, isWritable: true },
      { pubkey: BULLET_MINT, isSigner: false, isWritable: true },
      { pubkey: ANSEM_MINT, isSigner: false, isWritable: false },
      { pubkey: VAULT, isSigner: false, isWritable: true },
      { pubkey: POL_VAULT, isSigner: false, isWritable: true },
      { pubkey: FEE_RECIPIENT, isSigner: false, isWritable: false },
      { pubkey: feeAta, isSigner: false, isWritable: true },
      { pubkey: userBullet, isSigner: false, isWritable: true },
      { pubkey: userAnsem, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  });

  // Wrong accounts (missing Token-2022) — expect account error, not MathOverflow
  const badIx = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: PROTOCOL, isSigner: false, isWritable: true },
      { pubkey: BULLET_MINT, isSigner: false, isWritable: true },
      { pubkey: ANSEM_MINT, isSigner: false, isWritable: false },
      { pubkey: VAULT, isSigner: false, isWritable: true },
      { pubkey: POL_VAULT, isSigner: false, isWritable: true },
      { pubkey: FEE_RECIPIENT, isSigner: false, isWritable: false },
      { pubkey: feeAta, isSigner: false, isWritable: true },
      { pubkey: userBullet, isSigner: false, isWritable: true },
      { pubkey: userAnsem, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  });

  for (const [label, instruction] of [
    ["missing Token-2022 account", badIx],
    ["correct Token-2022 accounts", ix],
  ] as const) {
    const tx = new Transaction().add(instruction);
    tx.feePayer = user;
    const { blockhash } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    const sim = await connection.simulateTransaction(tx);
    console.log(`\n=== ${label} ===`);
    console.log("err:", JSON.stringify(sim.value.err));
    for (const l of sim.value.logs ?? []) console.log(" ", l);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
