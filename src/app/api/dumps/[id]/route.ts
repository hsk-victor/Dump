import { after, NextResponse, type NextRequest } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { deleteDump, getDump, updateDump, UPLOAD_DIR } from "@/lib/db";
import { enrichDump, noteTitle } from "@/lib/enrich";
import { isTopic } from "@/lib/taxonomy";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const dump = getDump((await params).id);
  return dump ? NextResponse.json(dump) : NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  if (!getDump(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));

  if (body.reprocess) {
    const dump = updateDump(id, { status: "processing" });
    after(() => enrichDump(id));
    return NextResponse.json(dump);
  }
  if (isTopic(body.topic)) {
    return NextResponse.json(updateDump(id, { topic: body.topic, topicLocked: true, classifiedBy: "you" }));
  }
  if (typeof body.pinned === "boolean") {
    return NextResponse.json(updateDump(id, { pinned: body.pinned }));
  }
  // Note body edits: the title is always the first line, re-derived on save.
  if (typeof body.content === "string") {
    const dump = getDump(id)!;
    if (dump.kind !== "note") return NextResponse.json({ error: "Only notes can be edited" }, { status: 400 });
    const content = body.content.trim().slice(0, 50000);
    if (!content) return NextResponse.json({ error: "Notes can't be empty" }, { status: 400 });
    return NextResponse.json(updateDump(id, { content, title: noteTitle(content) }));
  }
  return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const dump = deleteDump((await params).id);
  if (!dump) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (dump.imageUrl?.startsWith("/api/files/")) {
    await fs.rm(path.join(UPLOAD_DIR, path.basename(dump.imageUrl)), { force: true });
  }
  return new NextResponse(null, { status: 204 });
}
