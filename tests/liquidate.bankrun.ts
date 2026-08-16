/**
 * Loan liquidation happy-path tests (borrow + leverage).
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
  TOKEN_2022_PROGRAM_ID,
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
import type { BulletTransferHook } from "../target/types/bullet_transfer_hook";
import idl from "../target/idl/bullet.json";
import hookIdl from "../target/idl/bullet_transfer_hook.json";

const HOOK_PROGRAM_ID = new PublicKey(
  "DYEKb6VJpHqjGKNhoDyG1uijqFbdgn69yb8N3R4jAhzp"
);

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

const ONE = 1_000_000;

describe("bullet loan liquidation (bankrun clock warp)", () => {
  /** Boots a fresh SVM, initializes the protocol and mints BULLET to the payer. */
  async function setup() {
    const context = await startAnchor(".", [], []);
    const provider = new BankrunProvider(context);
    const program = new Program<Bullet>(idl as any, provider as any);
    const hookProgram = new Program<BulletTransferHook>(hookIdl as any, provider as any);
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
      return Buffer.from(acc.data).readBigUInt64LE(64); // SPL amount @ offset 64
    }

    // Mock ANSEM mint (payer = authority) + fund the payer.
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

    const userAnsem = getAssociatedTokenAddressSync(ansemMint, payer.publicKey);
    await sendRaw([
      createAssociatedTokenAccountInstruction(payer.publicKey, userAnsem, payer.publicKey, ansemMint),
      createMintToInstruction(ansemMint, userAnsem, payer.publicKey, BigInt(1_000) * BigInt(ONE)),
    ]);

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

    const userBullet = getAssociatedTokenAddressSync(
      bulletMint,
      payer.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );

    const hookConfig = PublicKey.findProgramAddressSync(
      [Buffer.from("hook_config"), bulletMint.toBuffer()],
      HOOK_PROGRAM_ID
    )[0];
    const extraAccountMetaList = PublicKey.findProgramAddressSync(
      [Buffer.from("extra-account-metas"), bulletMint.toBuffer()],
      HOOK_PROGRAM_ID
    )[0];

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
        transferHookProgram: HOOK_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        token2022Program: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .rpc();

    await hookProgram.methods
      .initializeConfig(500)
      .accountsPartial({
        authority: payer.publicKey,
        mint: bulletMint,
        hookConfig,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    await hookProgram.methods
      .initializeExtraAccountMetaList()
      .accountsPartial({
        payer: payer.publicKey,
        mint: bulletMint,
        extraAccountMetaList,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    await hookProgram.methods
      .registerExemptAccount()
      .accountsPartial({
        authority: payer.publicKey,
        mint: bulletMint,
        hookConfig,
        tokenAccount: collateralVault,
      })
      .rpc();

    // Seed supply + user collateral.
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
        bulletTokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const loanPda = (index: anchor.BN) =>
      pda([
        Buffer.from("loan"),
        protocolPda.toBuffer(),
        payer.publicKey.toBuffer(),
        index.toArrayLike(Buffer, "le", 8),
      ]);

    async function floorState() {
      const proto = await program.account.protocol.fetch(protocolPda);
      const supply = BigInt(proto.totalSupply.toString());
      const borrowed = BigInt(proto.totalBorrowed.toString());
      const vaultBal = await tokenAmount(vault);
      const floor = supply === 0n ? 1_000_000n : ((vaultBal + borrowed) * 1_000_000n) / supply;
      return { proto, supply, borrowed, vaultBal, floor };
    }

    async function warpPast(endTs: anchor.BN) {
      const clock = await banks.getClock();
      context.setClock(
        new Clock(
          clock.slot,
          clock.epochStartTimestamp,
          clock.epoch,
          clock.leaderScheduleEpoch,
          BigInt(endTs.toString()) + BigInt(2 * 86_400)
        )
      );
    }

    async function liquidate(loan: PublicKey) {
      await program.methods
        .liquidate()
        .accountsPartial({
          liquidator: payer.publicKey,
          protocol: protocolPda,
          bulletMint,
          vault,
          collateralVault,
          loan,
          tokenProgram: TOKEN_PROGRAM_ID,
          bulletTokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .rpc();
    }

    async function loanClosed(loan: PublicKey) {
      try {
        await program.account.loan.fetch(loan);
        return false;
      } catch {
        return true;
      }
    }

    return {
      context,
      program,
      pda,
      protocolPda,
      bulletMint,
      ansemMint,
      vault,
      polVault,
      collateralVault,
      feeRecipient,
      feeRecipientAta,
      userAnsem,
      userBullet,
      loanPda,
      tokenAmount,
      floorState,
      warpPast,
      liquidate,
      loanClosed,
    };
  }

  it("liquidates an expired BORROW loan: burns collateral, drops supply, floor up-only", async () => {
    const s = await setup();
    const protoBeforeBorrow = await s.program.account.protocol.fetch(s.protocolPda);
    const loan = s.loanPda(protoBeforeBorrow.loanCount);

    await s.program.methods
      .borrow(new anchor.BN(10 * ONE), 1)
      .accountsPartial({
        user: s.context.payer.publicKey,
        protocol: s.protocolPda,
        bulletMint: s.bulletMint,
        ansemMint: s.ansemMint,
        vault: s.vault,
        polVault: s.polVault,
        collateralVault: s.collateralVault,
        feeRecipient: s.feeRecipient.publicKey,
        feeRecipientAta: s.feeRecipientAta,
        userBullet: s.userBullet,
        userAnsem: s.userAnsem,
        loan,
        tokenProgram: TOKEN_PROGRAM_ID,
        bulletTokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const loanAcc = await s.program.account.loan.fetch(loan);
    const collateral = BigInt(loanAcc.collateralBullet.toString());
    const before = await s.floorState();

    await s.warpPast(loanAcc.endTs);
    await s.liquidate(loan);

    const after = await s.floorState();
    assert.equal((before.supply - after.supply).toString(), collateral.toString(), "supply -= collateral");
    assert.equal(after.borrowed.toString(), before.borrowed.toString(), "borrowed ANSEM kept in backing");
    assert.equal((await s.tokenAmount(s.collateralVault)).toString(), "0", "collateral vault emptied");
    assert.isTrue(after.floor >= before.floor, "floor must not decrease on liquidation");
    assert.isTrue(await s.loanClosed(loan), "loan account closed");
  });

  it("liquidates an expired LEVERAGE loan: burns minted collateral, keeps debt in backing, floor up-only", async () => {
    const s = await setup();
    const protoBeforeLev = await s.program.account.protocol.fetch(s.protocolPda);
    const loan = s.loanPda(protoBeforeLev.loanCount);

    await s.program.methods
      .leverage(new anchor.BN(20 * ONE), 1)
      .accountsPartial({
        user: s.context.payer.publicKey,
        protocol: s.protocolPda,
        bulletMint: s.bulletMint,
        ansemMint: s.ansemMint,
        vault: s.vault,
        polVault: s.polVault,
        collateralVault: s.collateralVault,
        feeRecipient: s.feeRecipient.publicKey,
        feeRecipientAta: s.feeRecipientAta,
        userAnsem: s.userAnsem,
        userBullet: s.userBullet,
        loan,
        tokenProgram: TOKEN_PROGRAM_ID,
        bulletTokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const loanAcc = await s.program.account.loan.fetch(loan);
    const collateral = BigInt(loanAcc.collateralBullet.toString());
    assert.isTrue(collateral > 0n, "leverage minted collateral");
    const before = await s.floorState();

    await s.warpPast(loanAcc.endTs);
    await s.liquidate(loan);

    const after = await s.floorState();
    assert.equal((before.supply - after.supply).toString(), collateral.toString(), "supply -= minted collateral");
    assert.equal(after.borrowed.toString(), before.borrowed.toString(), "leverage debt kept in backing");
    assert.isTrue(after.floor >= before.floor, "floor must not decrease on leverage liquidation");
    assert.isTrue(await s.loanClosed(loan), "loan account closed");
  });

  it("rejects repay on an expired loan (LoanExpired)", async () => {
    const s = await setup();
    const protoBeforeBorrow = await s.program.account.protocol.fetch(s.protocolPda);
    const loan = s.loanPda(protoBeforeBorrow.loanCount);

    await s.program.methods
      .borrow(new anchor.BN(5 * ONE), 1)
      .accountsPartial({
        user: s.context.payer.publicKey,
        protocol: s.protocolPda,
        bulletMint: s.bulletMint,
        ansemMint: s.ansemMint,
        vault: s.vault,
        polVault: s.polVault,
        collateralVault: s.collateralVault,
        feeRecipient: s.feeRecipient.publicKey,
        feeRecipientAta: s.feeRecipientAta,
        userAnsem: s.userAnsem,
        userBullet: s.userBullet,
        loan,
        tokenProgram: TOKEN_PROGRAM_ID,
        bulletTokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const loanAcc = await s.program.account.loan.fetch(loan);
    await s.warpPast(loanAcc.endTs);

    let threw = false;
    try {
      await s.program.methods
        .repay()
        .accountsPartial({
          user: s.context.payer.publicKey,
          protocol: s.protocolPda,
          bulletMint: s.bulletMint,
          ansemMint: s.ansemMint,
          vault: s.vault,
          collateralVault: s.collateralVault,
          userAnsem: s.userAnsem,
          userBullet: s.userBullet,
          loan,
          tokenProgram: TOKEN_PROGRAM_ID,
          bulletTokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .rpc();
    } catch (e: unknown) {
      threw = true;
      const err = e as { error?: { errorCode?: { code?: string } }; errorCode?: { code?: string } };
      const got = err?.error?.errorCode?.code ?? err?.errorCode?.code;
      if (got) {
        assert.equal(got, "LoanExpired", `expected LoanExpired, got ${got}`);
      } else {
        const msg = String(e);
        assert.isTrue(
          msg.includes("LoanExpired") || msg.includes("Loan already expired"),
          `expected LoanExpired in ${msg}`
        );
      }
    }
    assert.isTrue(threw, "expected repay to throw LoanExpired");
  });
});
