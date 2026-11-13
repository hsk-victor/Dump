import { after, type NextRequest } from "next/server";
import { createFromText, InputError } from "@/lib/create";
import { enrichDump } from "@/lib/enrich";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function page(body: string, status = 200) {
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Dump</title>
<body style="font:15px system-ui;display:grid;place-items:center;height:100vh;margin:0;background:#fafaf9;color:#1c1917">
<div style="text-align:center">${body}<p><a href="/" style="color:#78716c">Open Dump</a></p></div>
<script>setTimeout(()=>{ if (window.opener) window.close(); }, 1200)</script></body>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

/**
 * Target of the bookmarklet: /dump?url=...&title=...&desc=...&img=... saves the page and closes the
 * popup. The client sends the page's og:description and og:image because a logged-in tab sees a
 * caption and thumbnail that a server-side fetch never will (Instagram/TikTok wall them off).
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const text = [sp.get("url"), sp.get("text")].filter(Boolean).join(" ");
  try {
    const dump = createFromText(text, { title: sp.get("title"), description: sp.get("desc"), imageUrl: sp.get("img") });
    if (!("duplicate" in dump && dump.duplicate)) after(() => enrichDump(dump.id));
    return page(`<h2 style="margin:0 0 4px">Dumped.</h2><p style="color:#78716c;margin:0">Filing it for you…</p>`);
  } catch (err) {
    if (err instanceof InputError) return page(`<h2>Nothing to dump</h2>`, 400);
    throw err;
  }
}
