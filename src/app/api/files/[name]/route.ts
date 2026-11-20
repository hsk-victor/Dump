import path from "node:path";
import { getDump } from "@/lib/db";
import { fileStorage } from "@/lib/storage";

export const runtime = "nodejs";

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif", mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime" };

export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const ext = path.extname(name).slice(1);
  if (ext === "attachment") {
    const attachment = getDump(name.slice(0, -".attachment".length))?.attachment;
    if (!attachment || attachment.url !== `/api/files/${name}`) return new Response("Not found", { status: 404 });
    try {
      const fileName = encodeURIComponent(attachment.name.toWellFormed()).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16)}`);
      return new Response(await fileStorage.openReadStream(name), { headers: {
        "content-type": "application/octet-stream",
        "content-disposition": `attachment; filename*=UTF-8''${fileName}`,
        "content-length": String(attachment.size),
        "x-content-type-options": "nosniff",
      } });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  }
  const type = Object.hasOwn(MIME, ext) ? MIME[ext] : undefined;
  if (!type) return new Response("Not found", { status: 404 });
  try {
    const { size } = await fileStorage.stat(name);
    const range = _req.headers.get("range");
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      const start = match?.[1] ? Number(match[1]) : Math.max(0, size - Number(match?.[2]));
      const end = match?.[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
      if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(start) || start < 0 || start > end) {
        return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
      }
      return new Response(await fileStorage.openReadStream(name, { start, end }), { status: 206, headers: {
        "content-type": type, "accept-ranges": "bytes", "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1),
      } });
    }
    return new Response(await fileStorage.openReadStream(name), { headers: { "content-type": type, "accept-ranges": "bytes", "content-length": String(size), "cache-control": "public, max-age=31536000, immutable" } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
