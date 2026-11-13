import { NextResponse } from "next/server";
import { resortAll } from "@/lib/enrich";
import { aiEnabled } from "@/lib/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Re-files every dump the user hasn't filed by hand, using the AI classifier. */
export async function POST() {
  if (!aiEnabled()) return NextResponse.json({ error: "Set OPENROUTER_API_KEY to re-sort with AI." }, { status: 400 });
  return NextResponse.json(await resortAll());
}
