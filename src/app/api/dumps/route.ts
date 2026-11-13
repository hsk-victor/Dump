import { after, NextResponse, type NextRequest } from "next/server";
import { counts, listDumps } from "@/lib/db";
import { createFromFile, createFromText, InputError } from "@/lib/create";
import { enrichDump } from "@/lib/enrich";
import { isKind, isTopic } from "@/lib/taxonomy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const kind = sp.get("kind");
  const topic = sp.get("topic");
  const items = listDumps({
    q: sp.get("q"),
    kind: isKind(kind) ? kind : null,
    topic: isTopic(topic) ? topic : null,
  });
  return NextResponse.json({ items, counts: counts() });
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
      dump = createFromText(String(body.text ?? ""), body.title);
    }
    if (!("duplicate" in dump && dump.duplicate)) after(() => enrichDump(dump.id));
    return NextResponse.json(dump, { status: 201 });
  } catch (err) {
    if (err instanceof InputError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
