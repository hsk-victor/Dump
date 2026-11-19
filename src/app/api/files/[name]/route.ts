import path from "node:path";
import { fileStorage } from "@/lib/storage";

export const runtime = "nodejs";

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif", mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime" };

export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const ext = path.extname(name).slice(1);
  const type = Object.hasOwn(MIME, ext) ? MIME[ext] : undefined;
  if (!type) return new Response("Not found", { status: 404 });
  try {
    const data = await fileStorage.read(name);
    const range = _req.headers.get("range");
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      const start = match?.[1] ? Number(match[1]) : Math.max(0, data.length - Number(match?.[2]));
      const end = match?.[1] && match[2] ? Math.min(Number(match[2]), data.length - 1) : data.length - 1;
      if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(start) || start < 0 || start > end) {
        return new Response(null, { status: 416, headers: { "content-range": `bytes */${data.length}` } });
      }
      return new Response(new Uint8Array(data.subarray(start, end + 1)), { status: 206, headers: {
        "content-type": type, "accept-ranges": "bytes", "content-range": `bytes ${start}-${end}/${data.length}`, "content-length": String(end - start + 1),
      } });
    }
    return new Response(new Uint8Array(data), { headers: { "content-type": type, "accept-ranges": "bytes", "content-length": String(data.length), "cache-control": "public, max-age=31536000, immutable" } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
