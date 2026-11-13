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

export type Created = Dump & { duplicate?: boolean };

/**
 * Saves raw text (a link, a link + comment, or a note) immediately; enrichment happens later.
 * Dumping a link that's already saved just moves it back to the top instead of duplicating it.
 */
export function createFromText(raw: string, title?: string | null): Created {
  const parsed = parseInput(raw);
  if (parsed.type === "url") {
    const existing = findByUrl(parsed.url);
    if (existing) {
      if (parsed.note && parsed.note !== existing.note) {
        updateDump(existing.id, { note: existing.note ? `${existing.note}\n${parsed.note}` : parsed.note });
      }
      return { ...bumpDump(existing.id)!, duplicate: true };
    }
    return createDump({
      kind: kindFromUrl(parsed.url) ?? "link",
      url: parsed.url,
      domain: domainOf(parsed.url),
      title: title?.trim() || null,
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
