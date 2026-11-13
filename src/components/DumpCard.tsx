"use client";

import { useState } from "react";
import type { Dump } from "@/lib/db";
import { SUBJECT_MIN_CONFIDENCE, subjectLine, TOPICS, kindMeta, topicMeta } from "@/lib/taxonomy";
import { timeAgo } from "@/lib/format";
import { titleFromUrl } from "@/lib/detect";

interface Props {
  dump: Dump;
  fresh?: boolean;
  removing?: boolean;
  onTopic: (id: string, topic: string) => void;
  onDelete: (id: string) => void;
  onRetry: (id: string) => void;
}

function postAuthor(dump: Dump) {
  if (dump.author) return dump.author;
  const m = dump.title?.match(/^(.+?) on X$/);
  return m && m[1] !== "Post" ? m[1] : null;
}

// Grapheme-cluster first character: w[0] would split an emoji surrogate pair.
function initials(name: string) {
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  return name
    .replace(/^@/, "")
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => segmenter.segment(w)[Symbol.iterator]().next().value?.segment.toUpperCase() ?? "")
    .join("");
}

function XLogo() {
  return (
    <svg viewBox="0 0 24 24" aria-label="X" className="d-x">
      <path
        fill="currentColor"
        d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"
      />
    </svg>
  );
}

export default function DumpCard({ dump, fresh, removing, onTopic, onDelete, onRetry }: Props) {
  const [imgFailed, setImgFailed] = useState(false);
  const [iconFailed, setIconFailed] = useState(false);
  const topic = topicMeta(dump.topic);
  const kind = dump.kind;
  const processing = dump.status === "processing";
  const subject = dump.subject && (dump.subject.confidence ?? 0) >= SUBJECT_MIN_CONFIDENCE ? dump.subject : null;
  // An identified subject headlines the card ("Severance (2022) · TV series"); the link stays on it.
  const title = subject ? subjectLine(subject) : dump.title || (dump.url ? titleFromUrl(dump.url) : null);
  const href = dump.url ?? (kind === "image" ? dump.imageUrl : null);
  const site = dump.siteName && dump.siteName.length < 30 ? dump.siteName : dump.domain;
  const isX = /(^|\.)(x|twitter)\.com$/.test(dump.domain ?? "");
  const isXPost = kind === "post" && isX;
  const postText = isXPost ? (dump.description ?? dump.summary) : null;
  const author = kind === "post" ? postAuthor(dump) : null;
  const showMedia = !!dump.imageUrl && !imgFailed;
  // Image/video cards render media-only; their caption stays in a hover overlay.
  const mediaOnly = showMedia && (kind === "image" || kind === "video");
  // The identified description (summary) shows as the dek even under media; other deks stay text-only.
  const dek = dump.summary ?? (!showMedia ? dump.description : null);
  const filedBy = dump.classifiedBy === "you" ? "Filed by you" : dump.classifiedBy === "ai" ? "Filed by AI" : "Filed automatically";

  const actions = (
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
      <button onClick={() => onDelete(dump.id)} aria-label="Delete" title="Delete">
        ×
      </button>
    </div>
  );

  const topicChip = processing ? (
    <span className="d-sorting shimmer">Sorting…</span>
  ) : (
    <span className="d-topic-chip" title={filedBy}>
      <span className="d-dot" />
      {topic.label}
    </span>
  );

  const meta = (
    <div className="d-meta">
      {dump.domain && !iconFailed && !isXPost && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="d-favicon"
          src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(dump.domain)}&sz=32`}
          alt=""
          onError={() => setIconFailed(true)}
        />
      )}
      {site && !isXPost && <span className="min-w-0 truncate">{site}</span>}
      {site && !isXPost && <span aria-hidden>·</span>}
      <time className="shrink-0 whitespace-nowrap" dateTime={new Date(dump.createdAt).toISOString()}>
        {timeAgo(dump.createdAt)}
      </time>
      {dump.status === "failed" && (
        <button onClick={() => onRetry(dump.id)} className="d-retry">
          Retry
        </button>
      )}
      <span className="ml-auto">{topicChip}</span>
    </div>
  );

  if (isXPost && postText) {
    return (
      <article
        className="d-card d-post group"
        data-fresh={fresh || undefined}
        data-removing={removing || undefined}
        style={{ "--topic": topic.color } as React.CSSProperties}
      >
        {actions}
        <a href={href ?? undefined} target="_blank" rel="noreferrer" className="d-post-head">
          <span className="d-avatar">{author ? initials(author) : <XLogo />}</span>
          <span className="min-w-0">
            <span className="d-author-name">{author ?? "Post"}</span>
            <span className="d-author-site">{site ?? "X"}</span>
          </span>
          <XLogo />
        </a>
        <p className="d-post-text">{postText}</p>
        {showMedia && (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="d-post-media" src={dump.imageUrl!} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setImgFailed(true)} />
        )}
        {dump.note && <p className="d-annotation">{dump.note}</p>}
        {meta}
      </article>
    );
  }

  return (
    <article
      className={`d-card group ${mediaOnly ? "d-media-only" : ""}`}
      data-kind={kind}
      data-fresh={fresh || undefined}
      data-removing={removing || undefined}
      style={{ "--topic": topic.color } as React.CSSProperties}
    >
      {actions}
      {showMedia && (
        <a href={href ?? undefined} target="_blank" rel="noreferrer" className="d-media">
          {/* External thumbnails come from arbitrary domains, so next/image's allow-list doesn't fit here. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={dump.imageUrl!} alt={title ?? ""} loading="lazy" referrerPolicy="no-referrer" onError={() => setImgFailed(true)} />
          {kind === "video" && (
            <span className="d-play" aria-hidden>
              <svg viewBox="0 0 24 24">
                <path fill="currentColor" d="M8 5.5v13l11-6.5z" />
              </svg>
            </span>
          )}
          {mediaOnly && dump.domain && !iconFailed && (
            <span className="d-src" aria-hidden>
              {isX ? (
                <XLogo />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(dump.domain)}&sz=32`}
                  alt=""
                  onError={() => setIconFailed(true)}
                />
              )}
            </span>
          )}
          {mediaOnly && (
            <span className="d-overlay">
              {(title || dek || dump.note || dump.description) && (
                <span className="d-overlay-caption">
                  {title && <span className="d-overlay-title">{title}</span>}
                  {(dump.note ?? dek ?? dump.description) && (
                    <span className="d-overlay-sub">{dump.note ?? dek ?? dump.description}</span>
                  )}
                </span>
              )}
              <span className="d-overlay-meta">
                {site && <span className="min-w-0 truncate">{site}</span>}
                {site && <span aria-hidden>·</span>}
                <time className="shrink-0 whitespace-nowrap" dateTime={new Date(dump.createdAt).toISOString()}>
                  {timeAgo(dump.createdAt)}
                </time>
                {dump.status === "failed" && (
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      onRetry(dump.id);
                    }}
                    className="d-retry"
                  >
                    Retry
                  </button>
                )}
                <span className="ml-auto">{topicChip}</span>
              </span>
            </span>
          )}
        </a>
      )}

      {!mediaOnly && (
        <div className="d-body">
          {processing && !title ? (
            <div className="space-y-2 py-1">
              <div className="shimmer h-4 w-3/4 rounded" />
              <div className="shimmer h-3 w-1/2 rounded" />
            </div>
          ) : kind === "note" ? (
            <p className="d-note-text">{dump.content ?? title}</p>
          ) : (
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
              {dek && <p className="d-dek">{dek}</p>}
            </>
          )}
          {dump.note && <p className="d-annotation">{dump.note}</p>}
          {kind === "note" ? (
            <div className="d-meta">
              <span>{kindMeta(kind).singular}</span>
              <span aria-hidden>·</span>
              <time dateTime={new Date(dump.createdAt).toISOString()}>{timeAgo(dump.createdAt)}</time>
              <span className="ml-auto">{topicChip}</span>
            </div>
          ) : (
            meta
          )}
        </div>
      )}
    </article>
  );
}
