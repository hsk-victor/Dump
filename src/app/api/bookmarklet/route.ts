import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The desktop app's bookmarklet key (see src/lib/desktop-token.ts); null outside the desktop app. */
export async function GET() {
  return NextResponse.json({ key: process.env.DUMP_BOOKMARKLET_KEY || null });
}
