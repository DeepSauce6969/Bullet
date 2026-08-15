import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import type { WalletContextState } from "@solana/wallet-adapter-react";
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  clusterApiUrl,
} from "@solana/web3.js";

export const PROGRAM_ID = new PublicKey(
  "Dae3D7CEUSLqxyHhzMquLtmzkhjNWnbpokS6t1hG4fk3"
);
/** Devnet mock Ansem (mainnet: 9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump). */
export const ANSEM_MINT = new PublicKey(
  "GCqc8CToxTNK97h6Zc72V8DfmHJKeEPFnWg2niDP7CgB"
);
export const PROTOCOL_PDA = new PublicKey(
  "GrzacYkUsrhctr8GaWAzTrVbtdM4a6ouL3D48fY533N5"
);
export const BULLET_MINT = new PublicKey(
  "5mn87veZKojAk8kviARtXehqvtoFsdb4pv1V284WfZGb"
);
export const VAULT = new PublicKey("4B7VmCqJs5yLE5juXVvDuTndeHyaCktGfhVsRZMPDwaF");
export const POL_VAULT = new PublicKey(
  "C3zBMAJrZNnsoLLBQzV3V9SV9btdLzQ3HJ3VpabwspD5"
);
export const COLLATERAL_VAULT = new PublicKey(
  "Aoe2U698NZxy94exyptDcVx38EoLNLhQPW1YdPUiE8Ey"
);
export const FEE_RECIPIENT = new PublicKey(
  "1zrYVfhRhMNkmnSBazaKKzRwAc4GLyP3Kew9K4SCnMo"
);

export const CLUSTER = "devnet" as const;
export const RPC_URL = clusterApiUrl(CLUSTER);
export const EXPLORER_TX = (sig: string) =>
  `https://explorer.solana.com/tx/${sig}?cluster=${CLUSTER}`;

export const BULLET_DECIMALS = 6;
export const ANSEM_DECIMALS = 6;
export const DEFAULT_MAX_SUPPLY = 2_500;
export const BUY_FEE_PCT = 2.5;
export const SELL_FEE_PCT = 2.5;
export const BORROW_APR_PCT = 3.9;
export const BASE_BORROW_FEE_PCT = 0.1;

/** Anchor sha256("global:<name>")[0..8] */
const IX_DISC: Record<string, number[]> = {
  initialize: [175, 175, 109, 31, 13, 152, 155, 237],
  mint_bullet: [9, 170, 106, 201, 179, 12, 221, 147],
  burn_bullet: [137, 161, 76, 144, 165, 163, 220, 83],
  borrow: [228, 253, 131, 202, 207, 116, 89, 18],
  repay: [234, 103, 67, 82, 208, 234, 219, 166],
  leverage: [90, 173, 201, 136, 28, 211, 126, 59],
  liquidate: [223, 179, 226, 125, 48, 46, 39, 74],
  set_fee_recipient: [227, 18, 215, 42, 237, 246, 151, 66],
  init_genesis_vault: [216, 130, 217, 204, 17, 60, 88, 217],
  deposit_genesis: [169, 26, 78, 22, 234, 157, 233, 237],
  withdraw_genesis: [215, 26, 193, 114, 79, 4, 138, 19],
  finalize_genesis: [14, 52, 206, 170, 165, 216, 46, 149],
  claim_genesis: [40, 81, 178, 99, 190, 154, 208, 254],
};

function disc(name: string): Buffer {
  const arr = IX_DISC[name];
  if (!arr) throw new Error(`Unknown instruction ${name}`);
  return Buffer.from(arr);
}

export type ProtocolMetrics = {
  floorPrice: string;
  backing: string;
  totalSupply: string;
  totalMinted: string;
  activeBorrows: string;
  backingRatio: string;
  tradingEnabled: boolean;
  loanCount: number;
};

export type LoanView = {
  address: string;
  collateral: string;
  borrowed: string;
  endDate: string;
  hasLoan: boolean;
  endTs: number;
  active: boolean;
};

export const EMPTY_LOAN: LoanView = {
  address: "",
  collateral: "0",
  borrowed: "0",
  endDate: "—",
  hasLoan: false,
  endTs: 0,
  active: false,
};

export type ProtocolAccount = {
  authority: PublicKey;
  bulletMint: PublicKey;
  ansemMint: PublicKey;
  vault: PublicKey;
  polVault: PublicKey;
  feeRecipient: PublicKey;
  collateralVault: PublicKey;
  bump: number;
  mintBump: number;
  totalMinted: bigint;
  maxSupply: bigint;
  totalBorrowed: bigint;
  totalSupply: bigint;
  loanCount: bigint;
  tradingEnabled: boolean;
};

export function getConnection(): Connection {
  return new Connection(RPC_URL, "confirmed");
}

export function formatUnits(
  raw: bigint | number,
  decimals = BULLET_DECIMALS
): string {
  const n = typeof raw === "bigint" ? Number(raw) : raw;
  return (n / 10 ** decimals).toFixed(4);
}

export function parseUnits(value: string, decimals = BULLET_DECIMALS): bigint {
  const [whole, frac = ""] = value.trim().split(".");
  const padded = (frac + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(whole || "0") * BigInt(10 ** decimals) + BigInt(padded || "0");
}

export function estimateMintReceive(ansemAmount: number, floor: number): string {
  if (!ansemAmount || floor <= 0) return "0";
  const net = ansemAmount * (1 - BUY_FEE_PCT / 100);
  return (net / floor).toFixed(4);
}

export function estimateBurnReceive(bulletAmount: number, floor: number): string {
  if (!bulletAmount || floor <= 0) return "0";
  const gross = bulletAmount * floor;
  return (gross * (1 - SELL_FEE_PCT / 100)).toFixed(4);
}

export function estimateInterest(amount: number, days: number): string {
  if (!amount || days <= 0) return "0";
  const apy = (amount * (BORROW_APR_PCT / 100) * days) / 365;
  const base = amount * (BASE_BORROW_FEE_PCT / 100);
  return (apy + base).toFixed(4);
}

function readPubkey(data: Buffer, offset: number): PublicKey {
  return new PublicKey(data.subarray(offset, offset + 32));
}

function readU64(data: Buffer, offset: number): bigint {
  return data.readBigUInt64LE(offset);
}

function readI64(data: Buffer, offset: number): bigint {
  return data.readBigInt64LE(offset);
}

export function decodeProtocol(data: Buffer): ProtocolAccount {
  let o = 8;
  const authority = readPubkey(data, o); o += 32;
  const bulletMint = readPubkey(data, o); o += 32;
  const ansemMint = readPubkey(data, o); o += 32;
  const vault = readPubkey(data, o); o += 32;
  const polVault = readPubkey(data, o); o += 32;
  const feeRecipient = readPubkey(data, o); o += 32;
  const collateralVault = readPubkey(data, o); o += 32;
  const bump = data[o++];
  const mintBump = data[o++];
  const totalMinted = readU64(data, o); o += 8;
  const maxSupply = readU64(data, o); o += 8;
  const totalBorrowed = readU64(data, o); o += 8;
  const totalSupply = readU64(data, o); o += 8;
  const loanCount = readU64(data, o); o += 8;
  const tradingEnabled = data[o] !== 0;
  return {
    authority,
    bulletMint,
    ansemMint,
    vault,
    polVault,
    feeRecipient,
    collateralVault,
    bump,
    mintBump,
    totalMinted,
    maxSupply,
    totalBorrowed,
    totalSupply,
    loanCount,
    tradingEnabled,
  };
}

export async function fetchProtocol(
  connection: Connection = getConnection()
): Promise<ProtocolAccount | null> {
  const info = await connection.getAccountInfo(PROTOCOL_PDA);
  if (!info) return null;
  return decodeProtocol(Buffer.from(info.data));
}

export async function fetchMetrics(
  connection: Connection = getConnection()
): Promise<ProtocolMetrics> {
  const proto = await fetchProtocol(connection);
  if (!proto) {
    return {
      floorPrice: "1.0000",
      backing: "0.0000",
      totalSupply: "0.0000",
      totalMinted: "0.0000",
      activeBorrows: "0.0000",
      backingRatio: "100.00",
      tradingEnabled: false,
      loanCount: 0,
    };
  }
  const vaultAcc = await getAccount(connection, proto.vault).catch(() => null);
  const vaultBal = vaultAcc ? vaultAcc.amount : BigInt(0);
  const backing = vaultBal + proto.totalBorrowed;
  const supply = proto.totalSupply;
  const floor = supply === BigInt(0) ? 1 : Number(backing) / Number(supply);
  const idle = Number(vaultBal) / 1e6;
  const borrowed = Number(proto.totalBorrowed) / 1e6;
  const backingNum = Number(backing) / 1e6;
  return {
    floorPrice: floor.toFixed(4),
    backing: backingNum.toFixed(4),
    totalSupply: (Number(supply) / 1e6).toFixed(4),
    totalMinted: (Number(proto.totalMinted) / 1e6).toFixed(4),
    activeBorrows: borrowed.toFixed(4),
    backingRatio:
      backingNum > 0 ? ((idle / backingNum) * 100).toFixed(2) : "100.00",
    tradingEnabled: proto.tradingEnabled,
    loanCount: Number(proto.loanCount),
  };
}

export async function fetchTokenBalances(
  owner: PublicKey,
  connection: Connection = getConnection()
): Promise<{ ansem: string; bullet: string }> {
  const ansemAta = getAssociatedTokenAddressSync(ANSEM_MINT, owner);
  const bulletAta = getAssociatedTokenAddressSync(BULLET_MINT, owner);
  const [a, b] = await Promise.all([
    getAccount(connection, ansemAta).catch(() => null),
    getAccount(connection, bulletAta).catch(() => null),
  ]);
  return {
    ansem: formatUnits(a ? a.amount : BigInt(0), ANSEM_DECIMALS),
    bullet: formatUnits(b ? b.amount : BigInt(0), BULLET_DECIMALS),
  };
}

export function loanPda(
  protocol: PublicKey,
  borrower: PublicKey,
  loanIndex: bigint | number
): PublicKey {
  const idx = Buffer.alloc(8);
  idx.writeBigUInt64LE(BigInt(loanIndex));
  return PublicKey.findProgramAddressSync(
    [Buffer.from("loan"), protocol.toBuffer(), borrower.toBuffer(), idx],
    PROGRAM_ID
  )[0];
}

export async function fetchActiveLoan(
  owner: PublicKey,
  connection: Connection = getConnection()
): Promise<LoanView> {
  const proto = await fetchProtocol(connection);
  if (!proto) return EMPTY_LOAN;
  const count = Number(proto.loanCount);
  for (let i = count - 1; i >= 0 && i >= count - 50; i--) {
    const addr = loanPda(PROTOCOL_PDA, owner, i);
    const info = await connection.getAccountInfo(addr);
    if (!info) continue;
    const data = Buffer.from(info.data);
    const borrower = readPubkey(data, 8 + 32);
    if (!borrower.equals(owner)) continue;
    const collateral = readU64(data, 8 + 64);
    const borrowedAmt = readU64(data, 8 + 72);
    const endTs = Number(readI64(data, 8 + 88));
    const active = data[8 + 96] !== 0;
    if (!active) continue;
    return {
      address: addr.toBase58(),
      collateral: formatUnits(collateral),
      borrowed: formatUnits(borrowedAmt, ANSEM_DECIMALS),
      endDate: new Date(endTs * 1000).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      }),
      hasLoan: true,
      endTs,
      active,
    };
  }
  return EMPTY_LOAN;
}

/** Pull a concise message from Solana simulateTransaction logs / err. */
function formatSimError(
  err: unknown,
  logs: string[] | null | undefined
): Error {
  const joined = (logs ?? []).join("\n");
  const anchorLine =
    (logs ?? []).find((l) => l.includes("AnchorError")) ??
    (logs ?? []).find((l) => /Error Code:|Error Message:/.test(l));

  const codeName = anchorLine?.match(/Error Code:\s*(\w+)/)?.[1];
  const codeNum =
    anchorLine?.match(/Error Number:\s*(\d+)/)?.[1] ??
    (typeof err === "object" && err !== null
      ? JSON.stringify(err).match(/Custom["\s:]*(\d+)/)?.[1]
      : undefined);
  const codeMsg = anchorLine?.match(/Error Message:\s*(.+?)(?:\.|$)/)?.[1];

  if (codeName || codeMsg) {
    const parts = [
      codeName,
      codeNum ? `(${codeNum})` : null,
      codeMsg ? `— ${codeMsg}` : null,
    ].filter(Boolean);
    return new Error(parts.join(" "));
  }

  if (anchorLine) {
    return new Error(anchorLine.replace(/^Program log:\s*/, ""));
  }

  return new Error(
    `Transaction simulation failed: ${
      err && typeof err === "object" ? JSON.stringify(err) : String(err)
    }`
  );
}

async function sendIx(
  wallet: WalletContextState,
  connection: Connection,
  ixs: TransactionInstruction[]
): Promise<string> {
  if (!wallet.publicKey || !wallet.sendTransaction) {
    throw new Error("Wallet not connected");
  }
  const tx = new Transaction().add(...ixs);
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = wallet.publicKey;

  // Pre-simulate so Anchor custom errors surface before the wallet swallows them.
  let sim: Awaited<ReturnType<Connection["simulateTransaction"]>> | null =
    null;
  try {
    sim = await connection.simulateTransaction(tx);
  } catch {
    // RPC simulate unavailable — fall through to wallet send
  }
  if (sim?.value.err) {
    throw formatSimError(sim.value.err, sim.value.logs);
  }

  const sig = await wallet.sendTransaction(tx, connection);
  await connection.confirmTransaction(
    { signature: sig, blockhash, lastValidBlockHeight },
    "confirmed"
  );
  return sig;
}

export async function mintBullet(
  wallet: WalletContextState,
  ansemAmount: bigint,
  connection: Connection = getConnection()
): Promise<string> {
  if (!wallet.publicKey) throw new Error("Wallet not connected");
  const user = wallet.publicKey;
  const userAnsem = getAssociatedTokenAddressSync(ANSEM_MINT, user);
  const userBullet = getAssociatedTokenAddressSync(BULLET_MINT, user);
  const feeAta = getAssociatedTokenAddressSync(ANSEM_MINT, FEE_RECIPIENT);

  const data = Buffer.alloc(16);
  disc("mint_bullet").copy(data, 0);
  data.writeBigUInt64LE(ansemAmount, 8);

  return sendIx(wallet, connection, [
    createAssociatedTokenAccountIdempotentInstruction(
      user,
      userBullet,
      user,
      BULLET_MINT
    ),
    new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: user, isSigner: true, isWritable: true },
        { pubkey: PROTOCOL_PDA, isSigner: false, isWritable: true },
        { pubkey: BULLET_MINT, isSigner: false, isWritable: true },
        { pubkey: ANSEM_MINT, isSigner: false, isWritable: false },
        { pubkey: VAULT, isSigner: false, isWritable: true },
        { pubkey: POL_VAULT, isSigner: false, isWritable: true },
        { pubkey: FEE_RECIPIENT, isSigner: false, isWritable: false },
        { pubkey: feeAta, isSigner: false, isWritable: true },
        { pubkey: userAnsem, isSigner: false, isWritable: true },
        { pubkey: userBullet, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    }),
  ]);
}

export async function burnBullet(
  wallet: WalletContextState,
  bulletAmount: bigint,
  connection: Connection = getConnection()
): Promise<string> {
  if (!wallet.publicKey) throw new Error("Wallet not connected");
  const user = wallet.publicKey;
  const userAnsem = getAssociatedTokenAddressSync(ANSEM_MINT, user);
  const userBullet = getAssociatedTokenAddressSync(BULLET_MINT, user);
  const feeAta = getAssociatedTokenAddressSync(ANSEM_MINT, FEE_RECIPIENT);

  const data = Buffer.alloc(16);
  disc("burn_bullet").copy(data, 0);
  data.writeBigUInt64LE(bulletAmount, 8);

  return sendIx(wallet, connection, [
    new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: user, isSigner: true, isWritable: true },
        { pubkey: PROTOCOL_PDA, isSigner: false, isWritable: true },
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
    }),
  ]);
}

export async function borrowAnsem(
  wallet: WalletContextState,
  ansemAmount: bigint,
  days: number,
  connection: Connection = getConnection()
): Promise<string> {
  if (!wallet.publicKey) throw new Error("Wallet not connected");
  const user = wallet.publicKey;
  const proto = await fetchProtocol(connection);
  if (!proto) throw new Error("Protocol not initialized");

  const loan = loanPda(PROTOCOL_PDA, user, proto.loanCount);
  const userAnsem = getAssociatedTokenAddressSync(ANSEM_MINT, user);
  const userBullet = getAssociatedTokenAddressSync(BULLET_MINT, user);
  const feeAta = getAssociatedTokenAddressSync(ANSEM_MINT, FEE_RECIPIENT);

  const data = Buffer.alloc(18);
  disc("borrow").copy(data, 0);
  data.writeBigUInt64LE(ansemAmount, 8);
  data.writeUInt16LE(days, 16);

  return sendIx(wallet, connection, [
    new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: user, isSigner: true, isWritable: true },
        { pubkey: PROTOCOL_PDA, isSigner: false, isWritable: true },
        { pubkey: BULLET_MINT, isSigner: false, isWritable: true },
        { pubkey: ANSEM_MINT, isSigner: false, isWritable: false },
        { pubkey: VAULT, isSigner: false, isWritable: true },
        { pubkey: POL_VAULT, isSigner: false, isWritable: true },
        { pubkey: COLLATERAL_VAULT, isSigner: false, isWritable: true },
        { pubkey: FEE_RECIPIENT, isSigner: false, isWritable: false },
        { pubkey: feeAta, isSigner: false, isWritable: true },
        { pubkey: userBullet, isSigner: false, isWritable: true },
        { pubkey: userAnsem, isSigner: false, isWritable: true },
        { pubkey: loan, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    }),
  ]);
}

export async function repayLoan(
  wallet: WalletContextState,
  loanAddress: string,
  connection: Connection = getConnection()
): Promise<string> {
  if (!wallet.publicKey) throw new Error("Wallet not connected");
  const user = wallet.publicKey;
  const loan = new PublicKey(loanAddress);
  const userAnsem = getAssociatedTokenAddressSync(ANSEM_MINT, user);
  const userBullet = getAssociatedTokenAddressSync(BULLET_MINT, user);

  return sendIx(wallet, connection, [
    new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: user, isSigner: true, isWritable: true },
        { pubkey: PROTOCOL_PDA, isSigner: false, isWritable: true },
        { pubkey: BULLET_MINT, isSigner: false, isWritable: false },
        { pubkey: ANSEM_MINT, isSigner: false, isWritable: false },
        { pubkey: VAULT, isSigner: false, isWritable: true },
        { pubkey: COLLATERAL_VAULT, isSigner: false, isWritable: true },
        { pubkey: userAnsem, isSigner: false, isWritable: true },
        { pubkey: userBullet, isSigner: false, isWritable: true },
        { pubkey: loan, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data: disc("repay"),
    }),
  ]);
}

/** Liquidate an expired loan (any signer). Burns locked collateral. */
export async function liquidateLoan(
  wallet: WalletContextState,
  loanAddress: string,
  connection: Connection = getConnection()
): Promise<string> {
  if (!wallet.publicKey) throw new Error("Wallet not connected");
  const liquidator = wallet.publicKey;
  const loan = new PublicKey(loanAddress);

  return sendIx(wallet, connection, [
    new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: liquidator, isSigner: true, isWritable: true },
        { pubkey: PROTOCOL_PDA, isSigner: false, isWritable: true },
        { pubkey: BULLET_MINT, isSigner: false, isWritable: true },
        { pubkey: VAULT, isSigner: false, isWritable: true },
        { pubkey: COLLATERAL_VAULT, isSigner: false, isWritable: true },
        { pubkey: loan, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data: disc("liquidate"),
    }),
  ]);
}

export async function leveragePosition(
  wallet: WalletContextState,
  ansemAmount: bigint,
  days: number,
  connection: Connection = getConnection()
): Promise<string> {
  if (!wallet.publicKey) throw new Error("Wallet not connected");
  const user = wallet.publicKey;
  const proto = await fetchProtocol(connection);
  if (!proto) throw new Error("Protocol not initialized");

  const loan = loanPda(PROTOCOL_PDA, user, proto.loanCount);
  const userAnsem = getAssociatedTokenAddressSync(ANSEM_MINT, user);
  const userBullet = getAssociatedTokenAddressSync(BULLET_MINT, user);
  const feeAta = getAssociatedTokenAddressSync(ANSEM_MINT, FEE_RECIPIENT);

  const data = Buffer.alloc(18);
  disc("leverage").copy(data, 0);
  data.writeBigUInt64LE(ansemAmount, 8);
  data.writeUInt16LE(days, 16);

  return sendIx(wallet, connection, [
    createAssociatedTokenAccountIdempotentInstruction(
      user,
      userBullet,
      user,
      BULLET_MINT
    ),
    new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: user, isSigner: true, isWritable: true },
        { pubkey: PROTOCOL_PDA, isSigner: false, isWritable: true },
        { pubkey: BULLET_MINT, isSigner: false, isWritable: true },
        { pubkey: ANSEM_MINT, isSigner: false, isWritable: false },
        { pubkey: VAULT, isSigner: false, isWritable: true },
        { pubkey: POL_VAULT, isSigner: false, isWritable: true },
        { pubkey: COLLATERAL_VAULT, isSigner: false, isWritable: true },
        { pubkey: FEE_RECIPIENT, isSigner: false, isWritable: false },
        { pubkey: feeAta, isSigner: false, isWritable: true },
        { pubkey: userAnsem, isSigner: false, isWritable: true },
        { pubkey: userBullet, isSigner: false, isWritable: true },
        { pubkey: loan, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    }),
  ]);
}

// --- Genesis pre-deposit vaults ---

export type GenesisTierId = "vip" | "community" | "public";

export const GENESIS_TIERS: {
  id: GenesisTierId;
  tier: number;
  name: string;
  fee: string;
  feePercent: number;
}[] = [
  { id: "vip", tier: 0, name: "VIP Genesis", fee: "0%", feePercent: 0 },
  { id: "community", tier: 1, name: "Community", fee: "1%", feePercent: 1 },
  { id: "public", tier: 2, name: "Public", fee: "1.5%", feePercent: 1.5 },
];

export function genesisVaultPda(tier: number): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("genesis_vault"), Buffer.from([tier])],
    PROGRAM_ID
  )[0];
}

export function genesisTokenVaultPda(tier: number): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("genesis_ansem"), Buffer.from([tier])],
    PROGRAM_ID
  )[0];
}

export function genesisBulletVaultPda(tier: number): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("genesis_bullet"), Buffer.from([tier])],
    PROGRAM_ID
  )[0];
}

export function userDepositPda(
  genesisVault: PublicKey,
  user: PublicKey
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("user_deposit"), genesisVault.toBuffer(), user.toBuffer()],
    PROGRAM_ID
  )[0];
}

export type GenesisVaultView = {
  tier: number;
  id: GenesisTierId;
  name: string;
  fee: string;
  feePercent: number;
  address: string;
  tokenVault: string;
  bulletVault: string;
  feeBps: number;
  depositCap: number;
  maxAllocation: number;
  totalRaised: number;
  totalBullet: number;
  progressPercent: number;
  presaleActive: boolean;
  isFinalized: boolean;
  exists: boolean;
  userContribution: number;
  userClaimed: boolean;
  remainingAllocation: number;
};

export function decodeGenesisVault(data: Buffer): {
  feeBps: number;
  depositCap: bigint;
  maxAllocation: bigint;
  totalRaised: bigint;
  totalBullet: bigint;
  tier: number;
  tokenVault: PublicKey;
  bulletVault: PublicKey;
  presaleActive: boolean;
  isFinalized: boolean;
} {
  let o = 8 + 32 + 32;
  const tokenVault = readPubkey(data, o);
  o += 32;
  const bulletVault = readPubkey(data, o);
  o += 32;
  const feeBps = data.readUInt16LE(o);
  o += 2;
  const depositCap = readU64(data, o);
  o += 8;
  const maxAllocation = readU64(data, o);
  o += 8;
  const totalRaised = readU64(data, o);
  o += 8;
  const totalBullet = readU64(data, o);
  o += 8;
  const tier = data[o++];
  o += 3;
  const presaleActive = data[o++] !== 0;
  const isFinalized = data[o++] !== 0;
  return {
    feeBps,
    depositCap,
    maxAllocation,
    totalRaised,
    totalBullet,
    tier,
    tokenVault,
    bulletVault,
    presaleActive,
    isFinalized,
  };
}

function emptyGenesisVaultView(
  meta: (typeof GENESIS_TIERS)[number]
): GenesisVaultView {
  const address = genesisVaultPda(meta.tier);
  return {
    ...meta,
    address: address.toBase58(),
    tokenVault: genesisTokenVaultPda(meta.tier).toBase58(),
    bulletVault: genesisBulletVaultPda(meta.tier).toBase58(),
    feeBps: meta.feePercent * 100,
    depositCap: 0,
    maxAllocation: 0,
    totalRaised: 0,
    totalBullet: 0,
    progressPercent: 0,
    presaleActive: false,
    isFinalized: false,
    exists: false,
    userContribution: 0,
    userClaimed: false,
    remainingAllocation: 0,
  };
}

/** Instant placeholders so genesis cards render before RPC returns. */
export function placeholderGenesisVaults(): GenesisVaultView[] {
  return GENESIS_TIERS.map(emptyGenesisVaultView);
}

export async function fetchGenesisVaults(
  owner: PublicKey | null,
  connection: Connection = getConnection()
): Promise<GenesisVaultView[]> {
  const vaultKeys = GENESIS_TIERS.map((meta) => genesisVaultPda(meta.tier));
  const userKeys = owner
    ? vaultKeys.map((vault) => userDepositPda(vault, owner))
    : [];
  const infos = await connection.getMultipleAccountsInfo([
    ...vaultKeys,
    ...userKeys,
  ]);

  return GENESIS_TIERS.map((meta, i) => {
    const info = infos[i];
    if (!info) return emptyGenesisVaultView(meta);

    const decoded = decodeGenesisVault(Buffer.from(info.data));
    const depositCap = Number(decoded.depositCap) / 1e6;
    const maxAllocation = Number(decoded.maxAllocation) / 1e6;
    const totalRaised = Number(decoded.totalRaised) / 1e6;
    const totalBullet = Number(decoded.totalBullet) / 1e6;

    let userContribution = 0;
    let userClaimed = false;
    const udInfo = owner ? infos[GENESIS_TIERS.length + i] : null;
    if (udInfo) {
      const d = Buffer.from(udInfo.data);
      userContribution = Number(readU64(d, 8 + 64)) / 1e6;
      userClaimed = d[8 + 72] !== 0;
    }

    return {
      ...meta,
      address: vaultKeys[i].toBase58(),
      tokenVault: decoded.tokenVault.toBase58(),
      bulletVault: decoded.bulletVault.toBase58(),
      feeBps: decoded.feeBps,
      depositCap,
      maxAllocation,
      totalRaised,
      totalBullet,
      progressPercent: depositCap > 0 ? (totalRaised / depositCap) * 100 : 0,
      presaleActive: decoded.presaleActive,
      isFinalized: decoded.isFinalized,
      exists: true,
      userContribution,
      userClaimed,
      remainingAllocation: Math.max(0, maxAllocation - userContribution),
    };
  });
}

export async function depositGenesis(
  wallet: WalletContextState,
  tier: number,
  amount: bigint,
  connection: Connection = getConnection()
): Promise<string> {
  if (!wallet.publicKey) throw new Error("Wallet not connected");
  const user = wallet.publicKey;
  const genesisVault = genesisVaultPda(tier);
  const tokenVault = genesisTokenVaultPda(tier);
  const userAnsem = getAssociatedTokenAddressSync(ANSEM_MINT, user);
  const userDeposit = userDepositPda(genesisVault, user);

  const data = Buffer.alloc(16);
  disc("deposit_genesis").copy(data, 0);
  data.writeBigUInt64LE(amount, 8);

  return sendIx(wallet, connection, [
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
  ]);
}

export async function withdrawGenesis(
  wallet: WalletContextState,
  tier: number,
  connection: Connection = getConnection()
): Promise<string> {
  if (!wallet.publicKey) throw new Error("Wallet not connected");
  const user = wallet.publicKey;
  const genesisVault = genesisVaultPda(tier);
  const tokenVault = genesisTokenVaultPda(tier);
  const userAnsem = getAssociatedTokenAddressSync(ANSEM_MINT, user);
  const userDeposit = userDepositPda(genesisVault, user);

  return sendIx(wallet, connection, [
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
      data: disc("withdraw_genesis"),
    }),
  ]);
}

export async function claimGenesis(
  wallet: WalletContextState,
  tier: number,
  connection: Connection = getConnection()
): Promise<string> {
  if (!wallet.publicKey) throw new Error("Wallet not connected");
  const user = wallet.publicKey;
  const genesisVault = genesisVaultPda(tier);
  const bulletVault = genesisBulletVaultPda(tier);
  const userBullet = getAssociatedTokenAddressSync(BULLET_MINT, user);
  const userDeposit = userDepositPda(genesisVault, user);

  return sendIx(wallet, connection, [
    createAssociatedTokenAccountIdempotentInstruction(
      user,
      userBullet,
      user,
      BULLET_MINT
    ),
    new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: user, isSigner: true, isWritable: true },
        { pubkey: genesisVault, isSigner: false, isWritable: true },
        { pubkey: bulletVault, isSigner: false, isWritable: true },
        { pubkey: PROTOCOL_PDA, isSigner: false, isWritable: false },
        { pubkey: BULLET_MINT, isSigner: false, isWritable: false },
        { pubkey: userBullet, isSigner: false, isWritable: true },
        { pubkey: userDeposit, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        {
          pubkey: ASSOCIATED_TOKEN_PROGRAM_ID,
          isSigner: false,
          isWritable: false,
        },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: disc("claim_genesis"),
    }),
  ]);
}
