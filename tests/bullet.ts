import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccount,
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  mintTo,
} from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { assert } from "chai";
import type { Bullet } from "../target/types/bullet";

/** Reference only — localnet uses a mock mint. */
export const ANSEM_MAINNET = "9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump";

describe("bullet", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Bullet as Program<Bullet>;
  const wallet = provider.wallet as anchor.Wallet;

  let ansemMint: PublicKey;
  let feeRecipient: Keypair;
  let feeRecipientAta: PublicKey;
  let protocolPda: PublicKey;
  let bulletMint: PublicKey;
  let vault: PublicKey;
  let polVault: PublicKey;
  let collateralVault: PublicKey;
  let userAnsem: PublicKey;
  let userBullet: PublicKey;

  const maxSupply = new anchor.BN(2_500_000_000);

  before(async () => {
    ansemMint = await createMint(
      provider.connection,
      wallet.payer,
      wallet.publicKey,
      null,
      6
    );

    feeRecipient = Keypair.generate();
    feeRecipientAta = await createAssociatedTokenAccount(
      provider.connection,
      wallet.payer,
      ansemMint,
      feeRecipient.publicKey
    );

    [protocolPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("protocol")],
      program.programId
    );
    [bulletMint] = PublicKey.findProgramAddressSync(
      [Buffer.from("bullet_mint")],
      program.programId
    );
    [vault] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault")],
      program.programId
    );
    [polVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("pol_vault")],
      program.programId
    );
    [collateralVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("collateral_vault")],
      program.programId
    );

    userAnsem = await createAssociatedTokenAccount(
      provider.connection,
      wallet.payer,
      ansemMint,
      wallet.publicKey
    );

    await mintTo(
      provider.connection,
      wallet.payer,
      ansemMint,
      userAnsem,
      wallet.payer,
      BigInt(1_000_000_000_000)
    );

    userBullet = getAssociatedTokenAddressSync(bulletMint, wallet.publicKey);
  });

  it("initializes protocol", async () => {
    await program.methods
      .initialize(maxSupply, feeRecipient.publicKey)
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
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .rpc();

    const proto = await program.account.protocol.fetch(protocolPda);
    assert.equal(proto.maxSupply.toString(), maxSupply.toString());
    assert.equal(proto.ansemMint.toBase58(), ansemMint.toBase58());
    assert.isTrue(proto.tradingEnabled);
  });

  it("mints BULLET against backing", async () => {
    const deposit = new anchor.BN(1_000_000_000);

    await program.methods
      .mintBullet(deposit)
      .accountsPartial({
        user: wallet.publicKey,
        protocol: protocolPda,
        bulletMint,
        ansemMint,
        vault,
        polVault,
        feeRecipient: feeRecipient.publicKey,
        feeRecipientAta,
        userAnsem,
        userBullet,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const proto = await program.account.protocol.fetch(protocolPda);
    assert.isTrue(proto.totalSupply.gt(new anchor.BN(0)));

    const bulletBal = await getAccount(provider.connection, userBullet);
    assert.isTrue(Number(bulletBal.amount) > 0);
  });

  it("borrows against BULLET collateral", async () => {
    const protoBefore = await program.account.protocol.fetch(protocolPda);
    const [loanPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("loan"),
        protocolPda.toBuffer(),
        wallet.publicKey.toBuffer(),
        protoBefore.loanCount.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

    const borrowAmt = new anchor.BN(10_000_000);
    await program.methods
      .borrow(borrowAmt, 30)
      .accountsPartial({
        user: wallet.publicKey,
        protocol: protocolPda,
        bulletMint,
        ansemMint,
        vault,
        polVault,
        collateralVault,
        feeRecipient: feeRecipient.publicKey,
        feeRecipientAta,
        userBullet,
        userAnsem,
        loan: loanPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const loan = await program.account.loan.fetch(loanPda);
    assert.isTrue(loan.active);
    assert.equal(loan.borrowedAnsem.toString(), borrowAmt.toString());
  });
});
