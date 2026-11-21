import { NextResponse } from "next/server";
import { listRecentDumps } from "@/lib/db";
import { recentLabel } from "@/lib/recents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ items: listRecentDumps().map((item) => ({ id: item.id, label: recentLabel(item) })) });
}
