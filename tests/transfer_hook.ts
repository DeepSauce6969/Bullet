import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccount,
  createTransferCheckedWithTransferHookInstruction,
  getAssociatedTokenAddressSync,
  getMintLen,
  getTransferHook,
  harvestWithheldTokensToMint,
  ExtensionType,
  createInitializeTransferFeeConfigInstruction,
  createInitializeTransferHookInstruction,
  createInitializeMintInstruction,
  createMintToInstruction,
  createAccount,
  getOrCreateAssociatedTokenAccount,
  transferCheckedWithTransferHook,
  transferCheckedWithFeeAndTransferHook,
} from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { assert } from "chai";
import type { Bullet } from "../target/types/bullet";
import type { BulletTransferHook } from "../target/types/bullet_transfer_hook";

const HOOK_PROGRAM_ID = new PublicKey(
  "DYEKb6VJpHqjGKNhoDyG1uijqFbdgn69yb8N3R4jAhzp"
);
const ONE = 1_000_000;
const DEX_TAX_BPS = 800; // 8%

async function bal(
  connection: anchor.web3.Connection,
  ata: PublicKey,
  tokenProgram: PublicKey = TOKEN_2022_PROGRAM_ID
): Promise<bigint> {
  const { getAccount } = await import("@solana/spl-token");
  const acc = await getAccount(connection, ata, "confirmed", tokenProgram).catch(() => null);
  return acc ? acc.amount : 0n;
}

describe("bullet transfer hook (DEX tax)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const bullet = anchor.workspace.Bullet as Program<Bullet>;
  const hook = anchor.workspace.BulletTransferHook as Program<BulletTransferHook>;
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

    const bulletBal = await bal(connection, userBullet);
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

    await hook.methods
      .registerDexPool()
      .accountsPartial({
        authority: wallet.publicKey,
        mint: bulletMint,
        hookConfig,
        poolTokenAccount: dexPoolBullet,
      })
      .rpc();

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
    const poolBefore = await bal(connection, dexPoolBullet);
    const fee = (amount * BigInt(DEX_TAX_BPS)) / 10000n;

    await transferCheckedWithFeeAndTransferHook(
      connection,
      wallet.payer,
      sender.address,
      bulletMint,
      dexPoolBullet,
      wallet.payer,
      amount,
      6,
      fee,
      [],
      { commitment: "confirmed" },
      TOKEN_2022_PROGRAM_ID
    );

    const poolAfter = await bal(connection, dexPoolBullet);
    const received = poolAfter - poolBefore;
    assert.equal(received, amount - fee);
  });
});
