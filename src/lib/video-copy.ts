import type { Dump } from "./db";

type VideoCopyStatus = Pick<Dump, "keepVideo" | "videoUrl" | "mediaArchive"> & { archivePending?: boolean };

export async function setVideoCopy(id: string, keepVideo: boolean, onUpdated: () => void): Promise<void> {
  try {
    const url = `/api/dumps/${id}`;
    const response = await fetch(url, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ keepVideo }) });
    if (!response.ok) return;
    let dump: VideoCopyStatus = await response.json();
    onUpdated();
    for (let attempt = 0; keepVideo && dump.archivePending && attempt < 600; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const status = await fetch(url, { cache: "no-store" });
      if (!status.ok) return;
      dump = await status.json();
      if (!dump.archivePending || !dump.keepVideo || (dump.videoUrl && dump.mediaArchive[dump.videoUrl])) {
        onUpdated();
        return;
      }
    }
  } catch { /* Leave the current card intact if the request fails. */ }
}
