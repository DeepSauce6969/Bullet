import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccount,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  transferCheckedWithTransferHook,
  createTransferCheckedWithFeeAndTransferHookInstruction,
} from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { assert } from "chai";
import type { Bullet } from "../target/types/bullet";
import type { BulletTransferHook } from "../target/types/bullet_transfer_hook";

const ONE = 1_000_000;
const DEX_TAX_BPS = 800; // 8%

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function bal(
  connection: anchor.web3.Connection,
  ata: PublicKey,
  tokenProgram: PublicKey = TOKEN_2022_PROGRAM_ID,
  retries = 20,
  allowMissing = false
): Promise<bigint> {
  const { getAccount } = await import("@solana/spl-token");
  let lastErr: unknown;
  for (let i = 0; i < retries; i++) {
    try {
      const rpc = await connection.getTokenAccountBalance(ata, "confirmed");
      if (rpc?.value?.amount != null) return BigInt(rpc.value.amount);
    } catch (e) {
      lastErr = e;
    }
    try {
      const acc = await getAccount(connection, ata, "confirmed", tokenProgram);
      return acc.amount;
    } catch (e) {
      lastErr = e;
    }
    try {
      const info = await connection.getAccountInfo(ata, "confirmed");
      if (info?.data && info.data.length >= 72) {
        return Buffer.from(info.data).readBigUInt64LE(64);
      }
    } catch (e) {
      lastErr = e;
    }
    await sleep(150 + i * 50);
  }
  if (allowMissing) return 0n;
  throw new Error(`bal(${ata.toBase58()}) failed after ${retries}: ${String(lastErr)}`);
}

async function waitBal(
  connection: anchor.web3.Connection,
  ata: PublicKey,
  pred: (n: bigint) => boolean,
  tokenProgram: PublicKey = TOKEN_2022_PROGRAM_ID,
  retries = 24
): Promise<bigint> {
  let last = 0n;
  for (let i = 0; i < retries; i++) {
    last = await bal(connection, ata, tokenProgram, 4, true);
    if (pred(last)) return last;
    await sleep(200 + i * 50);
  }
  throw new Error(`waitBal(${ata.toBase58()}) last=${last} after ${retries}`);
}

describe("bullet transfer hook (DEX tax)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const bullet = anchor.workspace.Bullet as Program<Bullet>;
  const hook = anchor.workspace.BulletTransferHook as Program<BulletTransferHook>;
  const HOOK_PROGRAM_ID = hook.programId;
  const connection = provider.connection;
  const wallet = provider.wallet as anchor.Wallet;

  const pda = (seeds: (Buffer | Uint8Array)[], programId: PublicKey) =>
    PublicKey.findProgramAddressSync(seeds, programId)[0];

  let ansemMint: PublicKey;
  let feeRecipient: Keypair;
  let protocolPda: PublicKey;
  let bulletMint: PublicKey;
  let vault: PublicKey;
  let polVault: PublicKey;
  let collateralVault: PublicKey;
  let hookConfig: PublicKey;
  let extraAccountMetaList: PublicKey;
  let userAnsem: PublicKey;
  let userBullet: PublicKey;

  before(async () => {
    const { createMint, mintTo } = await import("@solana/spl-token");
    ansemMint = await createMint(
      connection,
      wallet.payer,
      wallet.publicKey,
      null,
      6
    );
    feeRecipient = Keypair.generate();
    await createAssociatedTokenAccount(
      connection,
      wallet.payer,
      ansemMint,
      feeRecipient.publicKey
    );

    protocolPda = pda([Buffer.from("protocol")], bullet.programId);
    bulletMint = pda([Buffer.from("bullet_mint")], bullet.programId);
    vault = pda([Buffer.from("vault")], bullet.programId);
    polVault = pda([Buffer.from("pol_vault")], bullet.programId);
    collateralVault = pda([Buffer.from("collateral_vault")], bullet.programId);
    hookConfig = pda([Buffer.from("hook_config"), bulletMint.toBuffer()], HOOK_PROGRAM_ID);
    extraAccountMetaList = pda(
      [Buffer.from("extra-account-metas"), bulletMint.toBuffer()],
      HOOK_PROGRAM_ID
    );

    userAnsem = await createAssociatedTokenAccount(
      connection,
      wallet.payer,
      ansemMint,
      wallet.publicKey
    );
    await mintTo(
      connection,
      wallet.payer,
      ansemMint,
      userAnsem,
      wallet.payer,
      BigInt(100_000) * BigInt(ONE)
    );
    userBullet = getAssociatedTokenAddressSync(
      bulletMint,
      wallet.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );
  });

  it("initializes protocol + hook + mints BULLET", async () => {
    const existing = await connection.getAccountInfo(protocolPda);
    if (!existing) {
      await bullet.methods
        .initialize(new anchor.BN(5_000_000 * ONE), feeRecipient.publicKey)
        .accountsPartial({
          authority: wallet.publicKey,
          protocol: protocolPda,
          bulletMint,
          ansemMint,
          vault,
          polVault,
          collateralVault,
          transferHookProgram: HOOK_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          token2022Program: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .rpc();
    }

    const hookCfgInfo = await connection.getAccountInfo(hookConfig);
    if (!hookCfgInfo) {
      await hook.methods
        .initializeConfig(DEX_TAX_BPS)
        .accountsPartial({
          authority: wallet.publicKey,
          mint: bulletMint,
          hookConfig,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    }

    const extraMetaInfo = await connection.getAccountInfo(extraAccountMetaList);
    if (!extraMetaInfo) {
      await hook.methods
        .initializeExtraAccountMetaList()
        .accountsPartial({
          payer: wallet.publicKey,
          mint: bulletMint,
          extraAccountMetaList,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    }

    try {
      await hook.methods
        .registerExemptAccount()
        .accountsPartial({
          authority: wallet.publicKey,
          mint: bulletMint,
          hookConfig,
          tokenAccount: collateralVault,
        })
        .rpc();
    } catch {
      // already exempt
    }

    const userBulletBal = await bal(connection, userBullet);
    if (userBulletBal === 0n) {
      await bullet.methods
        .mintBullet(new anchor.BN(10 * ONE))
      .accountsPartial({
        user: wallet.publicKey,
        protocol: protocolPda,
        bulletMint,
        ansemMint,
        vault,
        polVault,
        feeRecipient: feeRecipient.publicKey,
        userAnsem,
        userBullet,
        tokenProgram: TOKEN_PROGRAM_ID,
        bulletTokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    }

    const bulletBal = await waitBal(connection, userBullet, (n) => n > 0n);
    assert.isTrue(bulletBal > 0n);
  });

  it("blocks wallet-to-wallet BULLET transfer", async () => {
    const recipient = Keypair.generate();
    const recipientBullet = getAssociatedTokenAddressSync(
      bulletMint,
      recipient.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );
    await createAssociatedTokenAccount(
      connection,
      wallet.payer,
      bulletMint,
      recipient.publicKey,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    let failed = false;
    try {
      await transferCheckedWithTransferHook(
        connection,
        wallet.payer,
        userBullet,
        bulletMint,
        recipientBullet,
        wallet.publicKey,
        1n * BigInt(ONE),
        6,
        [],
        { commitment: "confirmed" },
        TOKEN_2022_PROGRAM_ID
      );
    } catch {
      failed = true;
    }
    assert.isTrue(failed, "wallet transfer should be rejected by hook");
  });

  it("allows DEX pool transfer with 8% tax", async () => {
    const dexPool = Keypair.generate();
    const dexPoolBullet = getAssociatedTokenAddressSync(
      bulletMint,
      dexPool.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );
    await createAssociatedTokenAccount(
      connection,
      wallet.payer,
      bulletMint,
      dexPool.publicKey,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    const regSig = await hook.methods
      .registerDexPool()
      .accountsPartial({
        authority: wallet.publicKey,
        mint: bulletMint,
        hookConfig,
        poolTokenAccount: dexPoolBullet,
      })
      .rpc();
    await connection.confirmTransaction(regSig, "confirmed");

    const cfg = await hook.account.hookConfig.fetch(hookConfig);
    assert.isTrue(
      cfg.dexPools.slice(0, cfg.dexPoolCount).some((k) => k.equals(dexPoolBullet)),
      "DEX pool should be registered in hook config"
    );

    const sender = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      bulletMint,
      wallet.publicKey,
      false,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    assert.isTrue(sender.amount >= 100n * BigInt(ONE), "sender needs BULLET");

    const amount = 100n * BigInt(ONE);
    const poolBefore = await bal(connection, dexPoolBullet, TOKEN_2022_PROGRAM_ID, 8, true);
    const fee = (amount * BigInt(DEX_TAX_BPS)) / 10000n;

    // Build ix explicitly so we can assert the resolved hook_config matches registration.
    const ix = await createTransferCheckedWithFeeAndTransferHookInstruction(
      connection,
      sender.address,
      bulletMint,
      dexPoolBullet,
      wallet.publicKey,
      amount,
      6,
      fee,
      [],
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );
    assert.isTrue(
      ix.keys.some((k) => k.pubkey.equals(hookConfig)),
      `transfer ix must include hook_config ${hookConfig.toBase58()}`
    );

    const tx = new Transaction().add(ix);
    await sendAndConfirmTransaction(connection, tx, [wallet.payer], {
      commitment: "confirmed",
    });

    const poolAfter = await waitBal(
      connection,
      dexPoolBullet,
      (n) => n - poolBefore === amount - fee
    );
    const received = poolAfter - poolBefore;
    assert.equal(received, amount - fee);
  });
});
