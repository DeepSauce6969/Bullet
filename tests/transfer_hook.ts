import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccount,
  createAssociatedTokenAccountIdempotent,
  createMint,
  getAssociatedTokenAddressSync,
  getAccount,
  getMint,
  mintTo,
  transferChecked,
} from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { assert } from "chai";
import type { Bullet } from "../target/types/bullet";

const ONE = 1_000_000;

async function waitForProgram(
  connection: anchor.web3.Connection,
  pid: PublicKey,
  tries = 60
): Promise<void> {
  for (let i = 0; i < tries; i++) {
    const info = await connection.getAccountInfo(pid).catch(() => null);
    if (info?.executable) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`program ${pid.toBase58()} not loaded`);
}

async function bal(
  connection: anchor.web3.Connection,
  ata: PublicKey
): Promise<bigint> {
  const resp = await connection.getTokenAccountBalance(ata, "confirmed").catch(() => null);
  return resp ? BigInt(resp.value.amount) : 0n;
}

async function withRetry<T>(fn: () => Promise<T>, label: string, tries = 8): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw last instanceof Error ? last : new Error(`${label} failed after ${tries} tries`);
}

describe("bullet Token-2022 transfers", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const bullet = anchor.workspace.Bullet as Program<Bullet>;
  const connection = provider.connection;
  const wallet = provider.wallet as anchor.Wallet;

  const pda = (seeds: (Buffer | Uint8Array)[]) =>
    PublicKey.findProgramAddressSync(seeds, bullet.programId)[0];

  let ansemMint: PublicKey;
  let feeRecipient: Keypair;
  let protocolPda: PublicKey;
  let bulletMint: PublicKey;
  let vault: PublicKey;
  let polVault: PublicKey;
  let collateralVault: PublicKey;
  let userAnsem: PublicKey;
  let userBullet: PublicKey;

  before(async () => {
    await waitForProgram(connection, TOKEN_PROGRAM_ID);
    await waitForProgram(connection, TOKEN_2022_PROGRAM_ID);
    await waitForProgram(connection, ASSOCIATED_TOKEN_PROGRAM_ID);

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

    protocolPda = pda([Buffer.from("protocol")]);
    bulletMint = pda([Buffer.from("bullet_mint")]);
    vault = pda([Buffer.from("vault")]);
    polVault = pda([Buffer.from("pol_vault")]);
    collateralVault = pda([Buffer.from("collateral_vault")]);

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

  it("initializes protocol and mints BULLET", async () => {
    const existing = await connection.getAccountInfo(protocolPda);
    if (!existing) {
      await bullet.methods
        .initialize(new anchor.BN(2_500 * ONE), feeRecipient.publicKey)
        .accountsPartial({
          authority: wallet.publicKey,
          protocol: protocolPda,
          bulletMint,
          ansemMint,
          vault,
          polVault,
          collateralVault,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          token2022Program: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .rpc();
    }

    const bulletAta = getAssociatedTokenAddressSync(
      bulletMint,
      wallet.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );
    const bulletBal = await bal(connection, bulletAta);
    if (bulletBal === 0n) {
      await createAssociatedTokenAccountIdempotent(
        connection,
        wallet.payer,
        bulletMint,
        wallet.publicKey,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
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
          userBullet: bulletAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          bulletTokenProgram: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    }

    assert.isTrue((await bal(connection, bulletAta)) > 0n);
  });

  it("allows free wallet-to-wallet transfer (no transfer fee)", async () => {
    const recipient = Keypair.generate();
    const senderAta = getAssociatedTokenAddressSync(
      bulletMint,
      wallet.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );
    const recipientAta = getAssociatedTokenAddressSync(
      bulletMint,
      recipient.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );

    await createAssociatedTokenAccountIdempotent(
      connection,
      wallet.payer,
      bulletMint,
      recipient.publicKey,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    const mintInfo = await getMint(connection, bulletMint, "confirmed", TOKEN_2022_PROGRAM_ID);
    assert.equal(mintInfo.decimals, 6);

    const amount = 100n * BigInt(ONE);
    await withRetry(async () => {
      await getAccount(connection, senderAta, "confirmed", TOKEN_2022_PROGRAM_ID);
      await getAccount(connection, recipientAta, "confirmed", TOKEN_2022_PROGRAM_ID);
      const senderBefore = await bal(connection, senderAta);
      if (senderBefore < amount) throw new Error("sender balance not ready");
      return senderBefore;
    }, "warm token accounts");

    const senderBefore = await bal(connection, senderAta);
    const recipientBefore = await bal(connection, recipientAta);

    await withRetry(
      () =>
        transferChecked(
          connection,
          wallet.payer,
          senderAta,
          bulletMint,
          recipientAta,
          wallet.payer,
          amount,
          6,
          [],
          { commitment: "confirmed" },
          TOKEN_2022_PROGRAM_ID
        ),
      "wallet-to-wallet transfer"
    );

    const received = (await bal(connection, recipientAta)) - recipientBefore;
    assert.equal(received, amount);
    assert.equal((await bal(connection, senderAta)) + amount, senderBefore);
  });
});
