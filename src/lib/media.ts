import type { Dump } from "./db";

export function mediaSources(dump: Pick<Dump, "mediaArchive" | "sourceState">, url: string): string[] {
  const local = dump.mediaArchive?.[url];
  return [...new Set((dump.sourceState === "unavailable" ? [local, url] : [url, local]).filter((s): s is string => !!s))];
}

export function videoPoster(dump: Dump): string | undefined {
  return dump.videoPosterUrl ? mediaSources(dump, dump.videoPosterUrl)[0] : dump.videoUrl ? dump.mediaArchive?.[`poster:${dump.videoUrl}`] : undefined;
}
