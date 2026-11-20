import { createHash } from "node:crypto";
import { loadXeet, type Xeet } from "@xeet/core/node";
import { whatwgHost } from "@xeet/core/resolve";
import type { XRender } from "./db";
import { fetchWithTimeout } from "./extract";
import { fileStorage } from "./storage";
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

/**
 * Renders an X post the way x.com draws it (xeet, WASM — no browser) and stores
 * one PNG per theme under uploads. Null when the post can't be resolved —
 * deleted/protected tweets keep the regular card layout as the fallback.
 */
export async function renderXPostImage(url: string): Promise<XRender | null> {
  const id = xStatusId(url);
  if (!id) return null;
  const renderer = await xeet();
  const { post } = await renderer.resolve(url, { media: true }, whatwgHost({ fetch: guardedFetch }));
  // Video/GIF posts keep the card's inline player, so posters don't belong in
  // the still image too — keep only photos inside the render.
  if (post.media?.some((m) => m.kind !== "image")) {
    const photos = post.media.filter((m) => m.kind === "image");
    post.media = photos.length ? photos : undefined;
  }
  // expanded: false keeps X's own "Show more" clamp so note tweets stay card-sized.
  const options = { width: 390, dpr: 2, expanded: false } as const;
  const [light, dark] = [
    renderer.render(post, { ...options, theme: "light" }),
    renderer.render(post, { ...options, theme: "dark" }),
  ];
  // /api/files is immutable-cached, so the content hash in the name gives each new
  // render a fresh URL. Older renders for the same post stay on disk on purpose:
  // a differently-shaped saved URL can share the post id and still points at them.
  const tag = createHash("sha256").update(light.png).update(dark.png).digest("hex").slice(0, 8);
  const [lightUrl, darkUrl] = await Promise.all([
    fileStorage.put(`xeet-${id}-light-${tag}.png`, light.png),
    fileStorage.put(`xeet-${id}-dark-${tag}.png`, dark.png),
  ]);
  return { light: lightUrl, dark: darkUrl };
}
