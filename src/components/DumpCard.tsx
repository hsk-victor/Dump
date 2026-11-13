"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import type { Dump } from "@/lib/db";
import { SUBJECT_MIN_CONFIDENCE, subjectLine, TOPICS, kindMeta, providerMeta, topicMeta } from "@/lib/taxonomy";
import { timeAgo } from "@/lib/format";
import { githubRef, titleFromUrl } from "@/lib/detect";

interface Props {
  dump: Dump;
  fresh?: boolean;
  removing?: boolean;
  onTopic: (id: string, topic: string) => void;
  onDelete: (id: string) => void;
  onRetry: (id: string) => void;
}

/** The name inside a "Name on X"-style title — only when the suffix is a known
 *  name (provider label or site), so "Thoughts on Rust | Hacker News" isn't read as an author. */
function attributionName(title: string | null, dump: Dump) {
  const m = title?.match(/^(.+?) on (.{1,32})$/);
  if (!m) return null;
  const names = [providerMeta(dump.provider)?.label, dump.siteName].filter((n): n is string => !!n);
  return names.some((n) => m[2].toLowerCase() === n.toLowerCase()) ? m[1] : null;
}

function postAuthor(dump: Dump) {
  if (dump.author) return dump.author;
  const name = attributionName(dump.title, dump);
  return name && name !== "Post" ? name : null;
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

/** Provider with a brand icon — drives whether a card gets brand chrome or favicon fallback. */
function providerHasIcon(provider: string | null | undefined) {
  const meta = providerMeta(provider);
  return !!(meta && "icon" in meta && meta.icon);
}

/** Social sources that get the post layout even when the URL sniff didn't mark them "post". */
const SOCIAL_PROVIDERS = new Set(["x", "threads", "bluesky", "mastodon", "linkedin", "facebook", "instagram"]);

/** reddit.com/r/<sub>/… -> "r/<sub>" */
function redditSub(url: string | null) {
  const m = url?.match(/reddit\.com\/(r\/[\w-]+)/i);
  return m ? m[1] : "Reddit";
}

function redditAuthor(author: string | null) {
  if (!author) return null;
  return `u/${author.replace(/^u\//, "")}`;
}

function ProviderIcon({ provider, className = "d-prov" }: { provider: string | null | undefined; className?: string }) {
  const meta = providerMeta(provider);
  if (!meta || !("icon" in meta) || !meta.icon) return null;
  return (
    <svg viewBox="0 0 24 24" className={className} aria-label={meta.label}>
      <path fill="currentColor" d={meta.icon} />
    </svg>
  );
}

/** Site favicon via Google's favicon service (same idea as loading remote og:images). */
function Favicon({ domain }: { domain: string | null }) {
  const [bad, setBad] = useState(false);
  if (!domain || bad) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="d-favicon"
      src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`}
      alt=""
      loading="lazy"
      onError={() => setBad(true)}
    />
  );
}

/** Favicon or, for known providers, the brand mark — the kicker's site identity. */
function SiteMark({ dump }: { dump: Dump }) {
  if (providerHasIcon(dump.provider)) return <ProviderIcon provider={dump.provider} className="d-prov d-kicker-prov" />;
  return <Favicon domain={dump.domain} />;
}

/** Brand chip top corner of a media surface; falls back to the kind label like before. */
function Flag({ dump }: { dump: Dump }) {
  const meta = providerMeta(dump.provider);
  if (meta && "icon" in meta && meta.icon) {
    return (
      <span className="d-flag" title={meta.label}>
        <ProviderIcon provider={dump.provider} />
      </span>
    );
  }
  if (dump.kind !== "image" && dump.kind !== "link") return <span className="d-kind-flag">{kindMeta(dump.kind).singular}</span>;
  return null;
}

function PlayBadge() {
  return (
    <span className="d-play" aria-hidden>
      <svg viewBox="0 0 24 24">
        <path fill="currentColor" d="M8 5.5v13l11-6.5z" />
      </svg>
    </span>
  );
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** PR/issue titles come back like "Fix bug · Pull Request #12 · owner/repo"; strip the repo tail. */
function githubDek(dump: Dump, repo: string | null): string | null {
  let t = dump.title ?? "";
  if (repo) {
    const esc = escapeRe(repo);
    t = t
      .replace(new RegExp(`^GitHub\\s*-\\s*${esc}:\\s*`, "i"), "")
      .replace(new RegExp(`\\s*·\\s*${esc}\\s*(?:·\\s*GitHub)?$`, "i"), "")
      .trim();
  }
  return t && t !== repo ? t : dump.description;
}

interface CardBits {
  actions: ReactNode;
  meta: ReactNode;
  href: string | null;
  title: string | null;
  dek: string | null;
  site: string | null;
  showMedia: boolean;
  setImgFailed: (v: boolean) => void;
  processing: boolean;
  cardProps: Record<string, unknown>;
}

function shimmerLines() {
  return (
    <div className="space-y-2 py-1">
      <div className="shimmer h-4 w-3/4 rounded" />
      <div className="shimmer h-3 w-1/2 rounded" />
    </div>
  );
}

/** image/video: media fills the card, title + meta ride a soft scrim on top. */
function MediaCard({ dump, bits }: { dump: Dump; bits: CardBits }) {
  return (
    <article {...bits.cardProps} className="d-card d-mediacard group">
      {bits.actions}
      <a href={bits.href ?? undefined} target="_blank" rel="noreferrer" className="d-media">
        {/* External thumbnails come from arbitrary domains, so next/image's allow-list doesn't fit here. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={dump.imageUrl!} alt={bits.title ?? ""} loading="lazy" referrerPolicy="no-referrer" onError={() => bits.setImgFailed(true)} />
        {dump.kind === "video" && <PlayBadge />}
        <Flag dump={dump} />
      </a>
      <div className="d-scrim">
        {bits.processing && !bits.title ? (
          shimmerLines()
        ) : (
          <>
            {bits.title && (
              <h3 className="d-overlay-title">
                {bits.href ? (
                  <a href={bits.href} target="_blank" rel="noreferrer">
                    {bits.title}
                  </a>
                ) : (
                  bits.title
                )}
              </h3>
            )}
            {/* Channel/author rides under the title — YouTube channel, Vimeo creator, Unsplash photographer. */}
            {dump.author && <p className="d-overlay-sub">{dump.author}</p>}
            {bits.dek && bits.dek !== bits.title && <p className="d-overlay-dek">{bits.dek}</p>}
            {dump.note && <p className="d-overlay-note">{dump.note}</p>}
          </>
        )}
        {bits.meta}
      </div>
    </article>
  );
}

/** post: author head + provider mark + the post text, media below — for every post provider, not just X. */
function PostCard({ dump, bits }: { dump: Dump; bits: CardBits }) {
  const provider = providerMeta(dump.provider);
  const author = postAuthor(dump);
  const postText = dump.description ?? dump.summary ?? dump.title;
  // A real title (Reddit headline, identified subject) still shows above the post text;
  // a "Name on X" attribution title is already in the header, so it isn't repeated.
  const headline = bits.title && bits.title !== postText && !attributionName(dump.title, dump) ? bits.title : null;
  return (
    <article {...bits.cardProps} className="d-card d-post group">
      {bits.actions}
      <a href={bits.href ?? undefined} target="_blank" rel="noreferrer" className="d-post-head">
        <span className="d-avatar">{author ? initials(author) : <ProviderIcon provider={dump.provider} />}</span>
        <span className="min-w-0">
          <span className="d-author-name">{author ?? provider?.label ?? "Post"}</span>
          <span className="d-author-site">{bits.site ?? provider?.label ?? "Post"}</span>
        </span>
        <ProviderIcon provider={dump.provider} className="d-prov d-post-prov" />
      </a>
      {bits.processing && !postText ? shimmerLines() : (
        <>
          {headline && <p className="d-post-headline">{headline}</p>}
          {postText && <p className="d-post-text">{postText}</p>}
        </>
      )}
      {bits.showMedia && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="d-post-media" src={dump.imageUrl!} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => bits.setImgFailed(true)} />
      )}
      {dump.note && <p className="d-annotation">{dump.note}</p>}
      {bits.meta}
    </article>
  );
}

/** reddit: the subreddit is the identity — r/sub headline row, then the post title + text. */
function RedditCard({ dump, bits }: { dump: Dump; bits: CardBits }) {
  const sub = redditSub(dump.url);
  const author = redditAuthor(dump.author);
  const headline = bits.title ?? bits.site;
  const text = dump.description ?? dump.summary;
  return (
    <article {...bits.cardProps} className="d-card d-post group">
      {bits.actions}
      <a href={bits.href ?? undefined} target="_blank" rel="noreferrer" className="d-rd-head">
        <span className="d-rd-mark">
          <ProviderIcon provider="reddit" />
        </span>
        <span className="d-rd-sub min-w-0">{sub}</span>
        {author && <span className="d-rd-by">{author}</span>}
      </a>
      {bits.processing && !headline && !text ? (
        shimmerLines()
      ) : (
        <>
          {headline && <p className="d-post-headline">{headline}</p>}
          {text && text !== headline && <p className="d-post-text">{text}</p>}
        </>
      )}
      {bits.showMedia && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="d-post-media" src={dump.imageUrl!} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => bits.setImgFailed(true)} />
      )}
      {dump.note && <p className="d-annotation">{dump.note}</p>}
      {bits.meta}
    </article>
  );
}

/** hackernews: a compact item like the HN list — orange mark, headline, domain. */
function HnCard({ dump, bits }: { dump: Dump; bits: CardBits }) {
  const headline = bits.title ?? dump.url;
  const showSite = headline !== "news.ycombinator.com" && headline !== dump.domain;
  const text = dump.description ?? dump.summary;
  return (
    <article {...bits.cardProps} className="d-card group">
      {bits.actions}
      <div className="d-body">
        <a href={bits.href ?? undefined} target="_blank" rel="noreferrer" className="d-hn">
          <span className="d-hn-mark">
            <ProviderIcon provider="hackernews" />
          </span>
          <span className="min-w-0">
            <span className="d-hn-title">{headline}</span>
            {showSite && <span className="d-hn-site">news.ycombinator.com</span>}
          </span>
        </a>
        {text && text !== headline && <p className="d-dek">{text}</p>}
        {dump.note && <p className="d-annotation">{dump.note}</p>}
        {bits.meta}
      </div>
    </article>
  );
}

/** github: the mark + owner/repo headline; PRs and issues get their ref appended. */
function GithubCard({ dump, bits }: { dump: Dump; bits: CardBits }) {
  const gh = dump.url ? githubRef(dump.url) : null;
  const dek = githubDek(dump, gh?.repo ?? null);
  return (
    <article {...bits.cardProps} className="d-card group">
      {bits.actions}
      <div className="d-body">
        <a className="d-gh" href={bits.href ?? undefined} target="_blank" rel="noreferrer">
          <span className="d-gh-mark">
            <ProviderIcon provider="github" />
          </span>
          <span className="d-gh-repo min-w-0">
            {gh?.repo ?? bits.title ?? "GitHub"}
            {gh?.ref && <span className="d-gh-ref"> · {gh.ref}</span>}
          </span>
        </a>
        {dek && <p className="d-dek">{dek}</p>}
        {dump.note && <p className="d-annotation">{dump.note}</p>}
        {bits.meta}
      </div>
    </article>
  );
}

/** audio: artwork (or a brand-tinted waveform) + title + artist line. */
function AudioCard({ dump, bits }: { dump: Dump; bits: CardBits }) {
  const provider = providerMeta(dump.provider);
  const sub = dump.author ?? (bits.dek !== bits.title ? bits.dek : null) ?? provider?.label;
  return (
    <article {...bits.cardProps} className="d-card group">
      {bits.actions}
      <a href={bits.href ?? undefined} target="_blank" rel="noreferrer" className="d-audio">
        <span className="d-art">
          {bits.showMedia ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={dump.imageUrl!} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => bits.setImgFailed(true)} />
          ) : (
            <span className="d-wave" aria-hidden>
              <i />
              <i />
              <i />
              <i />
              <i />
            </span>
          )}
        </span>
        <span className="d-audio-text min-w-0">
          <span className="d-audio-title">{bits.title ?? bits.site ?? provider?.label ?? "Audio"}</span>
          {sub && <span className="d-audio-sub">{sub}</span>}
        </span>
        <ProviderIcon provider={dump.provider} className="d-prov d-audio-prov" />
      </a>
      {dump.note && <p className="d-annotation">{dump.note}</p>}
      {bits.meta}
    </article>
  );
}

/** article: site-name kicker for the news feel, headline + dek, thumbnail stays small. */
function ArticleCard({ dump, bits }: { dump: Dump; bits: CardBits }) {
  return (
    <article {...bits.cardProps} className="d-card group">
      {bits.actions}
      <div className="d-body">
        {(bits.site || dump.domain || providerHasIcon(dump.provider)) && (
          <div className="d-kicker">
            <SiteMark dump={dump} />
            <span className="min-w-0 truncate">{bits.site ?? providerMeta(dump.provider)?.label ?? dump.domain}</span>
          </div>
        )}
        <div className="d-article-row">
          <div className="min-w-0 flex-1">
            {bits.processing && !bits.title ? (
              shimmerLines()
            ) : (
              <>
                {(bits.title || bits.site || dump.url) && (
                  <h3 className="d-headline">
                    {bits.href ? (
                      <a href={bits.href} target="_blank" rel="noreferrer">
                        {bits.title ?? bits.site ?? dump.url}
                      </a>
                    ) : (
                      bits.title ?? bits.site ?? dump.url
                    )}
                  </h3>
                )}
                {bits.dek && <p className="d-dek">{bits.dek}</p>}
              </>
            )}
          </div>
          {bits.showMedia && (
            <a href={bits.href ?? undefined} target="_blank" rel="noreferrer" className="d-thumb-link">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="d-thumb" src={dump.imageUrl!} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => bits.setImgFailed(true)} />
            </a>
          )}
        </div>
        {dump.note && <p className="d-annotation">{dump.note}</p>}
        {bits.meta}
      </div>
    </article>
  );
}

/** link (and anything else without a tailored card): favicon kicker + title + description. */
function LinkCard({ dump, bits }: { dump: Dump; bits: CardBits }) {
  return (
    <article {...bits.cardProps} className="d-card group">
      {bits.actions}
      {bits.showMedia && (
        <a href={bits.href ?? undefined} target="_blank" rel="noreferrer" className="d-media">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={dump.imageUrl!} alt={bits.title ?? ""} loading="lazy" referrerPolicy="no-referrer" onError={() => bits.setImgFailed(true)} />
          {dump.kind === "video" && <PlayBadge />}
          <Flag dump={dump} />
        </a>
      )}
      <div className="d-body">
        {(bits.site || dump.domain || providerHasIcon(dump.provider)) && (
          <div className="d-kicker">
            <SiteMark dump={dump} />
            <span className="min-w-0 truncate">{bits.site ?? providerMeta(dump.provider)?.label ?? dump.domain}</span>
          </div>
        )}
        {bits.processing && !bits.title ? (
          shimmerLines()
        ) : (
          <>
            {(bits.title || bits.site || dump.url) && (
              <h3 className="d-headline">
                {bits.href ? (
                  <a href={bits.href} target="_blank" rel="noreferrer">
                    {bits.title ?? bits.site ?? dump.url}
                  </a>
                ) : (
                  bits.title ?? bits.site ?? dump.url
                )}
              </h3>
            )}
            {bits.dek && <p className="d-dek">{bits.dek}</p>}
          </>
        )}
        {dump.note && <p className="d-annotation">{dump.note}</p>}
        {bits.meta}
      </div>
    </article>
  );
}

export default function DumpCard({ dump, fresh, removing, onTopic, onDelete, onRetry }: Props) {
  const [imgFailed, setImgFailed] = useState(false);
  const topic = topicMeta(dump.topic);
  const kind = dump.kind;
  const provider = providerMeta(dump.provider);
  const processing = dump.status === "processing";
  const subject = dump.subject && (dump.subject.confidence ?? 0) >= SUBJECT_MIN_CONFIDENCE ? dump.subject : null;
  // An identified subject headlines the card ("Severance (2022) · TV series"); the link stays on it.
  const title = subject ? subjectLine(subject) : dump.title || (dump.url ? titleFromUrl(dump.url) : null);
  const href = dump.url ?? (kind === "image" ? dump.imageUrl : null);
  const site = dump.siteName && dump.siteName.length < 30 ? dump.siteName : dump.domain;
  const showMedia = !!dump.imageUrl && !imgFailed;
  const dek = dump.summary ?? dump.description;
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
      {topicChip}
      <span className="min-w-0 truncate">{site ?? provider?.label ?? kindMeta(kind).singular}</span>
      {dump.status === "failed" && (
        <button onClick={() => onRetry(dump.id)} className="d-retry">
          Retry
        </button>
      )}
      <time className="ml-auto shrink-0 whitespace-nowrap" dateTime={new Date(dump.createdAt).toISOString()}>
        {timeAgo(dump.createdAt)}
      </time>
    </div>
  );

  const bits: CardBits = {
    actions,
    meta,
    href,
    title,
    dek,
    site,
    showMedia,
    setImgFailed,
    processing,
    cardProps: {
      "data-kind": kind,
      "data-provider": dump.provider ?? undefined,
      "data-fresh": fresh || undefined,
      "data-removing": removing || undefined,
      style: { "--topic": topic.color, "--provider": provider && "color" in provider ? provider.color : undefined } as CSSProperties,
    },
  };

  // Media dumps with a usable image get the overlay card; without one they degrade to a link card.
  if ((kind === "image" || kind === "video") && showMedia) return <MediaCard dump={dump} bits={bits} />;
  if (kind === "note") {
    return (
      <article {...bits.cardProps} className="d-card group">
        {actions}
        <div className="d-body">
          {processing && !title ? shimmerLines() : <p className="d-note-text">{dump.content ?? title}</p>}
          {dump.note && <p className="d-annotation">{dump.note}</p>}
          {meta}
        </div>
      </article>
    );
  }
  if (dump.provider === "reddit") return <RedditCard dump={dump} bits={bits} />;
  if (dump.provider === "hackernews") return <HnCard dump={dump} bits={bits} />;
  if (kind === "post" || SOCIAL_PROVIDERS.has(dump.provider ?? "")) return <PostCard dump={dump} bits={bits} />;
  if (dump.provider === "github") return <GithubCard dump={dump} bits={bits} />;
  if (kind === "audio") return <AudioCard dump={dump} bits={bits} />;
  if (kind === "article") return <ArticleCard dump={dump} bits={bits} />;
  return <LinkCard dump={dump} bits={bits} />;
}
