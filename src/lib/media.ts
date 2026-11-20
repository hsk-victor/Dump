import type { Dump } from "./db";
import { hasLocalVideo } from "./card-state";

export function videoCopyAction(dump: Dump): "Save video copy" | "Remove saved video" | null {
  if (dump.videoCopy?.state === "pending") return null;
  if (hasLocalVideo(dump)) return "Remove saved video";
  if (dump.sourceState === "unavailable" || dump.sourceState === "unreachable" || (dump.videoCopy?.state === "missing" && dump.sourceState !== "reachable")) return null;
  return dump.videoUrl && /^https?:\/\//i.test(dump.videoUrl) ? "Save video copy" : null;
}

export function videoSources(dump: Dump, src: string): string[] {
  if (!dump.videoUrl) return [src];
  const sources = mediaSources(dump, dump.videoUrl).map((url) => url === dump.videoUrl ? src : url);
  const local = sources.some((url) => url.startsWith("/api/files/"));
  return sources.filter((url) => url.startsWith("/api/files/") || (local ? dump.sourceState === "reachable" : dump.sourceState !== "unavailable" && dump.sourceState !== "unreachable"));
}

export function exhaustedVideoAsset(sources: string[], failed: ReadonlySet<string>): string | null {
  return sources.every((url) => failed.has(url)) ? sources.find((url) => url.startsWith("/api/files/")) ?? null : null;
}

export function mediaSources(dump: Pick<Dump, "mediaArchive" | "sourceState">, url: string): string[] {
  const local = dump.mediaArchive?.[url];
  return [...new Set((dump.sourceState === "unavailable" ? [local, url] : [url, local]).filter((s): s is string => !!s))];
}

export function videoPoster(dump: Dump): string | undefined {
  return dump.videoPosterUrl ? mediaSources(dump, dump.videoPosterUrl)[0] : dump.videoUrl ? dump.mediaArchive?.[`poster:${dump.videoUrl}`] : undefined;
}
