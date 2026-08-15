import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccount,
  getAssociatedTokenAddressSync,
  createMint,
  getAccount,
  mintTo,
} from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import { assert } from "chai";
import type { Bullet } from "../target/types/bullet";

/** Reference only — localnet uses a mock mint. */
export const ANSEM_MAINNET = "9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump";

const ONE = 1_000_000; // 1 token (6 decimals)
const MAX_SUPPLY = new anchor.BN(2_500 * ONE);

// Mirror of on-chain constants (programs/bullet/src/state.rs).
const PROTOCOL_FEE_BPS = 250n;
const BPS_DENOM = 10_000n;
const FEE_POL_BPS = 1_500n;
const FEE_BRIBE_BPS = 1_500n;
const OUT_FEE_NUM = 975n;
const OUT_FEE_DEN = 1_000n;

/** Replicates math::floor_scaled: supply==0 → 1e6, else backing*1e6/supply. */
function floorScaled(vaultBal: bigint, totalBorrowed: bigint, supply: bigint): bigint {
  if (supply === 0n) return 1_000_000n;
  return ((vaultBal + totalBorrowed) * 1_000_000n) / supply;
}

async function bal(connection: anchor.web3.Connection, ata: PublicKey): Promise<bigint> {
  const acc = await getAccount(connection, ata).catch(() => null);
  return acc ? acc.amount : 0n;
}

/** Assert an Anchor instruction rejects with a specific error code. */
async function expectAnchorError(p: Promise<unknown>, code: string): Promise<void> {
  let threw = false;
  try {
    await p;
  } catch (e: any) {
    threw = true;
    const got = e?.error?.errorCode?.code ?? e?.errorCode?.code;
    if (got) {
      assert.equal(got, code, `expected error ${code}, got ${got}`);
    } else {
      assert.include(String(e), code, `expected error ${code} in ${String(e)}`);
    }
  }
  assert.isTrue(threw, `expected instruction to throw ${code}`);
}

/** Wait until a program account is loaded + executable on a freshly started validator. */
async function waitForProgram(
  connection: anchor.web3.Connection,
  pid: PublicKey,
  tries = 60
): Promise<void> {
  for (let i = 0; i < tries; i++) {
    const info = await connection.getAccountInfo(pid).catch(() => null);
    if (info?.executable) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`program ${pid.toBase58()} not loaded on the validator`);
}

/** Assert a promise rejects (any error). */
async function expectReject(p: Promise<unknown>, ctx: string): Promise<void> {
  let threw = false;
  try {
    await p;
  } catch {
    threw = true;
  }
  assert.isTrue(threw, `expected rejection: ${ctx}`);
}

describe("bullet protocol", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Bullet as Program<Bullet>;
  const connection = provider.connection;
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

  // Secondary actor for isolation / negative tests.
  const user2 = Keypair.generate();
  let user2Ansem: PublicKey;
  let user2Bullet: PublicKey;

  const pda = (seeds: (Buffer | Uint8Array)[]) =>
    PublicKey.findProgramAddressSync(seeds, program.programId)[0];

  const loanPda = (borrower: PublicKey, index: anchor.BN) =>
    pda([
      Buffer.from("loan"),
      protocolPda.toBuffer(),
      borrower.toBuffer(),
      index.toArrayLike(Buffer, "le", 8),
    ]);

  async function state() {
    const proto = await program.account.protocol.fetch(protocolPda);
    const vaultBal = await bal(connection, vault);
    const supply = BigInt(proto.totalSupply.toString());
    const borrowed = BigInt(proto.totalBorrowed.toString());
    return {
      proto,
      vaultBal,
      supply,
      borrowed,
      floor: floorScaled(vaultBal, borrowed, supply),
    };
  }

  before(async () => {
    // Fresh validators can accept RPC before the SPL programs finish loading.
    await waitForProgram(connection, TOKEN_PROGRAM_ID);
    await waitForProgram(connection, ASSOCIATED_TOKEN_PROGRAM_ID);

    ansemMint = await createMint(connection, wallet.payer, wallet.publicKey, null, 6);

    feeRecipient = Keypair.generate();
    feeRecipientAta = await createAssociatedTokenAccount(
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
    await mintTo(connection, wallet.payer, ansemMint, userAnsem, wallet.payer, BigInt(1_000_000) * BigInt(ONE));
    userBullet = getAssociatedTokenAddressSync(bulletMint, wallet.publicKey);

    // Fund user2 with SOL + ANSEM.
    const sig = await connection.requestAirdrop(user2.publicKey, 2 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig, "confirmed");
    user2Ansem = await createAssociatedTokenAccount(
      connection,
      wallet.payer,
      ansemMint,
      user2.publicKey
    );
    await mintTo(connection, wallet.payer, ansemMint, user2Ansem, wallet.payer, BigInt(5_000) * BigInt(ONE));
    user2Bullet = getAssociatedTokenAddressSync(bulletMint, user2.publicKey);
  });

  // ---- initialize ----

  it("initializes the protocol", async () => {
    await program.methods
      .initialize(MAX_SUPPLY, feeRecipient.publicKey)
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

    const { proto } = await state();
    assert.equal(proto.maxSupply.toString(), MAX_SUPPLY.toString());
    assert.equal(proto.ansemMint.toBase58(), ansemMint.toBase58());
    assert.equal(proto.feeRecipient.toBase58(), feeRecipient.publicKey.toBase58());
    assert.isTrue(proto.tradingEnabled);
    assert.equal(proto.totalSupply.toNumber(), 0);
    assert.equal(proto.totalMinted.toNumber(), 0);
    assert.equal(proto.totalBorrowed.toNumber(), 0);
  });

  it("rejects a second initialize (PDA already in use)", async () => {
    await expectReject(
      program.methods
        .initialize(MAX_SUPPLY, feeRecipient.publicKey)
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
        .rpc(),
      "re-initialize"
    );
  });

  // ---- mint ----

  async function mint(user: Keypair | anchor.Wallet, uAnsem: PublicKey, uBullet: PublicKey, amount: number) {
    const builder = program.methods
      .mintBullet(new anchor.BN(amount))
      .accountsPartial({
        user: user.publicKey,
        protocol: protocolPda,
        bulletMint,
        ansemMint,
        vault,
        polVault,
        feeRecipient: feeRecipient.publicKey,
        feeRecipientAta,
        userAnsem: uAnsem,
        userBullet: uBullet,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      });
    if (user instanceof Keypair) return builder.signers([user]).rpc();
    return builder.rpc();
  }

  it("mints BULLET 1:1 (minus 2.5% out-fee) on the first deposit and routes fees", async () => {
    const deposit = 100 * ONE;
    await mint(wallet, userAnsem, userBullet, deposit);

    // supply started at 0 → gross 1:1, user gets 97.5%.
    const expectedBullet = (BigInt(deposit) * OUT_FEE_NUM) / OUT_FEE_DEN;
    const fee = (BigInt(deposit) * PROTOCOL_FEE_BPS) / BPS_DENOM;
    const expectedPol = (fee * FEE_POL_BPS) / BPS_DENOM;
    const expectedBribe = (fee * FEE_BRIBE_BPS) / BPS_DENOM;
    const expectedVault = BigInt(deposit) - expectedPol - expectedBribe;

    assert.equal((await bal(connection, userBullet)).toString(), expectedBullet.toString());
    assert.equal((await bal(connection, polVault)).toString(), expectedPol.toString());
    assert.equal((await bal(connection, feeRecipientAta)).toString(), expectedBribe.toString());
    assert.equal((await bal(connection, vault)).toString(), expectedVault.toString());

    const { proto } = await state();
    assert.equal(proto.totalSupply.toString(), expectedBullet.toString());
    assert.equal(proto.totalMinted.toString(), expectedBullet.toString());
  });

  it("rejects a zero-amount mint", async () => {
    await expectAnchorError(mint(wallet, userAnsem, userBullet, 0), "ZeroAmount");
  });

  it("mints again on non-zero supply and keeps the floor up-only", async () => {
    const before = await state();
    const userBulletBefore = await bal(connection, userBullet);

    await mint(wallet, userAnsem, userBullet, 100 * ONE);

    const after = await state();
    assert.isTrue(
      (await bal(connection, userBullet)) > userBulletBefore,
      "user BULLET should increase"
    );
    assert.isTrue(after.supply > before.supply, "supply should increase");
    assert.isTrue(after.floor >= before.floor, "floor must not decrease on mint");
  });

  // ---- burn ----

  it("burns BULLET for ANSEM and keeps the floor up-only", async () => {
    const before = await state();
    const userAnsemBefore = await bal(connection, userAnsem);
    const burnAmt = 20 * ONE;

    await program.methods
      .burnBullet(new anchor.BN(burnAmt))
      .accountsPartial({
        user: wallet.publicKey,
        protocol: protocolPda,
        bulletMint,
        ansemMint,
        vault,
        polVault,
        feeRecipient: feeRecipient.publicKey,
        feeRecipientAta,
        userBullet,
        userAnsem,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const after = await state();
    assert.isTrue((await bal(connection, userAnsem)) > userAnsemBefore, "user should receive ANSEM");
    assert.equal((before.supply - after.supply).toString(), BigInt(burnAmt).toString());
    assert.isTrue(after.floor >= before.floor, "floor must not decrease on burn");
  });

  it("rejects a zero-amount burn", async () => {
    await expectAnchorError(
      program.methods
        .burnBullet(new anchor.BN(0))
        .accountsPartial({
          user: wallet.publicKey,
          protocol: protocolPda,
          bulletMint,
          ansemMint,
          vault,
          polVault,
          feeRecipient: feeRecipient.publicKey,
          feeRecipientAta,
          userBullet,
          userAnsem,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc(),
      "ZeroAmount"
    );
  });

  // ---- borrow / repay ----

  let borrowLoan: PublicKey;

  it("borrows ANSEM against BULLET collateral (~99% LTV)", async () => {
    const before = await state();
    const loanIndex = before.proto.loanCount;
    borrowLoan = loanPda(wallet.publicKey, loanIndex);

    const borrowAmt = 10 * ONE;
    await program.methods
      .borrow(new anchor.BN(borrowAmt), 30)
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
        loan: borrowLoan,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const loan = await program.account.loan.fetch(borrowLoan);
    assert.isTrue(loan.active);
    assert.equal(loan.borrowedAnsem.toString(), BigInt(borrowAmt).toString());
    assert.isTrue(loan.collateralBullet.toNumber() > 0);

    const after = await state();
    assert.equal((after.borrowed - before.borrowed).toString(), BigInt(borrowAmt).toString());
    assert.equal(after.proto.loanCount.toNumber(), before.proto.loanCount.toNumber() + 1);
    assert.equal(
      (await bal(connection, collateralVault)).toString(),
      loan.collateralBullet.toString()
    );
    assert.isTrue(after.floor >= before.floor, "floor must not decrease on borrow");
  });

  it("rejects a borrow with an out-of-range duration", async () => {
    const { proto } = await state();
    await expectAnchorError(
      program.methods
        .borrow(new anchor.BN(1 * ONE), 0)
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
          loan: loanPda(wallet.publicKey, proto.loanCount),
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc(),
      "InvalidLoanDuration"
    );
  });

  it("rejects a borrow with insufficient collateral (ExceedsLtv)", async () => {
    // user2 has ANSEM (for interest) but no BULLET collateral.
    // Give them an empty BULLET ATA so the account constraint passes and LTV check fires.
    await createAssociatedTokenAccount(connection, wallet.payer, bulletMint, user2.publicKey).catch(
      () => null
    );
    const { proto } = await state();
    await expectAnchorError(
      program.methods
        .borrow(new anchor.BN(1 * ONE), 30)
        .accountsPartial({
          user: user2.publicKey,
          protocol: protocolPda,
          bulletMint,
          ansemMint,
          vault,
          polVault,
          collateralVault,
          feeRecipient: feeRecipient.publicKey,
          feeRecipientAta,
          userBullet: user2Bullet,
          userAnsem: user2Ansem,
          loan: loanPda(user2.publicKey, proto.loanCount),
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([user2])
        .rpc(),
      "ExceedsLtv"
    );
  });

  it("repays the loan, returns collateral and closes the loan account", async () => {
    const before = await state();
    const loan = await program.account.loan.fetch(borrowLoan);
    const userBulletBefore = await bal(connection, userBullet);

    await program.methods
      .repay()
      .accountsPartial({
        user: wallet.publicKey,
        protocol: protocolPda,
        bulletMint,
        ansemMint,
        vault,
        collateralVault,
        userAnsem,
        userBullet,
        loan: borrowLoan,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const after = await state();
    assert.equal(
      (before.borrowed - after.borrowed).toString(),
      loan.borrowedAnsem.toString(),
      "total_borrowed decreases by principal"
    );
    assert.equal(
      ((await bal(connection, userBullet)) - userBulletBefore).toString(),
      loan.collateralBullet.toString(),
      "collateral returned to user"
    );
    await expectReject(program.account.loan.fetch(borrowLoan), "loan account closed");
    assert.isTrue(after.floor >= before.floor, "floor must not decrease on repay");
  });

  // ---- leverage ----

  let leverageLoan: PublicKey;

  it("opens a one-click leveraged position (mints collateral, records debt, pays no ANSEM out)", async () => {
    const before = await state();
    leverageLoan = loanPda(wallet.publicKey, before.proto.loanCount);
    const userAnsemBefore = await bal(connection, userAnsem);
    const collatBefore = await bal(connection, collateralVault);

    const notional = 20 * ONE;
    await program.methods
      .leverage(new anchor.BN(notional), 30)
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
        userAnsem,
        userBullet,
        loan: leverageLoan,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const loan = await program.account.loan.fetch(leverageLoan);
    assert.isTrue(loan.active);
    assert.isTrue(loan.collateralBullet.toNumber() > 0);
    assert.isTrue(loan.borrowedAnsem.toNumber() > 0);

    const after = await state();
    // Collateral BULLET is minted straight into the collateral vault.
    assert.equal(
      ((await bal(connection, collateralVault)) - collatBefore).toString(),
      loan.collateralBullet.toString()
    );
    assert.equal((after.supply - before.supply).toString(), loan.collateralBullet.toString());
    // Debt recorded in total_borrowed (internal credit, backs the mint).
    assert.equal((after.borrowed - before.borrowed).toString(), loan.borrowedAnsem.toString());
    // User pays ONLY the fees — its ANSEM balance strictly DECREASES (the borrowed
    // leg is not disbursed), and the spend is far below the notional.
    const spent = userAnsemBefore - (await bal(connection, userAnsem));
    assert.isTrue(spent > 0n, "user pays leverage fees");
    assert.isTrue(spent < BigInt(notional), "user pays only fees, not the notional");
    assert.isTrue(spent < BigInt(loan.borrowedAnsem.toString()), "user does NOT receive the borrowed ANSEM");
    // Floor must not decrease.
    assert.isTrue(after.floor >= before.floor, "floor must not decrease on leverage");
  });

  it("repays a leveraged position: pays the debt and reclaims the minted collateral", async () => {
    const before = await state();
    const loan = await program.account.loan.fetch(leverageLoan);
    const userBulletBefore = await bal(connection, userBullet);
    const userAnsemBefore = await bal(connection, userAnsem);

    await program.methods
      .repay()
      .accountsPartial({
        user: wallet.publicKey,
        protocol: protocolPda,
        bulletMint,
        ansemMint,
        vault,
        collateralVault,
        userAnsem,
        userBullet,
        loan: leverageLoan,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    assert.equal(
      (userAnsemBefore - (await bal(connection, userAnsem))).toString(),
      loan.borrowedAnsem.toString(),
      "user pays the borrowed principal"
    );
    assert.equal(
      ((await bal(connection, userBullet)) - userBulletBefore).toString(),
      loan.collateralBullet.toString(),
      "user reclaims the minted collateral"
    );
    const after = await state();
    assert.equal((before.borrowed - after.borrowed).toString(), loan.borrowedAnsem.toString());
    await expectReject(program.account.loan.fetch(leverageLoan), "leverage loan closed");
    assert.isTrue(after.floor >= before.floor, "floor must not decrease on repay");
  });

  it("rejects liquidating a loan that has not expired", async () => {
    // Open a fresh 30-day loan, then attempt to liquidate it immediately.
    const before = await state();
    const freshLoan = loanPda(wallet.publicKey, before.proto.loanCount);
    await program.methods
      .borrow(new anchor.BN(5 * ONE), 30)
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
        loan: freshLoan,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await expectAnchorError(
      program.methods
        .liquidate()
        .accountsPartial({
          liquidator: wallet.publicKey,
          protocol: protocolPda,
          bulletMint,
          vault,
          collateralVault,
          loan: freshLoan,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc(),
      "LoanNotExpired"
    );
  });

  // ---- admin ----

  it("rejects set_fee_recipient from a non-authority", async () => {
    await expectAnchorError(
      program.methods
        .setFeeRecipient(user2.publicKey)
        .accountsPartial({ authority: user2.publicKey, protocol: protocolPda })
        .signers([user2])
        .rpc(),
      "Unauthorized"
    );
  });

  it("lets the authority update the fee recipient", async () => {
    const newRecipient = Keypair.generate();
    await program.methods
      .setFeeRecipient(newRecipient.publicKey)
      .accountsPartial({ authority: wallet.publicKey, protocol: protocolPda })
      .rpc();
    const { proto } = await state();
    assert.equal(proto.feeRecipient.toBase58(), newRecipient.publicKey.toBase58());

    // Restore original so downstream genesis finalize (has_one fee_recipient) keeps working.
    await program.methods
      .setFeeRecipient(feeRecipient.publicKey)
      .accountsPartial({ authority: wallet.publicKey, protocol: protocolPda })
      .rpc();
    const restored = await state();
    assert.equal(restored.proto.feeRecipient.toBase58(), feeRecipient.publicKey.toBase58());
  });

  // ---- genesis vaults ----

  describe("genesis pre-deposit vaults", () => {
    const genesisVaultPda = (tier: number) => pda([Buffer.from("genesis_vault"), Buffer.from([tier])]);
    const genesisTokenPda = (tier: number) => pda([Buffer.from("genesis_ansem"), Buffer.from([tier])]);
    const genesisBulletPda = (tier: number) => pda([Buffer.from("genesis_bullet"), Buffer.from([tier])]);
    const userDepositPda = (gv: PublicKey, user: PublicKey) =>
      pda([Buffer.from("user_deposit"), gv.toBuffer(), user.toBuffer()]);

    const TIER0 = 0;

    async function initTier(tier: number, feeBps: number, cap: number, maxAlloc: number, authority = wallet) {
      const builder = program.methods
        .initGenesisVault(tier, feeBps, new anchor.BN(cap), new anchor.BN(maxAlloc))
        .accountsPartial({
          authority: authority.publicKey,
          protocol: protocolPda,
          ansemMint,
          bulletMint,
          genesisVault: genesisVaultPda(tier),
          tokenVault: genesisTokenPda(tier),
          bulletVault: genesisBulletPda(tier),
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        });
      if (authority instanceof Keypair) return builder.signers([authority]).rpc();
      return builder.rpc();
    }

    function depositTier(
      tier: number,
      user: Keypair | anchor.Wallet,
      uAnsem: PublicKey,
      amount: number
    ) {
      const gv = genesisVaultPda(tier);
      const builder = program.methods
        .depositGenesis(new anchor.BN(amount))
        .accountsPartial({
          user: user.publicKey,
          genesisVault: gv,
          tokenVault: genesisTokenPda(tier),
          userAnsem: uAnsem,
          userDeposit: userDepositPda(gv, user.publicKey),
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        });
      if (user instanceof Keypair) return builder.signers([user]).rpc();
      return builder.rpc();
    }

    it("initializes a genesis vault tier", async () => {
      await initTier(TIER0, 100, 1_000 * ONE, 1_000 * ONE);
      const gv = await program.account.genesisVault.fetch(genesisVaultPda(TIER0));
      assert.equal(gv.tier, TIER0);
      assert.equal(gv.feeBps, 100);
      assert.isTrue(gv.presaleActive);
      assert.isFalse(gv.isFinalized);
      assert.equal(gv.totalRaised.toNumber(), 0);
    });

    it("rejects genesis init from a non-authority", async () => {
      await expectAnchorError(initTier(1, 100, 1_000 * ONE, 1_000 * ONE, user2), "Unauthorized");
    });

    it("rejects an invalid tier", async () => {
      await expectAnchorError(initTier(3, 100, 1_000 * ONE, 1_000 * ONE), "InvalidTier");
    });

    it("accepts deposits and tracks per-user + total raised", async () => {
      await depositTier(TIER0, wallet, userAnsem, 50 * ONE);
      const gv = genesisVaultPda(TIER0);
      const dep = await program.account.userDeposit.fetch(userDepositPda(gv, wallet.publicKey));
      assert.equal(dep.amount.toString(), BigInt(50 * ONE).toString());
      assert.equal((await bal(connection, genesisTokenPda(TIER0))).toString(), BigInt(50 * ONE).toString());
      const vaultAcc = await program.account.genesisVault.fetch(gv);
      assert.equal(vaultAcc.totalRaised.toString(), BigInt(50 * ONE).toString());
    });

    it("lets a user withdraw before finalize", async () => {
      const gv = genesisVaultPda(TIER0);
      const ansemBefore = await bal(connection, userAnsem);
      await program.methods
        .withdrawGenesis()
        .accountsPartial({
          user: wallet.publicKey,
          genesisVault: gv,
          tokenVault: genesisTokenPda(TIER0),
          userAnsem,
          userDeposit: userDepositPda(gv, wallet.publicKey),
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      assert.equal(((await bal(connection, userAnsem)) - ansemBefore).toString(), BigInt(50 * ONE).toString());
      const vaultAcc = await program.account.genesisVault.fetch(gv);
      assert.equal(vaultAcc.totalRaised.toNumber(), 0);
      await expectReject(
        program.account.userDeposit.fetch(userDepositPda(gv, wallet.publicKey)),
        "user deposit closed after withdraw"
      );
    });

    it("enforces the per-user allocation cap", async () => {
      await initTier(1, 100, 1_000 * ONE, 50 * ONE); // maxAllocation = 50 ANSEM
      await expectAnchorError(depositTier(1, wallet, userAnsem, 60 * ONE), "AllocationExceeded");
    });

    it("enforces the total deposit cap", async () => {
      await initTier(2, 150, 50 * ONE, 1_000 * ONE); // cap = 50 ANSEM, alloc = 1000
      await expectAnchorError(depositTier(2, wallet, userAnsem, 60 * ONE), "DepositCapExceeded");
    });

    it("finalizes: skims tier fee, moves ANSEM to backing, mints BULLET for claims", async () => {
      const gv = genesisVaultPda(TIER0);
      // Two depositors → test pro-rata claims (2:1).
      await depositTier(TIER0, wallet, userAnsem, 200 * ONE);
      await depositTier(TIER0, user2, user2Ansem, 100 * ONE);

      const feeAnsemBefore = await bal(connection, feeRecipientAta);
      const protoBefore = await state();

      await program.methods
        .finalizeGenesis()
        .accountsPartial({
          authority: wallet.publicKey,
          protocol: protocolPda,
          bulletMint,
          ansemMint,
          vault,
          feeRecipient: feeRecipient.publicKey,
          feeRecipientAta,
          genesisVault: gv,
          tokenVault: genesisTokenPda(TIER0),
          bulletVault: genesisBulletPda(TIER0),
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      const vaultAcc = await program.account.genesisVault.fetch(gv);
      assert.isTrue(vaultAcc.isFinalized);
      assert.isFalse(vaultAcc.presaleActive);
      assert.isTrue(vaultAcc.totalBullet.toNumber() > 0, "BULLET minted for claims");

      // Tier fee (1% of 300 ANSEM = 3 ANSEM) went to the fee recipient.
      const raised = 300n * BigInt(ONE);
      const expectedFee = (raised * 100n) / BPS_DENOM;
      assert.equal(
        ((await bal(connection, feeRecipientAta)) - feeAnsemBefore).toString(),
        expectedFee.toString()
      );

      const protoAfter = await state();
      assert.isTrue(protoAfter.supply > protoBefore.supply, "protocol supply grows on finalize");
      assert.equal(
        (await bal(connection, genesisBulletPda(TIER0))).toString(),
        vaultAcc.totalBullet.toString()
      );
    });

    it("rejects deposits after finalize", async () => {
      await expectAnchorError(depositTier(TIER0, wallet, userAnsem, 10 * ONE), "PresaleInactive");
    });

    it("claims pro-rata BULLET (2:1 between the two depositors)", async () => {
      const gv = genesisVaultPda(TIER0);

      const claim = (user: Keypair | anchor.Wallet, uBullet: PublicKey) => {
        const builder = program.methods
          .claimGenesis()
          .accountsPartial({
            user: user.publicKey,
            genesisVault: gv,
            bulletVault: genesisBulletPda(TIER0),
            protocol: protocolPda,
            bulletMint,
            userBullet: uBullet,
            userDeposit: userDepositPda(gv, user.publicKey),
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          });
        if (user instanceof Keypair) return builder.signers([user]).rpc();
        return builder.rpc();
      };

      const userBulletBefore = await bal(connection, userBullet);
      await claim(wallet, userBullet);
      const gainUser = (await bal(connection, userBullet)) - userBulletBefore;

      await claim(user2, user2Bullet);
      const gainUser2 = await bal(connection, user2Bullet);

      assert.isTrue(gainUser > 0n && gainUser2 > 0n, "both depositors receive BULLET");
      // user deposited 2x → gets ~2x (allow small rounding).
      const ratio = Number(gainUser) / Number(gainUser2);
      assert.isTrue(ratio > 1.95 && ratio < 2.05, `expected ~2:1 pro-rata, got ${ratio}`);

      const dep = await program.account.userDeposit.fetch(userDepositPda(gv, wallet.publicKey));
      assert.isTrue(dep.claimed);
    });

    it("rejects a double claim", async () => {
      const gv = genesisVaultPda(TIER0);
      await expectAnchorError(
        program.methods
          .claimGenesis()
          .accountsPartial({
            user: wallet.publicKey,
            genesisVault: gv,
            bulletVault: genesisBulletPda(TIER0),
            protocol: protocolPda,
            bulletMint,
            userBullet,
            userDeposit: userDepositPda(gv, wallet.publicKey),
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .rpc(),
        "AlreadyClaimed"
      );
    });
  });
});
