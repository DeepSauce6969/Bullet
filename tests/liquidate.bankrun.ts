/**
 * Liquidation happy-path test.
 *
 * `solana-test-validator` can't fast-forward its clock, so this suite runs the
 * program inside solana-bankrun (an in-process SVM) where we can warp the
 * `Clock` sysvar past a loan's expiry and exercise `liquidate` end-to-end.
 *
 * A minimal Anchor provider is inlined here on purpose: the published
 * `anchor-bankrun` wrapper pins `@coral-xyz/anchor@^0.30`, which conflicts with
 * this repo's 0.31.1 and would break `npm install`.
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createInitializeMint2Instruction,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { startAnchor, Clock, ProgramTestContext } from "solana-bankrun";
import { assert } from "chai";
import type { Bullet } from "../target/types/bullet";
import idl from "../target/idl/bullet.json";

// --- minimal bankrun-backed Anchor provider ---

class BankrunConnectionProxy {
  constructor(private banksClient: any) {}
  async getAccountInfoAndContext(pk: PublicKey) {
    const acc = await this.banksClient.getAccount(pk);
    if (!acc) throw new Error(`Could not find ${pk.toBase58()}`);
    return {
      context: { slot: Number(await this.banksClient.getSlot()) },
      value: { ...acc, data: Buffer.from(acc.data) },
    };
  }
  async getAccountInfo(pk: PublicKey) {
    const acc = await this.banksClient.getAccount(pk);
    if (!acc) throw new Error(`Could not find ${pk.toBase58()}`);
    return { ...acc, data: Buffer.from(acc.data) };
  }
  async getMinimumBalanceForRentExemption(len: number) {
    const rent = await this.banksClient.getRent();
    return Number(rent.minimumBalance(BigInt(len)));
  }
}

class BankrunProvider {
  connection: any;
  wallet: anchor.Wallet;
  publicKey: PublicKey;
  constructor(public context: ProgramTestContext) {
    this.wallet = new anchor.Wallet(context.payer);
    this.connection = new BankrunConnectionProxy(context.banksClient);
    this.publicKey = this.wallet.publicKey;
  }
  async sendAndConfirm(tx: Transaction, signers?: Keypair[]) {
    tx.feePayer = tx.feePayer ?? this.wallet.publicKey;
    tx.recentBlockhash = (await this.context.banksClient.getLatestBlockhash())![0];
    signers?.forEach((s) => tx.partialSign(s));
    await this.wallet.signTransaction(tx);
    await this.context.banksClient.processTransaction(tx);
    return "ok";
  }
}

describe("bullet liquidation (bankrun clock warp)", () => {
  const ONE = 1_000_000;

  it("liquidates an expired loan: burns collateral, drops supply, floor up-only", async () => {
    const context = await startAnchor(".", [], []);
    const provider = new BankrunProvider(context);
    const program = new Program<Bullet>(idl as any, provider as any);
    const banks = context.banksClient;
    const payer = context.payer;

    const pda = (seeds: (Buffer | Uint8Array)[]) =>
      PublicKey.findProgramAddressSync(seeds, program.programId)[0];

    async function sendRaw(ixs: TransactionInstruction[], extra: Keypair[] = []) {
      const tx = new Transaction();
      tx.feePayer = payer.publicKey;
      tx.recentBlockhash = (await banks.getLatestBlockhash())![0];
      tx.add(...ixs);
      tx.sign(payer, ...extra);
      await banks.processTransaction(tx);
    }

    async function tokenAmount(ata: PublicKey): Promise<bigint> {
      const acc = await banks.getAccount(ata);
      if (!acc) return 0n;
      // SPL token account: amount is u64 LE at offset 64.
      return Buffer.from(acc.data).readBigUInt64LE(64);
    }

    // 1. Create the mock ANSEM mint (payer = mint authority).
    const ansemKp = Keypair.generate();
    const rent = await banks.getRent();
    const mintLamports = Number(rent.minimumBalance(BigInt(MINT_SIZE)));
    await sendRaw(
      [
        SystemProgram.createAccount({
          fromPubkey: payer.publicKey,
          newAccountPubkey: ansemKp.publicKey,
          space: MINT_SIZE,
          lamports: mintLamports,
          programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeMint2Instruction(ansemKp.publicKey, 6, payer.publicKey, null),
      ],
      [ansemKp]
    );
    const ansemMint = ansemKp.publicKey;

    // 2. Fund payer with ANSEM.
    const userAnsem = getAssociatedTokenAddressSync(ansemMint, payer.publicKey);
    await sendRaw([
      createAssociatedTokenAccountInstruction(payer.publicKey, userAnsem, payer.publicKey, ansemMint),
      createMintToInstruction(ansemMint, userAnsem, payer.publicKey, BigInt(1_000) * BigInt(ONE)),
    ]);

    // 3. Derive protocol PDAs.
    const protocolPda = pda([Buffer.from("protocol")]);
    const bulletMint = pda([Buffer.from("bullet_mint")]);
    const vault = pda([Buffer.from("vault")]);
    const polVault = pda([Buffer.from("pol_vault")]);
    const collateralVault = pda([Buffer.from("collateral_vault")]);

    const feeRecipient = Keypair.generate();
    const feeRecipientAta = getAssociatedTokenAddressSync(ansemMint, feeRecipient.publicKey);
    await sendRaw([
      createAssociatedTokenAccountInstruction(
        payer.publicKey,
        feeRecipientAta,
        feeRecipient.publicKey,
        ansemMint
      ),
    ]);

    const userBullet = getAssociatedTokenAddressSync(bulletMint, payer.publicKey);

    // 4. initialize
    await program.methods
      .initialize(new anchor.BN(2_500 * ONE), feeRecipient.publicKey)
      .accountsPartial({
        authority: payer.publicKey,
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

    // 5. mint BULLET (supply + collateral for the borrow)
    await program.methods
      .mintBullet(new anchor.BN(200 * ONE))
      .accountsPartial({
        user: payer.publicKey,
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

    // 6. borrow 10 ANSEM for 1 day (min duration).
    const protoBeforeBorrow = await program.account.protocol.fetch(protocolPda);
    const loanPda = pda([
      Buffer.from("loan"),
      protocolPda.toBuffer(),
      payer.publicKey.toBuffer(),
      protoBeforeBorrow.loanCount.toArrayLike(Buffer, "le", 8),
    ]);
    await program.methods
      .borrow(new anchor.BN(10 * ONE), 1)
      .accountsPartial({
        user: payer.publicKey,
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
    const collateral = BigInt(loan.collateralBullet.toString());
    assert.isTrue(collateral > 0n, "loan locked collateral");
    assert.equal((await tokenAmount(collateralVault)).toString(), collateral.toString());

    const protoBeforeLiq = await program.account.protocol.fetch(protocolPda);
    const supplyBefore = BigInt(protoBeforeLiq.totalSupply.toString());
    const borrowedBefore = BigInt(protoBeforeLiq.totalBorrowed.toString());
    const vaultBefore = await tokenAmount(vault);
    const floorBefore =
      supplyBefore === 0n ? 1_000_000n : ((vaultBefore + borrowedBefore) * 1_000_000n) / supplyBefore;

    // 7. Warp the clock 2 days past loan expiry.
    const clock = await banks.getClock();
    const warpedTs = BigInt(loan.endTs.toString()) + BigInt(2 * 86_400);
    context.setClock(
      new Clock(
        clock.slot,
        clock.epochStartTimestamp,
        clock.epoch,
        clock.leaderScheduleEpoch,
        warpedTs
      )
    );

    // 8. liquidate
    await program.methods
      .liquidate()
      .accountsPartial({
        liquidator: payer.publicKey,
        protocol: protocolPda,
        bulletMint,
        vault,
        collateralVault,
        loan: loanPda,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    // Collateral burned, supply reduced by exactly the collateral, backing kept.
    const protoAfter = await program.account.protocol.fetch(protocolPda);
    const supplyAfter = BigInt(protoAfter.totalSupply.toString());
    const borrowedAfter = BigInt(protoAfter.totalBorrowed.toString());
    const vaultAfter = await tokenAmount(vault);

    assert.equal((supplyBefore - supplyAfter).toString(), collateral.toString(), "supply -= collateral");
    assert.equal(borrowedAfter.toString(), borrowedBefore.toString(), "borrowed ANSEM kept in backing");
    assert.equal((await tokenAmount(collateralVault)).toString(), "0", "collateral vault emptied");

    const floorAfter =
      supplyAfter === 0n ? 1_000_000n : ((vaultAfter + borrowedAfter) * 1_000_000n) / supplyAfter;
    assert.isTrue(floorAfter >= floorBefore, "floor must not decrease on liquidation");

    // Loan account closed.
    let closed = false;
    try {
      await program.account.loan.fetch(loanPda);
    } catch {
      closed = true;
    }
    assert.isTrue(closed, "loan account closed after liquidation");
  });
});
