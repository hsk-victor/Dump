import { type NextRequest } from "next/server";
import { getDump } from "@/lib/db";
import { fetchWithTimeout } from "@/lib/extract";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const video = getDump((await params).id)?.videoUrl;
  if (!video) return new Response("Not found", { status: 404 });
  const url = new URL(video);
  if (url.protocol !== "https:" || url.hostname !== "video.twimg.com") return new Response("Unsupported video", { status: 400 });
  try {
    const range = req.headers.get("range");
    const upstream = await fetchWithTimeout(video, { headers: range ? { range } : {}, headersOnlyTimeout: true });
    if (!upstream.ok) {
      await upstream.body?.cancel();
      return new Response("Video unavailable", { status: upstream.status === 416 ? 416 : 502 });
    }
    const headers = new Headers({ "Content-Type": "video/mp4", "Cache-Control": "private, max-age=3600" });
    for (const name of ["content-length", "content-range", "accept-ranges"]) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch {
    return new Response("Video unavailable", { status: 502 });
  }
}
