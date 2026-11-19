import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { getDump, listDumps, updateDump, type Dump } from "./db";
import { fetchImage, fetchWithTimeout } from "./extract";
import { fileStorage, storedFileName } from "./storage";

export const posterKey = (url: string) => `poster:${url}`;
const remote = (url: string | null | undefined): url is string => !!url && /^https?:\/\//i.test(url);
const jobs = new Map<string, Promise<void>>();

export async function downloadVideo(url: string, maxBytes = 300 * 1024 * 1024, timeoutMs = 300_000): Promise<Buffer> {
  const response = await fetchWithTimeout(url, { timeoutMs });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error("Video download failed");
  }
  if (Number(response.headers.get("content-length")) > maxBytes) {
    await response.body.cancel();
    throw new Error("Video too large");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) throw new Error("Video too large");
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally {
    await reader.cancel().catch(() => {});
  }
}

async function frame(bytes: Buffer): Promise<Buffer> {
  const format = bytes.subarray(4, 8).toString() === "ftyp" ? "mov" : bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) ? "matroska" : null;
  if (!format) throw new Error("Unsupported video container");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dump-frame-"));
  try {
    const input = path.join(dir, "input");
    await fs.writeFile(input, bytes);
    for (const second of [1, 0]) {
      try {
        return await new Promise<Buffer>((resolve, reject) => {
          const child = spawn("ffmpeg", ["-v", "error", "-protocol_whitelist", "file,pipe", "-f", format, "-ss", String(second), "-i", input, "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "pipe:1"], { timeout: 30_000 });
          const chunks: Buffer[] = [];
          child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
          child.stderr.resume();
          child.on("error", reject);
          child.on("close", (code) => {
            const result = Buffer.concat(chunks);
            if (code === 0 && result.length) resolve(result);
            else reject(new Error("No frame"));
          });
        });
      } catch { /* Try the start of short clips. */ }
    }
    throw new Error("No frame");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

export function archiveDump(id: string): Promise<void> {
  const previous = jobs.get(id) ?? Promise.resolve();
  const job = previous.then(() => runArchive(id));
  jobs.set(id, job);
  void job.finally(() => { if (jobs.get(id) === job) jobs.delete(id); }).catch(() => {});
  return job;
}

async function runArchive(id: string): Promise<void> {
  const dump = getDump(id);
  if (!dump) return;
  const added: Record<string, string> = {};
  const store = async (key: string, bytes: Buffer, ext = "webp") => {
    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
    added[key] = await fileStorage.put(`${id}-a-${hash}.${ext}`, bytes);
  };
  const image = async (key: string, bytes: Buffer | null) => {
    if (bytes) await store(key, await sharp(bytes).rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).webp({ quality: 80 }).toBuffer());
  };
  const sources = new Set([dump.imageUrl, ...dump.imageUrls, dump.videoPosterUrl].filter(remote));
  for (const url of sources) {
    if (dump.mediaArchive[url]) continue;
    try { await image(url, await fetchImage(url)); } catch { /* Keep independent successes. */ }
  }
  if (remote(dump.videoUrl)) {
    const url = dump.videoUrl;
    let bytes: Buffer | undefined;
    const video = async () => bytes ??= await downloadVideo(url, (dump.keepVideo ? 300 : 64) * 1024 * 1024, dump.keepVideo ? 300_000 : 60_000);
    if (!dump.videoPosterUrl && !dump.mediaArchive[posterKey(url)]) {
      try { await image(posterKey(url), await frame(await video())); } catch { /* Posters are best effort. */ }
    }
    if (dump.keepVideo && !dump.mediaArchive[url]) {
      try {
        const ext = new URL(url).pathname.match(/\.(mp4|webm|mov)$/i)?.[1].toLowerCase() ?? "mp4";
        await store(url, await video(), ext);
      } catch { /* Full copies are best effort. */ }
    }
  }
  const current = getDump(id);
  if (current) {
    const discarded: string[] = [];
    if (!current.keepVideo && dump.videoUrl && added[dump.videoUrl]) {
      discarded.push(added[dump.videoUrl]);
      delete added[dump.videoUrl];
    }
    updateDump(id, { mediaArchive: { ...current.mediaArchive, ...added } });
    await removeArchiveFiles(discarded);
  } else await removeArchiveFiles(Object.values(added));
}

export async function removeArchiveFiles(urls: string[]): Promise<void> {
  await Promise.all([...new Set(urls)].map(async (url) => {
    const name = storedFileName(url);
    if (name) await fileStorage.remove(name);
  }));
}

function missing(dump: Dump): boolean {
  return [dump.imageUrl, ...dump.imageUrls, dump.videoPosterUrl,
    !dump.videoPosterUrl && remote(dump.videoUrl) ? posterKey(dump.videoUrl) : null,
    dump.keepVideo ? dump.videoUrl : null,
  ].some((url) => url && (/^https?:\/\//i.test(url) || url.startsWith("poster:")) && !dump.mediaArchive[url]);
}

export async function backfillArchive({ limit = Infinity }: { limit?: number } = {}): Promise<number> {
  const dumps = listDumps({ limit: -1 }).filter(missing).slice(0, Math.max(0, limit));
  for (const dump of dumps) await archiveDump(dump.id);
  return dumps.length;
}
