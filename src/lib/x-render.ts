import { loadXeet, type Xeet } from "@xeet/core/node";
import { whatwgHost } from "@xeet/core/resolve";
import type { Post } from "@xeet/core";
import type { XRender } from "./db";
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

/** Media and avatar bytes are downloaded separately by the existing pipeline —
 *  the snapshot keeps structure only, not duplicated base64 blobs. */
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
  const { post } = await renderer.resolve(url, { media: false }, whatwgHost({ fetch: guardedFetch }));
  // Video/GIF posts keep the card's inline player, so posters don't belong in
  // the snapshot too — keep only photo entries.
  if (post.media?.some((m) => m.kind !== "image")) {
    const photos = post.media.filter((m) => m.kind === "image");
    post.media = photos.length ? photos : undefined;
  }
  slim(post);
  const report = renderer.explain(post, { width: 390, expanded: false, surface: "web-timeline" });
  return {
    v: 2,
    post,
    entities: report.entities,
    hidden: report.hidden,
    showMore: report.text.hasShowMore,
    attachment: report.attachment,
  };
}
