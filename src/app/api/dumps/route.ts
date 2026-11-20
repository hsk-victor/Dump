import { after, NextResponse, type NextRequest } from "next/server";
import { counts, failStaleProcessing, listDumps, listTopics, staleXRenderIds, updateDump } from "@/lib/db";
import { createFromFile, createFromText, InputError } from "@/lib/create";
import { enrichDump, isEnriching, refreshXRender } from "@/lib/enrich";
import { STALE_PROCESSING_MS } from "@/lib/card-state";
import { aiEnabled } from "@/lib/llm";
import { isKind } from "@/lib/taxonomy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 60;

/** Once per process: re-enrich X dumps whose render predates the current
 *  output (or was never rendered) so old saves pick up the latest shape. */
let xRenderRefreshQueued = false;
/** Hard cap on a single page — "load more" pages forward with offset, so nothing needs more. */
const MAX_LIMIT = 500;

function intParam(value: string | null, fallback: number, max: number) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? Math.min(n, max) : fallback;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const kind = sp.get("kind");
  const topic = sp.get("topic");
  const limit = intParam(sp.get("limit"), PAGE_SIZE, MAX_LIMIT) || PAGE_SIZE;
  const offset = intParam(sp.get("offset"), 0, Number.MAX_SAFE_INTEGER);
  if (offset === 0 && !xRenderRefreshQueued) {
    xRenderRefreshQueued = true;
    // Parking them 'processing' before listing makes this response reflect that
    // fresh renders are on the way — an open feed polls until they land.
    const stale = staleXRenderIds();
    for (const { id } of stale) updateDump(id, { status: "processing" });
    for (const { id, status } of stale) after(() => refreshXRender(id, status));
  }
  // A run lost to a restart would otherwise leave its card loading forever.
  if (offset === 0) failStaleProcessing(STALE_PROCESSING_MS, isEnriching);
  const rows = listDumps({
    q: sp.get("q"),
    kind: isKind(kind) ? kind : null,
    // Raw string is safe (bound param) and a stale/deleted id correctly matches nothing.
    topic,
    limit: limit + 1,
    offset,
  });
  // The three aggregate scans only matter to the header/nav — skip them for paged fetches.
  const wantCounts = offset === 0 || sp.get("counts") === "1";
  return NextResponse.json({
    items: rows.slice(0, limit),
    hasMore: rows.length > limit,
    ...(wantCounts ? { counts: counts(), topics: listTopics() } : {}),
    ai: aiEnabled(),
  });
}

export async function POST(req: NextRequest) {
  try {
    let dump;
    if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      const text = (form.get("text") as string | null) ?? "";
      dump = file instanceof File && file.size > 0 ? await createFromFile(file, text) : createFromText(text);
    } else {
      const body = await req.json().catch(() => ({}));
      dump = createFromText(String(body.text ?? ""), { title: body.title, description: body.description, imageUrl: body.imageUrl });
    }
    if (!("duplicate" in dump && dump.duplicate) || ("resync" in dump && dump.resync)) after(() => enrichDump(dump.id));
    return NextResponse.json(dump, { status: 201 });
  } catch (err) {
    if (err instanceof InputError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
