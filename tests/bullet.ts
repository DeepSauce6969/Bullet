import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
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
import type { BulletTransferHook } from "../target/types/bullet_transfer_hook";

/** Reference only — localnet uses a mock mint. */
export const ANSEM_MAINNET = "9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump";

const ONE = 1_000_000; // 1 token (6 decimals)
const MAX_SUPPLY = new anchor.BN(5_000_000 * ONE);

// Mirror of on-chain constants (programs/bullet/src/state.rs).
const PROTOCOL_FEE_BPS = 500n;
const BPS_DENOM = 10_000n;
const FEE_POL_BPS = 1_500n;
const FEE_BRIBE_BPS = 1_500n;
const OUT_FEE_NUM = 950n;
const OUT_FEE_DEN = 1_000n;

/** Replicates math::floor_scaled: supply==0 → 1e6, else backing*1e6/supply. */
function floorScaled(vaultBal: bigint, totalBorrowed: bigint, supply: bigint): bigint {
  if (supply === 0n) return 1_000_000n;
  return ((vaultBal + totalBorrowed) * 1_000_000n) / supply;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Read a token account balance with retries.
 * Token-2022 + local validator RPC often lag right after `.rpc()`; returning `0n` on a
 * transient miss caused flaky genesis / vault asserts. Prefer RPC JSON, then getAccount,
 * then raw bytes at SPL amount offset 64.
 */
async function bal(
  connection: anchor.web3.Connection,
  ata: PublicKey,
  tokenProgram: PublicKey = TOKEN_PROGRAM_ID,
  retries = 20,
  allowMissing = false
): Promise<bigint> {
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
      if (!info) lastErr = new Error("account missing");
    } catch (e) {
      lastErr = e;
    }
    await sleep(150 + i * 50);
  }
  if (allowMissing) return 0n;
  throw new Error(
    `bal(${ata.toBase58()}) failed after ${retries} tries: ${String(lastErr)}`
  );
}

/** Poll until balance satisfies `pred` (for post-tx Token-2022 lag). */
async function waitBal(
  connection: anchor.web3.Connection,
  ata: PublicKey,
  pred: (n: bigint) => boolean,
  tokenProgram: PublicKey = TOKEN_PROGRAM_ID,
  retries = 24
): Promise<bigint> {
  let last = 0n;
  for (let i = 0; i < retries; i++) {
    last = await bal(connection, ata, tokenProgram, 4, true);
    if (pred(last)) return last;
    await sleep(200 + i * 50);
  }
  throw new Error(
    `waitBal(${ata.toBase58()}) last=${last.toString()} after ${retries} polls`
  );
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
  tries = 120
): Promise<void> {
  for (let i = 0; i < tries; i++) {
    const info = await connection.getAccountInfo(pid).catch(() => null);
    if (info?.executable) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`program ${pid.toBase58()} not loaded on the validator`);
}

/** Retry flaky RPC/setup steps while the local validator warms up. */
async function withValidatorRetry<T>(
  fn: () => Promise<T>,
  label: string,
  tries = 8
): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 750));
    }
  }
  throw last instanceof Error ? last : new Error(`${label} failed after ${tries} tries`);
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
  const hookProgram = anchor.workspace.BulletTransferHook as Program<BulletTransferHook>;
  /** Always follow the deployed hook id (works after localnet `anchor keys sync`). */
  const HOOK_PROGRAM_ID = hookProgram.programId;
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

  let hookConfig: PublicKey;
  let extraAccountMetaList: PublicKey;

  let userAnsem: PublicKey;
  let userBullet: PublicKey;

  // Secondary actor for isolation / negative tests.
  const user2 = Keypair.generate();
  const user3 = Keypair.generate();
  let user2Ansem: PublicKey;
  let user2Bullet: PublicKey;
  let user3Ansem: PublicKey;
  let user3Bullet: PublicKey;

  const pda = (seeds: (Buffer | Uint8Array)[]) =>
    PublicKey.findProgramAddressSync(seeds, program.programId)[0];

  const loanPda = (borrower: PublicKey, index: anchor.BN) =>
    pda([
      Buffer.from("loan"),
      protocolPda.toBuffer(),
      borrower.toBuffer(),
      index.toArrayLike(Buffer, "le", 8),
    ]);

  async function ensureBulletAta(owner: PublicKey) {
    const ata = getAssociatedTokenAddressSync(
      bulletMint,
      owner,
      false,
      TOKEN_2022_PROGRAM_ID
    );
    await withValidatorRetry(async () => {
      const info = await connection.getAccountInfo(ata);
      if (!info) {
        await createAssociatedTokenAccount(
          connection,
          wallet.payer,
          bulletMint,
          owner,
          undefined,
          TOKEN_2022_PROGRAM_ID
        );
      }
    }, `ensureBulletAta ${owner.toBase58()}`);
    return ata;
  }

  async function setupTransferHook() {
    hookConfig = PublicKey.findProgramAddressSync(
      [Buffer.from("hook_config"), bulletMint.toBuffer()],
      HOOK_PROGRAM_ID
    )[0];
    extraAccountMetaList = PublicKey.findProgramAddressSync(
      [Buffer.from("extra-account-metas"), bulletMint.toBuffer()],
      HOOK_PROGRAM_ID
    )[0];
    await hookProgram.methods
      .initializeConfig(800)
      .accountsPartial({
        authority: wallet.publicKey,
        mint: bulletMint,
        hookConfig,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    await hookProgram.methods
      .initializeExtraAccountMetaList()
      .accountsPartial({
        payer: wallet.publicKey,
        mint: bulletMint,
        extraAccountMetaList,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    await hookProgram.methods
      .registerExemptAccount()
      .accountsPartial({
        authority: wallet.publicKey,
        mint: bulletMint,
        hookConfig,
        tokenAccount: collateralVault,
      })
      .rpc();

    for (const owner of [wallet.publicKey, user2.publicKey, user3.publicKey]) {
      await ensureBulletAta(owner);
    }
  }

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
    await waitForProgram(connection, TOKEN_2022_PROGRAM_ID);
    await waitForProgram(connection, ASSOCIATED_TOKEN_PROGRAM_ID);

    ansemMint = await withValidatorRetry(
      () => createMint(connection, wallet.payer, wallet.publicKey, null, 6),
      "createMint"
    );

    feeRecipient = Keypair.generate();
    feeRecipientAta = await withValidatorRetry(
      () =>
        createAssociatedTokenAccount(
          connection,
          wallet.payer,
          ansemMint,
          feeRecipient.publicKey
        ),
      "createAssociatedTokenAccount feeRecipient"
    );

    protocolPda = pda([Buffer.from("protocol")]);
    bulletMint = pda([Buffer.from("bullet_mint")]);
    vault = pda([Buffer.from("vault")]);
    polVault = pda([Buffer.from("pol_vault")]);
    collateralVault = pda([Buffer.from("collateral_vault")]);

    userAnsem = await withValidatorRetry(
      () =>
        createAssociatedTokenAccount(
          connection,
          wallet.payer,
          ansemMint,
          wallet.publicKey
        ),
      "createAssociatedTokenAccount user"
    );
    await withValidatorRetry(
      () =>
        mintTo(
          connection,
          wallet.payer,
          ansemMint,
          userAnsem,
          wallet.payer,
          BigInt(1_000_000) * BigInt(ONE)
        ),
      "mintTo user"
    );
    userBullet = getAssociatedTokenAddressSync(
      bulletMint,
      wallet.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );

    // Fund user2 with SOL + ANSEM.
    const sig = await connection.requestAirdrop(user2.publicKey, 2 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig, "confirmed");
    user2Ansem = await withValidatorRetry(
      () =>
        createAssociatedTokenAccount(
          connection,
          wallet.payer,
          ansemMint,
          user2.publicKey
        ),
      "createAssociatedTokenAccount user2"
    );
    await withValidatorRetry(
      () =>
        mintTo(
          connection,
          wallet.payer,
          ansemMint,
          user2Ansem,
          wallet.payer,
          BigInt(5_000) * BigInt(ONE)
        ),
      "mintTo user2"
    );
    user2Bullet = getAssociatedTokenAddressSync(
      bulletMint,
      user2.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );

    const sig3 = await connection.requestAirdrop(user3.publicKey, 2 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig3, "confirmed");
    user3Ansem = await withValidatorRetry(
      () =>
        createAssociatedTokenAccount(
          connection,
          wallet.payer,
          ansemMint,
          user3.publicKey
        ),
      "createAssociatedTokenAccount user3"
    );
    await withValidatorRetry(
      () =>
        mintTo(
          connection,
          wallet.payer,
          ansemMint,
          user3Ansem,
          wallet.payer,
          BigInt(ONE)
        ),
      "mintTo user3"
    );
    user3Bullet = getAssociatedTokenAddressSync(
      bulletMint,
      user3.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );
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
        transferHookProgram: HOOK_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        token2022Program: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .rpc();

    await setupTransferHook();

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
          transferHookProgram: HOOK_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          token2022Program: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .rpc(),
      "re-initialize"
    );
  });

  // ---- mint ----

  async function mint(user: Keypair | anchor.Wallet, uAnsem: PublicKey, _uBullet: PublicKey, amount: number) {
    const bulletAta = await ensureBulletAta(user.publicKey);
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
        userBullet: bulletAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        bulletTokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      });
    const sig =
      user instanceof Keypair
        ? await builder.signers([user]).rpc()
        : await builder.rpc();
    await connection.confirmTransaction(sig, "confirmed");
    return sig;
  }

  it("mints BULLET 1:1 (minus 5% out-fee) on the first deposit and routes fees", async () => {
    const deposit = 100 * ONE;
    userBullet = await ensureBulletAta(wallet.publicKey);
    await mint(wallet, userAnsem, userBullet, deposit);

    // supply started at 0 → gross 1:1, user gets 95%.
    const expectedBullet = (BigInt(deposit) * OUT_FEE_NUM) / OUT_FEE_DEN;
    const fee = (BigInt(deposit) * PROTOCOL_FEE_BPS) / BPS_DENOM;
    const expectedPol = (fee * FEE_POL_BPS) / BPS_DENOM;
    const expectedBribe = (fee * FEE_BRIBE_BPS) / BPS_DENOM;
    const expectedVault = BigInt(deposit) - expectedPol - expectedBribe;

    assert.equal(
      (
        await waitBal(
          connection,
          userBullet,
          (n) => n === expectedBullet,
          TOKEN_2022_PROGRAM_ID
        )
      ).toString(),
      expectedBullet.toString()
    );
    assert.equal(
      (await waitBal(connection, polVault, (n) => n === expectedPol)).toString(),
      expectedPol.toString()
    );
    assert.equal(
      (await waitBal(connection, feeRecipientAta, (n) => n === expectedBribe)).toString(),
      expectedBribe.toString()
    );
    assert.equal(
      (await waitBal(connection, vault, (n) => n === expectedVault)).toString(),
      expectedVault.toString()
    );

    const { proto } = await state();
    assert.equal(proto.totalSupply.toString(), expectedBullet.toString());
    assert.equal(proto.totalMinted.toString(), expectedBullet.toString());
  });

  it("rejects a zero-amount mint", async () => {
    await expectAnchorError(mint(wallet, userAnsem, userBullet, 0), "ZeroAmount");
  });

  it("mints again on non-zero supply and keeps the floor up-only", async () => {
    const before = await state();
    const userBulletBefore = await bal(connection, userBullet, TOKEN_2022_PROGRAM_ID);

    await mint(wallet, userAnsem, userBullet, 100 * ONE);

    const after = await state();
    const userBulletAfter = await waitBal(
      connection,
      userBullet,
      (n) => n > userBulletBefore,
      TOKEN_2022_PROGRAM_ID
    );
    assert.isTrue(
      userBulletAfter > userBulletBefore,
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

    const sig = await program.methods
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
        bulletTokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();
    await connection.confirmTransaction(sig, "confirmed");

    const after = await state();
    const userAnsemAfter = await waitBal(
      connection,
      userAnsem,
      (n) => n > userAnsemBefore
    );
    assert.isTrue(userAnsemAfter > userAnsemBefore, "user should receive ANSEM");
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
          bulletTokenProgram: TOKEN_2022_PROGRAM_ID,
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
    const sig = await program.methods
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
        bulletTokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    await connection.confirmTransaction(sig, "confirmed");

    const loan = await program.account.loan.fetch(borrowLoan);
    assert.isTrue(loan.active);
    assert.equal(loan.borrowedAnsem.toString(), BigInt(borrowAmt).toString());
    assert.isTrue(loan.collateralBullet.toNumber() > 0);

    const after = await state();
    assert.equal((after.borrowed - before.borrowed).toString(), BigInt(borrowAmt).toString());
    assert.equal(after.proto.loanCount.toNumber(), before.proto.loanCount.toNumber() + 1);
    const expectedCollat = BigInt(loan.collateralBullet.toString());
    const collatBal = await waitBal(
      connection,
      collateralVault,
      (n) => n === expectedCollat,
      TOKEN_2022_PROGRAM_ID
    );
    assert.equal(collatBal.toString(), expectedCollat.toString());
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
          bulletTokenProgram: TOKEN_2022_PROGRAM_ID,
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
    await createAssociatedTokenAccount(
      connection,
      wallet.payer,
      bulletMint,
      user2.publicKey,
      undefined,
      TOKEN_2022_PROGRAM_ID
    ).catch(() => null);
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
          bulletTokenProgram: TOKEN_2022_PROGRAM_ID,
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
    const userBulletBefore = await bal(connection, userBullet, TOKEN_2022_PROGRAM_ID);
    const expectedCollat = BigInt(loan.collateralBullet.toString());

    const sig = await program.methods
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
        bulletTokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();
    await connection.confirmTransaction(sig, "confirmed");

    const after = await state();
    assert.equal(
      (before.borrowed - after.borrowed).toString(),
      loan.borrowedAnsem.toString(),
      "total_borrowed decreases by principal"
    );
    const userBulletAfter = await waitBal(
      connection,
      userBullet,
      (n) => n - userBulletBefore === expectedCollat,
      TOKEN_2022_PROGRAM_ID
    );
    assert.equal(
      (userBulletAfter - userBulletBefore).toString(),
      expectedCollat.toString(),
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
    const collatBefore = await bal(connection, collateralVault, TOKEN_2022_PROGRAM_ID, 8, true);

    const notional = 20 * ONE;
    const sig = await program.methods
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
        bulletTokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    await connection.confirmTransaction(sig, "confirmed");

    const loan = await program.account.loan.fetch(leverageLoan);
    assert.isTrue(loan.active);
    assert.isTrue(loan.collateralBullet.toNumber() > 0);
    assert.isTrue(loan.borrowedAnsem.toNumber() > 0);

    const after = await state();
    const expectedCollat = BigInt(loan.collateralBullet.toString());
    // Collateral BULLET is minted straight into the collateral vault.
    const collatAfter = await waitBal(
      connection,
      collateralVault,
      (n) => n - collatBefore === expectedCollat,
      TOKEN_2022_PROGRAM_ID
    );
    assert.equal((collatAfter - collatBefore).toString(), expectedCollat.toString());
    assert.equal((after.supply - before.supply).toString(), loan.collateralBullet.toString());
    // Debt recorded in total_borrowed (internal credit, backs the mint).
    assert.equal((after.borrowed - before.borrowed).toString(), loan.borrowedAnsem.toString());
    // User pays ONLY the fees — its ANSEM balance strictly DECREASES (the borrowed
    // leg is not disbursed), and the spend is far below the notional.
    const userAnsemAfter = await waitBal(connection, userAnsem, (n) => n < userAnsemBefore);
    const spent = userAnsemBefore - userAnsemAfter;
    assert.isTrue(spent > 0n, "user pays leverage fees");
    assert.isTrue(spent < BigInt(notional), "user pays only fees, not the notional");
    assert.isTrue(spent < BigInt(loan.borrowedAnsem.toString()), "user does NOT receive the borrowed ANSEM");
    // Floor must not decrease.
    assert.isTrue(after.floor >= before.floor, "floor must not decrease on leverage");
  });

  it("repays a leveraged position: pays the debt and reclaims the minted collateral", async () => {
    const before = await state();
    const loan = await program.account.loan.fetch(leverageLoan);
    const userBulletBefore = await bal(connection, userBullet, TOKEN_2022_PROGRAM_ID);
    const userAnsemBefore = await bal(connection, userAnsem);
    const expectedDebt = BigInt(loan.borrowedAnsem.toString());
    const expectedCollat = BigInt(loan.collateralBullet.toString());

    const sig = await program.methods
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
        bulletTokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();
    await connection.confirmTransaction(sig, "confirmed");

    const after = await state();
    const userAnsemAfter = await waitBal(
      connection,
      userAnsem,
      (n) => userAnsemBefore - n === expectedDebt
    );
    assert.equal(
      (userAnsemBefore - userAnsemAfter).toString(),
      expectedDebt.toString(),
      "user pays the borrowed principal"
    );
    const userBulletAfter = await waitBal(
      connection,
      userBullet,
      (n) => n - userBulletBefore === expectedCollat,
      TOKEN_2022_PROGRAM_ID
    );
    assert.equal(
      (userBulletAfter - userBulletBefore).toString(),
      expectedCollat.toString(),
      "user reclaims leveraged collateral"
    );
    assert.equal((before.borrowed - after.borrowed).toString(), loan.borrowedAnsem.toString());
    await expectReject(program.account.loan.fetch(leverageLoan), "leverage loan closed");
    assert.isTrue(after.floor >= before.floor, "floor must not decrease on repay");
  });

  it("rejects leverage when the wallet cannot cover upfront fees (InsufficientLeverageFee)", async () => {
    const { proto } = await state();
    await expectAnchorError(
      program.methods
        .leverage(new anchor.BN(100 * ONE), 30)
        .accountsPartial({
          user: user3.publicKey,
          protocol: protocolPda,
          bulletMint,
          ansemMint,
          vault,
          polVault,
          collateralVault,
          feeRecipient: feeRecipient.publicKey,
          feeRecipientAta,
          userAnsem: user3Ansem,
          userBullet: user3Bullet,
          loan: loanPda(user3.publicKey, proto.loanCount),
          tokenProgram: TOKEN_PROGRAM_ID,
          bulletTokenProgram: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([user3])
        .rpc(),
      "InsufficientLeverageFee"
    );
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
        bulletTokenProgram: TOKEN_2022_PROGRAM_ID,
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
          bulletTokenProgram: TOKEN_2022_PROGRAM_ID,
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
          bulletTokenProgram: TOKEN_2022_PROGRAM_ID,
        });
      if (authority instanceof Keypair) {
        await builder.signers([authority]).rpc();
      } else {
        await builder.rpc();
      }
      await hookProgram.methods
        .registerExemptAccount()
        .accountsPartial({
          authority: wallet.publicKey,
          mint: bulletMint,
          hookConfig,
          tokenAccount: genesisBulletPda(tier),
        })
        .rpc()
        .catch(() => undefined);
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
      await initTier(TIER0, 0, 1_000 * ONE, 1_000 * ONE);
      const gv = await program.account.genesisVault.fetch(genesisVaultPda(TIER0));
      assert.equal(gv.tier, TIER0);
      assert.equal(gv.feeBps, 0);
      assert.isTrue(gv.presaleActive);
      assert.isFalse(gv.isFinalized);
      assert.equal(gv.totalRaised.toNumber(), 0);
    });

    it("rejects genesis init from a non-authority", async () => {
      await expectAnchorError(initTier(1, 250, 1_000 * ONE, 1_000 * ONE, user2), "Unauthorized");
    });

    it("rejects an invalid tier", async () => {
      await expectAnchorError(initTier(3, 100, 1_000 * ONE, 1_000 * ONE), "InvalidTier");
    });

    it("accepts deposits and tracks per-user + total raised", async () => {
      await depositTier(TIER0, wallet, userAnsem, 50 * ONE);
      const gv = genesisVaultPda(TIER0);
      const dep = await program.account.userDeposit.fetch(userDepositPda(gv, wallet.publicKey));
      assert.equal(dep.amount.toString(), BigInt(50 * ONE).toString());
      const tokenBal = await waitBal(
        connection,
        genesisTokenPda(TIER0),
        (n) => n === BigInt(50 * ONE)
      );
      assert.equal(tokenBal.toString(), BigInt(50 * ONE).toString());
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
      const ansemAfter = await waitBal(
        connection,
        userAnsem,
        (n) => n - ansemBefore === BigInt(50 * ONE)
      );
      assert.equal((ansemAfter - ansemBefore).toString(), BigInt(50 * ONE).toString());
      const vaultAcc = await program.account.genesisVault.fetch(gv);
      assert.equal(vaultAcc.totalRaised.toNumber(), 0);
      await expectReject(
        program.account.userDeposit.fetch(userDepositPda(gv, wallet.publicKey)),
        "user deposit closed after withdraw"
      );
    });

    it("enforces the per-user allocation cap", async () => {
      await initTier(1, 250, 1_000 * ONE, 50 * ONE); // maxAllocation = 50 ANSEM
      await expectAnchorError(depositTier(1, wallet, userAnsem, 60 * ONE), "AllocationExceeded");
    });

    it("enforces the total deposit cap", async () => {
      await initTier(2, 400, 50 * ONE, 1_000 * ONE); // cap = 50 ANSEM, alloc = 1000
      await expectAnchorError(depositTier(2, wallet, userAnsem, 60 * ONE), "DepositCapExceeded");
    });

    it("routes genesis tier fee entirely to POL on finalize", async () => {
      const TIER_FEE = 2; // Public tier (4% fee), initialized in deposit-cap test
      await depositTier(TIER_FEE, wallet, userAnsem, 40 * ONE);

      const gv = genesisVaultPda(TIER_FEE);
      const polBefore = await bal(connection, polVault);
      const feeBefore = await bal(connection, feeRecipientAta);

      await program.methods
        .finalizeGenesis()
        .accountsPartial({
          authority: wallet.publicKey,
          protocol: protocolPda,
          bulletMint,
          ansemMint,
          vault,
          polVault,
          genesisVault: gv,
          tokenVault: genesisTokenPda(TIER_FEE),
          bulletVault: genesisBulletPda(TIER_FEE),
          tokenProgram: TOKEN_PROGRAM_ID,
          bulletTokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .rpc();

      const expectedFee = (40n * BigInt(ONE) * 400n) / BPS_DENOM;
      const polAfter = await waitBal(
        connection,
        polVault,
        (n) => n - polBefore === expectedFee
      );
      assert.equal(polAfter - polBefore, expectedFee);
      assert.equal((await bal(connection, feeRecipientAta)) - feeBefore, 0n);
    });

    it("finalizes: skims tier fee, moves ANSEM to backing, mints BULLET for claims", async () => {
      const gv = genesisVaultPda(TIER0);
      // Two depositors → test pro-rata claims (2:1).
      await depositTier(TIER0, wallet, userAnsem, 200 * ONE);
      await depositTier(TIER0, user2, user2Ansem, 100 * ONE);

      const feeAnsemBefore = await bal(connection, feeRecipientAta);
      const polBefore = await bal(connection, polVault);
      const protoBefore = await state();

      await program.methods
        .finalizeGenesis()
        .accountsPartial({
          authority: wallet.publicKey,
          protocol: protocolPda,
          bulletMint,
          ansemMint,
          vault,
          polVault,
          genesisVault: gv,
          tokenVault: genesisTokenPda(TIER0),
          bulletVault: genesisBulletPda(TIER0),
          tokenProgram: TOKEN_PROGRAM_ID,
          bulletTokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .rpc();

      const vaultAcc = await program.account.genesisVault.fetch(gv);
      assert.isTrue(vaultAcc.isFinalized);
      assert.isFalse(vaultAcc.presaleActive);
      assert.isTrue(vaultAcc.totalBullet.toNumber() > 0, "BULLET minted for claims");

      // VIP tier = 0% presale fee.
      assert.equal((await bal(connection, feeRecipientAta)) - feeAnsemBefore, 0n);
      assert.equal((await bal(connection, polVault)) - polBefore, 0n);

      const protoAfter = await state();
      assert.isTrue(protoAfter.supply > protoBefore.supply, "protocol supply grows on finalize");
      const expectedBullet = BigInt(vaultAcc.totalBullet.toString());
      const genesisBulletBal = await waitBal(
        connection,
        genesisBulletPda(TIER0),
        (n) => n === expectedBullet,
        TOKEN_2022_PROGRAM_ID
      );
      assert.equal(genesisBulletBal.toString(), expectedBullet.toString());
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
            bulletTokenProgram: TOKEN_2022_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          });
        if (user instanceof Keypair) return builder.signers([user]).rpc();
        return builder.rpc();
      };

      const userBulletBefore = await bal(connection, userBullet, TOKEN_2022_PROGRAM_ID);
      await claim(wallet, userBullet);
      const userBulletAfter = await waitBal(
        connection,
        userBullet,
        (n) => n > userBulletBefore,
        TOKEN_2022_PROGRAM_ID
      );
      const gainUser = userBulletAfter - userBulletBefore;

      await claim(user2, user2Bullet);
      const gainUser2 = await waitBal(
        connection,
        user2Bullet,
        (n) => n > 0n,
        TOKEN_2022_PROGRAM_ID
      );

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
            bulletTokenProgram: TOKEN_2022_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .rpc(),
        "AlreadyClaimed"
      );
    });
  });
});
