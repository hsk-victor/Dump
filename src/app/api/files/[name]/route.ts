import path from "node:path";
import { fileStorage } from "@/lib/storage";

export const runtime = "nodejs";

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif" };

export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const ext = path.extname(name).slice(1);
  const type = Object.hasOwn(MIME, ext) ? MIME[ext] : undefined;
  if (!type) return new Response("Not found", { status: 404 });
  try {
    const data = await fileStorage.read(name);
    return new Response(new Uint8Array(data), { headers: { "content-type": type, "cache-control": "public, max-age=31536000, immutable" } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
