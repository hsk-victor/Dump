import { createHash, randomUUID } from "node:crypto";
import { getDump, updateDump, type Dump } from "./db";
import { fetchWithTimeout } from "./extract";
import { fileStorage, storedFileName } from "./storage";

const VIDEO_TIMEOUT = 300_000;
const jobs = new Map<string, { controller: AbortController; promise: Promise<void> }>();

export async function downloadVideo(url: string, maxBytes = 300 * 1024 * 1024, timeoutMs = VIDEO_TIMEOUT, signal?: AbortSignal): Promise<Buffer> {
  const response = await fetchWithTimeout(url, { timeoutMs, ...(signal ? { signal } : {}) });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error(`Video download failed (${response.status})`);
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
      signal?.throwIfAborted();
      size += value.length;
      if (size > maxBytes) throw new Error("Video too large");
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally {
    await reader.cancel().catch(() => {});
  }
}

export function isSavingVideo(id: string): boolean {
  return jobs.has(id);
}

export function cancelVideoCopy(id: string): void {
  jobs.get(id)?.controller.abort();
  jobs.delete(id);
  if (getDump(id)) updateDump(id, { keepVideo: false, videoCopy: null });
}

export function saveVideoCopy(id: string): Promise<void> {
  const running = jobs.get(id);
  if (running) return running.promise;
  const dump = getDump(id);
  if (!dump?.keepVideo || !dump.videoUrl || dump.mediaArchive[dump.videoUrl]) return Promise.resolve();
  const attempt = randomUUID();
  const controller = new AbortController();
  updateDump(id, { videoCopy: { state: "pending", startedAt: Date.now(), attempt } });
  const promise = (async () => {
    let local: string | undefined;
    try {
      if (!/^https?:\/\//i.test(dump.videoUrl!) || dump.sourceState === "unavailable" || dump.sourceState === "unreachable") throw new Error("Original not reachable");
      const data = await downloadVideo(dump.videoUrl!, 300 * 1024 * 1024, VIDEO_TIMEOUT, controller.signal);
      controller.signal.throwIfAborted();
      const ext = new URL(dump.videoUrl!).pathname.match(/\.(mp4|webm|mov)$/i)?.[1].toLowerCase() ?? "mp4";
      const hash = createHash("sha256").update(data).digest("hex").slice(0, 12);
      local = await fileStorage.put(`${id}-a-${hash}.${ext}`, data);
      const current = getDump(id);
      if (current?.keepVideo && current.videoUrl === dump.videoUrl && current.videoCopy?.attempt === attempt) {
        updateDump(id, { mediaArchive: { ...current.mediaArchive, [dump.videoUrl!]: local }, videoCopy: null });
      } else if (!current || !Object.values(current.mediaArchive).includes(local)) {
        await fileStorage.remove(storedFileName(local)!);
        if (current?.videoCopy?.attempt === attempt) updateDump(id, { videoCopy: null });
      }
    } catch (error) {
      const current = getDump(id);
      if (current?.keepVideo && current.videoCopy?.attempt === attempt && !controller.signal.aborted) {
        const message = error instanceof Error && /^(Video (download failed \(\d+\)|too large)|Original not reachable)$/.test(error.message)
          ? error.message : error instanceof Error && error.name === "TimeoutError" ? "Video download timed out" : "Video download failed";
        updateDump(id, { videoCopy: { state: "failed", startedAt: Date.now(), error: message } });
      }
    }
  })();
  jobs.set(id, { controller, promise });
  void promise.finally(() => { if (jobs.get(id)?.promise === promise) jobs.delete(id); }).catch(() => {});
  return promise;
}

export async function reconcileVideoCopy(dump: Dump): Promise<Dump> {
  if (dump.videoCopy?.state === "pending" && Date.now() - dump.videoCopy.startedAt > VIDEO_TIMEOUT + 30_000) {
    cancelVideoCopy(dump.id);
    return updateDump(dump.id, { keepVideo: true, videoCopy: { state: "failed", startedAt: Date.now(), error: "Video download interrupted or timed out" } })!;
  }
  const local = dump.videoUrl?.startsWith("/api/files/") ? dump.videoUrl : dump.videoUrl ? dump.mediaArchive[dump.videoUrl] : null;
  const name = storedFileName(local);
  if (!name) return dump;
  try {
    await fileStorage.stat(name);
    return getDump(dump.id) ?? dump;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") return dump;
    return markVideoMissing(dump.id, local!) ?? dump;
  }
}

export function markVideoMissing(id: string, local: string): Dump | null {
  const dump = getDump(id);
  if (!dump?.videoUrl || (dump.mediaArchive[dump.videoUrl] !== local && dump.videoUrl !== local)) return dump;
  const mediaArchive = { ...dump.mediaArchive };
  delete mediaArchive[dump.videoUrl];
  return updateDump(id, { mediaArchive, keepVideo: false, videoCopy: { state: "missing", startedAt: Date.now() } });
}
