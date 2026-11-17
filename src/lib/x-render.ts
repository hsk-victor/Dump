import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { loadXeet, type Xeet } from "@xeet/core/node";
import { whatwgHost } from "@xeet/core/resolve";
import type { Post } from "@xeet/core";
import { UPLOAD_DIR, type XRender } from "./db";
import { fetchWithTimeout } from "./extract";
import { xStatusId } from "./x-post";

/** The resolver crawls a post's links and card images — route it through the same
 *  private-network guard as page fetches, or a post could reach internal hosts. */
const guardedFetch: typeof fetch = (input, init) =>
  fetchWithTimeout(typeof input === "string" || input instanceof URL ? String(input) : input.url, {
    headers: init?.headers ? Object.fromEntries(new Headers(init.headers)) : undefined,
  });

let xeetPromise: Promise<Xeet> | null = null;

/** One WASM instance per process; font packs register on first use. */
function xeet(): Promise<Xeet> {
  return (xeetPromise ??= loadXeet());
}

/** Photo bytes are persisted as immutable content-addressed files — the snapshot
 *  then renders even when extraction hotlinks go stale or were never captured.
 *  Avatars/link-card thumbs stay hot-linked (tiny, replaceable). */
async function persistPhotos(post: Post): Promise<string[] | undefined> {
  // All or nothing: a partial set would mask the remaining extraction images,
  // so an incomplete download falls back to those URLs entirely.
  const imgs = (post.media ?? []).filter((m) => m.kind === "image");
  const datas = imgs.map((m) => m.data).filter((d): d is string => !!d);
  if (!imgs.length || datas.length !== imgs.length) return undefined;
  const photos: string[] = [];
  for (const data of datas) {
    const bytes = Buffer.from(data, "base64");
    const ext = bytes[0] === 0x89 ? "png" : bytes[0] === 0x52 ? "webp" : "jpg";
    const name = `xmedia-${crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 24)}.${ext}`;
    await fs.writeFile(path.join(UPLOAD_DIR, name), bytes);
    photos.push(`/api/files/${name}`);
  }
  return photos.length ? photos : undefined;
}

/** Media and avatar base64 are dropped from the snapshot itself — photos were
 *  already persisted to disk, and avatars are hot-linked by the card. */
function slim(post: Post) {
  if (post.author) {
    delete post.author.avatar;
    if (post.author.affiliate) delete post.author.affiliate.badge;
  }
  for (const m of post.media ?? []) delete m.data;
  for (const link of Object.values(post.links ?? {})) if (link.image) delete link.image.data;
  if (post.quote) slim(post.quote);
}

/**
 * Resolves an X post and snapshots it as structured data — the card rebuilds it
 * as live DOM (real links, selectable text, a working "Show more"). xeet's
 * explain() supplies X's own entity ranges, hidden ranges and truncation rules
 * without rasterizing anything. Null when the post can't be resolved —
 * deleted/protected tweets keep the regular card layout as the fallback.
 */
export async function resolveXPost(url: string): Promise<XRender | null> {
  const id = xStatusId(url);
  if (!id) return null;
  const renderer = await xeet();
  const { post } = await renderer.resolve(url, { media: true }, whatwgHost({ fetch: guardedFetch }));
  // Video/GIF posts keep the card's inline player, so posters don't belong in
  // the snapshot too — keep only photo entries.
  if (post.media?.some((m) => m.kind !== "image")) {
    const photos = post.media.filter((m) => m.kind === "image");
    post.media = photos.length ? photos : undefined;
  }
  const photos = await persistPhotos(post);
  slim(post);
  const report = renderer.explain(post, { width: 390, expanded: false, surface: "web-timeline" });
  return {
    v: 3,
    post,
    entities: report.entities,
    hidden: report.hidden,
    showMore: report.text.hasShowMore,
    attachment: report.attachment,
    photos,
  };
}
