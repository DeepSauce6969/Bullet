import { NextRequest, NextResponse } from "next/server";
import {
  createAssociatedTokenAccountIdempotent,
  getAssociatedTokenAddressSync,
  mintTo,
} from "@solana/spl-token";
import { Connection, Keypair, PublicKey, clusterApiUrl } from "@solana/web3.js";
import fs from "fs";
import os from "os";
import path from "path";

const ANSEM_MINT = new PublicKey(
  "GC3hpHn9p2LtzWwM3WQrYPZXXsxULg53pPKfRoAs2gVW"
);
const AMOUNT = BigInt(10_000_000_000); // 10_000 mock Ansem

function loadAuthority(): Keypair {
  const p = path.join(os.homedir(), ".config", "solana", "id.json");
  const raw = JSON.parse(fs.readFileSync(p, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

/** Devnet-only faucet: mints mock Ansem to the connected wallet. */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const recipient = new PublicKey(body.address as string);
    const connection = new Connection(clusterApiUrl("devnet"), "confirmed");
    const authority = loadAuthority();

    const ata = getAssociatedTokenAddressSync(ANSEM_MINT, recipient);
    await createAssociatedTokenAccountIdempotent(
      connection,
      authority,
      ANSEM_MINT,
      recipient
    );
    const sig = await mintTo(
      connection,
      authority,
      ANSEM_MINT,
      ata,
      authority,
      AMOUNT
    );

    return NextResponse.json({
      ok: true,
      amount: "10000",
      ata: ata.toBase58(),
      signature: sig,
      explorer: `https://explorer.solana.com/tx/${sig}?cluster=devnet`,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
