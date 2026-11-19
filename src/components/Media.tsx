"use client";

import { useState, type ComponentProps } from "react";
import type { Dump } from "@/lib/db";
import { mediaSources } from "@/lib/media";

export function ArchiveImage({ dump, src, onError, ...props }: ComponentProps<"img"> & { dump: Dump }) {
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const sources = typeof src === "string" ? mediaSources(dump, src) : [];
  const current = sources.find((url) => !failed.has(url));
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  return <img {...props} src={current ?? src} onError={(event) => {
    if (current && sources.some((url) => url !== current && !failed.has(url))) setFailed(new Set([...failed, current]));
    else onError?.(event);
  }} />;
}
