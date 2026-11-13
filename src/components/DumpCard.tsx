"use client";

import { useState } from "react";
import type { Dump } from "@/lib/db";
import { TOPICS, kindMeta, topicMeta } from "@/lib/taxonomy";
import { timeAgo } from "@/lib/format";
import { titleFromUrl } from "@/lib/detect";

interface Props {
  dump: Dump;
  onTopic: (id: string, topic: string) => void;
  onDelete: (id: string) => void;
  onRetry: (id: string) => void;
  onTag: (tag: string) => void;
}

function postAuthor(dump: Dump) {
  if (dump.author) return dump.author;
  const m = dump.title?.match(/^(.+?) on X$/);
  return m && m[1] !== "Post" ? m[1] : null;
}

function initials(name: string) {
  return name
    .replace(/^@/, "")
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export default function DumpCard({ dump, onTopic, onDelete, onRetry, onTag }: Props) {
  const [imgFailed, setImgFailed] = useState(false);
  const topic = topicMeta(dump.topic);
  const kind = dump.kind;
  const processing = dump.status === "processing";
  const title = dump.title || (dump.url ? titleFromUrl(dump.url) : null);
  const href = dump.url ?? (kind === "image" ? dump.imageUrl : null);
  const site = dump.siteName && dump.siteName.length < 30 ? dump.siteName : dump.domain;
  const author = kind === "post" ? postAuthor(dump) : dump.author;
  const postText = dump.description ?? dump.summary;
  const noteText = dump.content ?? title;
  const dek = dump.summary ?? dump.description;
  const showMedia = dump.imageUrl && !imgFailed;

  let body: React.ReactNode;
  if (processing && !title) {
    body = (
      <div className="space-y-2 py-1">
        <div className="shimmer h-4 w-3/4 rounded" />
        <div className="shimmer h-3 w-1/2 rounded" />
      </div>
    );
  } else if (kind === "post" && postText) {
    body = (
      <>
        <div className="d-author">
          <span className="d-avatar">{author ? initials(author) : "X"}</span>
          <span className="d-author-name">{author ?? "Post"}</span>
          <span className="d-author-site">on {site ?? "X"}</span>
        </div>
        <blockquote className="d-quote">
          <a href={href ?? undefined} target="_blank" rel="noreferrer">
            {postText}
          </a>
        </blockquote>
      </>
    );
  } else if (kind === "note") {
    body = <p className="d-note-text">{noteText}</p>;
  } else if (kind === "image") {
    body = dump.summary ? <p className="d-caption">{dump.summary}</p> : null;
  } else {
    body = (
      <>
        <h3 className="d-headline">
          {href ? (
            <a href={href} target="_blank" rel="noreferrer">
              {title || dump.url}
            </a>
          ) : (
            title
          )}
        </h3>
        {dek && dek !== title && <p className="d-dek">{dek}</p>}
        {author && <p className="d-byline">By {author}</p>}
      </>
    );
  }

  return (
    <article className="d-card group" data-kind={kind} style={{ "--topic": topic.color } as React.CSSProperties}>
      {showMedia && (
        <a href={href ?? undefined} target="_blank" rel="noreferrer" className="d-media">
          {/* External thumbnails come from arbitrary domains, so next/image's allow-list doesn't fit here. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={dump.imageUrl!} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setImgFailed(true)} />
          {kind === "video" && <span className="d-play" aria-hidden>▶</span>}
        </a>
      )}

      <div className="d-body">
        <div className="d-kicker-row">
          {processing ? (
            <span className="d-kicker shimmer">Sorting…</span>
          ) : (
            <span
              className="d-kicker"
              title={dump.classifiedBy === "you" ? "Filed by you" : dump.classifiedBy === "ai" ? "Filed by AI" : "Filed automatically"}
            >
              {topic.label}
            </span>
          )}
          <span className="d-kind">{kindMeta(kind).singular}</span>
          <div className="d-actions">
            <select aria-label="Move to topic" value="" onChange={(e) => e.target.value && onTopic(dump.id, e.target.value)}>
              <option value="" disabled>
                Move…
              </option>
              {TOPICS.filter((t) => t.id !== dump.topic).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
            <button onClick={() => onDelete(dump.id)} aria-label="Delete">
              Delete
            </button>
          </div>
        </div>

        {body}

        {dump.note && <p className="d-annotation">{dump.note}</p>}

        {dump.tags.length > 0 && (
          <div className="d-tags">
            {dump.tags.map((t) => (
              <button key={t} onClick={() => onTag(t)}>
                #{t}
              </button>
            ))}
          </div>
        )}

        <div className="d-meta">
          {site && kind !== "post" && <span className="min-w-0 truncate">{site}</span>}
          {site && kind !== "post" && <span aria-hidden>·</span>}
          <time className="shrink-0 whitespace-nowrap" dateTime={new Date(dump.createdAt).toISOString()}>
            {timeAgo(dump.createdAt)}
          </time>
          {dump.status === "failed" && (
            <button onClick={() => onRetry(dump.id)} className="d-retry">
              Couldn&apos;t fetch · retry
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
