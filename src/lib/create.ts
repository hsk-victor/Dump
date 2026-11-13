import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { domainOf, kindFromUrl, parseInput } from "./detect";
import { bumpDump, createDump, findByUrl, updateDump, UPLOAD_DIR, type Dump } from "./db";
import { noteTitle } from "./enrich";

export class InputError extends Error {}

const IMAGE_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
};
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export type Created = Dump & { duplicate?: boolean; /** True when a duplicate learned new metadata worth re-enriching for. */ resync?: boolean };

export interface CreateOptions {
  title?: string | null;
  description?: string | null;
  imageUrl?: string | null;
}

/** Only http(s) thumbnails are kept; the URL is fetched through the SSRF guard during enrichment. */
function safeImageUrl(u: string | null | undefined): string | null {
  return u && /^https?:\/\/\S+$/i.test(u.trim()) ? u.trim().slice(0, 2000) : null;
}

/**
 * Saves raw text (a link, a link + comment, or a note) immediately; enrichment happens later.
 * Dumping a link that's already saved just moves it back to the top instead of duplicating it.
 * `opts` carries metadata the client saw (the bookmarklet sends the page's og:description/og:image,
 * which a server-side fetch often can't get — e.g. Instagram and TikTok serve login walls to bots).
 */
export function createFromText(raw: string, opts?: CreateOptions | string | null): Created {
  const o: CreateOptions = typeof opts === "string" || opts == null ? { title: opts } : opts;
  const title = o.title?.trim() || null;
  const description = o.description?.replace(/\s+/g, " ").trim().slice(0, 2000) || null;
  const imageUrl = safeImageUrl(o.imageUrl);
  const parsed = parseInput(raw);
  if (parsed.type === "url") {
    const existing = findByUrl(parsed.url);
    if (existing) {
      const patch: Partial<Dump> = {};
      if (parsed.note && parsed.note !== existing.note) {
        patch.note = existing.note ? `${existing.note}\n${parsed.note}` : parsed.note;
      }
      // Fill in metadata the first save lacked (e.g. a link dumped bare, then re-dumped
      // through the bookmarklet, which sends the og data a server fetch never sees).
      if (!existing.title && title) patch.title = title;
      if (!existing.description && description) patch.description = description;
      if (!existing.imageUrl && imageUrl) patch.imageUrl = imageUrl;
      const resync = !!(patch.title || patch.description || patch.imageUrl);
      if (resync) patch.status = "processing";
      if (Object.keys(patch).length) updateDump(existing.id, patch);
      return { ...bumpDump(existing.id)!, duplicate: true, resync };
    }
    return createDump({
      kind: kindFromUrl(parsed.url) ?? "link",
      url: parsed.url,
      domain: domainOf(parsed.url),
      title,
      description,
      imageUrl,
      note: parsed.note,
    });
  }
  if (!parsed.text) throw new InputError("Nothing to dump");
  return createDump({ kind: "note", title: noteTitle(parsed.text), content: parsed.text.slice(0, 50000) });
}

export async function createFromFile(file: File, note?: string | null): Promise<Dump> {
  const ext = IMAGE_TYPES[file.type];
  if (!ext) throw new InputError("Only PNG, JPEG, GIF, WebP and AVIF images are supported for now");
  if (file.size > MAX_UPLOAD_BYTES) throw new InputError("Image is larger than 15 MB");

  const id = randomUUID();
  const name = `${id}.${ext}`;
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  await fs.writeFile(path.join(UPLOAD_DIR, name), Buffer.from(await file.arrayBuffer()));

  const baseName = file.name && file.name !== "image.png" ? file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ") : null;
  return createDump(
    {
      kind: "image",
      title: baseName || (note ? noteTitle(note) : "Image"),
      note: note?.trim() || null,
      imageUrl: `/api/files/${name}`,
    },
    id,
  );
}
