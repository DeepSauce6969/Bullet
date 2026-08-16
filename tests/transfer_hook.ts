import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccount,
  createMint,
  getAssociatedTokenAddressSync,
  getMint,
  getTransferFeeConfig,
  calculateEpochFee,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  transferChecked,
  transferCheckedWithFee,
} from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { assert } from "chai";
import type { Bullet } from "../target/types/bullet";

const ONE = 1_000_000;
const TRANSFER_TAX_BPS = 500; // 5%

async function bal(
  connection: anchor.web3.Connection,
  ata: PublicKey
): Promise<bigint> {
  const resp = await connection.getTokenAccountBalance(ata, "confirmed").catch(() => null);
  return resp ? BigInt(resp.value.amount) : 0n;
}

describe("bullet transfer fee (Token-2022)", () => {
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
      await createAssociatedTokenAccount(
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

  it("allows wallet-to-wallet transfer with 5% fee", async () => {
    const recipient = Keypair.generate();
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
    const recipientAta = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      bulletMint,
      recipient.publicKey,
      false,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    const amount = 100n * BigInt(ONE);
    const recipientBefore = await bal(connection, recipientAta.address);
    assert.isTrue(sender.amount >= amount, "sender needs BULLET balance");

    const mintInfo = await getMint(connection, bulletMint, "confirmed", TOKEN_2022_PROGRAM_ID);
    const feeConfig = getTransferFeeConfig(mintInfo)!;
    const epoch = BigInt((await connection.getEpochInfo()).epoch);
    const fee = calculateEpochFee(feeConfig, epoch, amount);

    // Prefer TransferCheckedWithFee; fall back to TransferChecked on older validators.
    try {
      await transferCheckedWithFee(
        connection,
        wallet.payer,
        sender.address,
        bulletMint,
        recipientAta.address,
        wallet.payer,
        amount,
        6,
        fee,
        [],
        { commitment: "confirmed" },
        TOKEN_2022_PROGRAM_ID
      );
    } catch {
      await transferChecked(
        connection,
        wallet.payer,
        sender.address,
        bulletMint,
        recipientAta.address,
        wallet.payer,
        amount,
        6,
        [],
        { commitment: "confirmed" },
        TOKEN_2022_PROGRAM_ID
      );
    }

    const received = (await bal(connection, recipientAta.address)) - recipientBefore;
    const expected = (amount * BigInt(10_000 - TRANSFER_TAX_BPS)) / 10_000n;
    assert.equal(received, expected);
  });
});
