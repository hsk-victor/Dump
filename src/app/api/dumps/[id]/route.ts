import { after, NextResponse, type NextRequest } from "next/server";
import { deleteDump, getDump, topPosition, topicExists, updateDump } from "@/lib/db";
import { enrichDump, noteTitle } from "@/lib/enrich";
import { fileStorage, storedFileName } from "@/lib/storage";
import { archiveDump, removeArchiveFiles } from "@/lib/archive";

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
  if (typeof body.keepVideo === "boolean") {
    const current = getDump(id)!;
    const mediaArchive = { ...current.mediaArchive };
    const removed = current.videoUrl ? mediaArchive[current.videoUrl] : null;
    if (!body.keepVideo && current.videoUrl) delete mediaArchive[current.videoUrl];
    const dump = updateDump(id, { keepVideo: body.keepVideo, mediaArchive });
    if (!body.keepVideo && removed && !Object.values(mediaArchive).includes(removed)) await removeArchiveFiles([removed]);
    if (body.keepVideo) after(() => archiveDump(id));
    return NextResponse.json(dump);
  }

  if (body.reprocess) {
    const dump = updateDump(id, { status: "processing" });
    after(() => enrichDump(id));
    return NextResponse.json(dump);
  }
  if (topicExists(body.topic)) {
    return NextResponse.json(updateDump(id, { topic: body.topic, topicLocked: true, classifiedBy: "you" }));
  }
  // Pin and/or manual reorder arrive together from card drags.
  if (typeof body.pinned === "boolean" || typeof body.position === "number") {
    const patch: Record<string, unknown> = {};
    if (typeof body.pinned === "boolean") patch.pinned = body.pinned;
    if (typeof body.position === "number" && Number.isFinite(body.position)) patch.position = body.position;
    // A pin with no explicit slot floats to the very top of the pinned group.
    if (patch.pinned === true && patch.position === undefined) patch.position = topPosition();
    if (Object.keys(patch).length) return NextResponse.json(updateDump(id, patch));
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
  await removeArchiveFiles(Object.values(dump.mediaArchive));
  const name = storedFileName(dump.imageUrl);
  if (name) await fileStorage.remove(name);
  return new NextResponse(null, { status: 204 });
}
