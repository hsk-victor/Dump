import fs from "node:fs/promises";
import path from "node:path";
import { loadXeet, type Xeet } from "@xeet/core/node";
import { whatwgHost } from "@xeet/core/resolve";
import { UPLOAD_DIR, type XRender } from "./db";
import { xStatusId } from "./x-post";

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
  const { post } = await renderer.resolve(url, { media: true }, whatwgHost());
  // Video/GIF posts keep the card's inline player, so the poster doesn't
  // belong inside the still image too — render them as text posts.
  if (post.media?.some((m) => m.kind !== "image")) delete post.media;
  const options = { width: 390, dpr: 2, expanded: true } as const;
  const [light, dark] = [
    renderer.render(post, { ...options, theme: "light" }),
    renderer.render(post, { ...options, theme: "dark" }),
  ];
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  const names = { light: `xeet-${id}-light.png`, dark: `xeet-${id}-dark.png` };
  await Promise.all([
    fs.writeFile(path.join(UPLOAD_DIR, names.light), light.png),
    fs.writeFile(path.join(UPLOAD_DIR, names.dark), dark.png),
  ]);
  return { light: `/api/files/${names.light}`, dark: `/api/files/${names.dark}` };
}
