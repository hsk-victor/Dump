import { NextResponse, type NextRequest } from "next/server";
import { resortAll } from "@/lib/enrich";
import { aiEnabled } from "@/lib/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function sameOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (!origin) return req.headers.get("sec-fetch-site") !== "cross-site";
  try {
    return new URL(origin).host === req.headers.get("host");
  } catch {
    return false;
  }
}

/** Re-files every dump the user hasn't filed by hand, using the AI classifier. */
export async function POST(req: NextRequest) {
  // Re-sorting costs API credits and rewrites topics, so other sites mustn't be able to trigger it.
  if (!sameOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!aiEnabled()) return NextResponse.json({ error: "Set OPENROUTER_API_KEY to re-sort with AI." }, { status: 400 });
  return NextResponse.json(await resortAll());
}
