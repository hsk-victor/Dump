import { createHash } from "node:crypto";
import path from "node:path";
import sharp from "sharp";
import { fetchImage } from "./extract";
import { fileStorage, storedFileName } from "./storage";

/** Query params CDNs use to sign a URL that stops working after a deadline (TikTok, Instagram/Facebook, S3, CloudFront). */
const EXPIRY_PARAMS = [["x-expires"], ["x-signature"], ["x-amz-expires"], ["x-amz-signature"], ["oe", "oh"], ["expires", "signature"]];

export function isExpiringUrl(url: string | null | undefined): boolean {
  if (!url || !/^https?:\/\//i.test(url)) return false;
  try {
    const keys = new Set([...new URL(url).searchParams.keys()].map((k) => k.toLowerCase()));
    return EXPIRY_PARAMS.some((set) => set.every((k) => keys.has(k)));
  } catch {
    return false;
  }
}

const KEEP_FORMATS: Record<string, string> = { jpeg: "jpg", png: "png", gif: "gif", webp: "webp", avif: "avif" };

/**
 * Downloads a remote image into uploads so the card outlives the source's signed URL.
 * Named by dump id + content hash: re-saving the same image reuses the file, and deleting
 * the dump removes only its own copy. Null when the image can't be fetched or decoded.
 */
export async function storeRemoteImage(dumpId: string, url: string): Promise<string | null> {
  const bytes = await fetchImage(url);
  if (!bytes?.length) return null;
  let data: Buffer = bytes;
  let ext: string;
  try {
    const { format } = await sharp(bytes, { animated: true }).metadata();
    ext = (format && KEEP_FORMATS[format]) ?? "webp";
    if (!format || !KEEP_FORMATS[format]) data = await sharp(bytes).webp({ quality: 85 }).toBuffer();
  } catch {
    return null;
  }
  const name = `${path.basename(dumpId)}-thumb-${createHash("sha256").update(data).digest("hex").slice(0, 12)}.${ext}`;
  return fileStorage.put(name, data);
}

export function isStoredThumb(dumpId: string, url: string | null | undefined): url is string {
  return !!url?.startsWith(`/api/files/${path.basename(dumpId)}-thumb-`);
}

export async function removeStoredThumb(url: string): Promise<void> {
  const name = storedFileName(url);
  if (name) await fileStorage.remove(name);
}

/** Every thumbnail copy kept for a dump, including ones a re-fetch has since replaced. */
export async function removeStoredThumbs(dumpId: string): Promise<void> {
  const names = await fileStorage.list(`${path.basename(dumpId)}-thumb-`);
  await Promise.all(names.map((n) => fileStorage.remove(n)));
}
