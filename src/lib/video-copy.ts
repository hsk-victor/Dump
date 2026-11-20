import type { Dump } from "./db";

type VideoCopyStatus = Pick<Dump, "keepVideo" | "videoUrl" | "mediaArchive"> & { archivePending?: boolean };

export async function setVideoCopy(id: string, keepVideo: boolean, onUpdated: () => void, onFailure: () => void = () => {}): Promise<void> {
  try {
    const url = `/api/dumps/${id}`;
    const response = await fetch(url, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ keepVideo }) });
    if (!response.ok) { onFailure(); return; }
    let dump: VideoCopyStatus = await response.json();
    onUpdated();
    for (let attempt = 0; keepVideo && dump.archivePending && attempt < 600; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const status = await fetch(url, { cache: "no-store" });
      if (!status.ok) { if (status.status !== 404) onFailure(); return; }
      dump = await status.json();
      if (!dump.archivePending || !dump.keepVideo || (dump.videoUrl && dump.mediaArchive[dump.videoUrl])) {
        onUpdated();
        return;
      }
    }
    if (keepVideo && dump.archivePending) onFailure();
  } catch { onFailure(); }
}
