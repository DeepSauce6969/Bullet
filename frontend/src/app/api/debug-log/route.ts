import { NextRequest, NextResponse } from "next/server";
import fs from "fs";

const LOG_PATH = "/opt/cursor/logs/debug.log";

/** Dev-only NDJSON sink for cloud-agent leverage debugging. */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const line =
      JSON.stringify({
        ...body,
        timestamp: body.timestamp ?? Date.now(),
      }) + "\n";
    fs.appendFileSync(LOG_PATH, line);
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
