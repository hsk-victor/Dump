"use client";

import { useState } from "react";
import type { Dump } from "@/lib/db";
import { TOPICS, kindMeta, topicMeta } from "@/lib/taxonomy";
import { timeAgo } from "@/lib/format";

interface Props {
  dump: Dump;
  onTopic: (id: string, topic: string) => void;
  onDelete: (id: string) => void;
  onRetry: (id: string) => void;
  onTag: (tag: string) => void;
}

export default function DumpCard({ dump, onTopic, onDelete, onRetry, onTag }: Props) {
  const [imgFailed, setImgFailed] = useState(false);
  const topic = topicMeta(dump.topic);
  const processing = dump.status === "processing";
  const body = dump.summary ?? dump.description ?? (dump.kind === "note" ? dump.content : null);
  const showBody = body && body !== dump.title;
  const href = dump.url ?? (dump.kind === "image" ? dump.imageUrl : null);

  return (
    <article className="group mb-4 break-inside-avoid overflow-hidden rounded-2xl border border-stone-200 bg-white transition hover:border-stone-300 hover:shadow-md">
      {dump.imageUrl && !imgFailed && (
        <a href={href ?? undefined} target="_blank" rel="noreferrer" className="block bg-stone-100">
          {/* External thumbnails come from arbitrary domains, so next/image's allow-list doesn't fit here. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={dump.imageUrl}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setImgFailed(true)}
            className={`w-full object-cover ${dump.kind === "image" ? "max-h-96" : "max-h-48"}`}
          />
        </a>
      )}

      <div className="p-4">
        <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[11px] font-medium">
          <span className="rounded-full bg-stone-100 px-2 py-0.5 text-stone-600">{kindMeta(dump.kind).singular}</span>
          {processing ? (
            <span className="shimmer rounded-full px-2 py-0.5 text-stone-500">Sorting…</span>
          ) : (
            <span
              className="rounded-full px-2 py-0.5"
              style={{ backgroundColor: `${topic.color}1a`, color: topic.color }}
              title={dump.classifiedBy === "you" ? "Filed by you" : dump.classifiedBy === "ai" ? "Filed by AI" : "Filed automatically"}
            >
              {topic.label}
            </span>
          )}
          <div className="ml-auto flex items-center gap-1 font-normal text-stone-400 opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100">
            <select
              aria-label="Move to topic"
              value=""
              onChange={(e) => e.target.value && onTopic(dump.id, e.target.value)}
              className="max-w-24 cursor-pointer rounded-md bg-transparent px-1 py-0.5 text-xs text-stone-500 hover:bg-stone-100"
            >
              <option value="" disabled>
                Move…
              </option>
              {TOPICS.filter((t) => t.id !== dump.topic).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
            <button onClick={() => onDelete(dump.id)} className="rounded-md px-1.5 py-0.5 hover:bg-red-50 hover:text-red-600" aria-label="Delete">
              Delete
            </button>
          </div>
        </div>

        {processing && !dump.title ? (
          <div className="space-y-2">
            <div className="shimmer h-4 w-3/4 rounded" />
            <div className="shimmer h-3 w-1/2 rounded" />
          </div>
        ) : (
          <h3 className="text-[15px] leading-snug font-semibold text-stone-900">
            {href ? (
              <a href={href} target="_blank" rel="noreferrer" className="hover:underline">
                {dump.title || dump.url}
              </a>
            ) : (
              dump.title
            )}
          </h3>
        )}

        {showBody && (
          <p className={`mt-1.5 text-sm leading-relaxed whitespace-pre-line text-stone-600 ${dump.kind === "note" ? "line-clamp-[10]" : "line-clamp-4"}`}>
            {body}
          </p>
        )}

        {dump.note && (
          <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-sm text-amber-900">{dump.note}</p>
        )}

        {dump.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1">
            {dump.tags.map((t) => (
              <button key={t} onClick={() => onTag(t)} className="rounded-md px-1.5 py-0.5 text-xs text-stone-500 hover:bg-stone-100 hover:text-stone-800">
                #{t}
              </button>
            ))}
          </div>
        )}

        <div className="mt-3 flex items-center gap-2 text-xs text-stone-400">
          {dump.domain && <span className="min-w-0 truncate">{dump.siteName && dump.siteName.length < 30 ? dump.siteName : dump.domain}</span>}
          {dump.domain && <span>·</span>}
          <time className="shrink-0 whitespace-nowrap" dateTime={new Date(dump.createdAt).toISOString()}>{timeAgo(dump.createdAt)}</time>
          {dump.status === "failed" && (
            <button onClick={() => onRetry(dump.id)} className="text-amber-600 hover:underline">
              Couldn&apos;t fetch · retry
            </button>
          )}

        </div>
      </div>
    </article>
  );
}
