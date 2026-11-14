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
    .replace(/^u\//, "")
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => segmenter.segment(w)[Symbol.iterator]().next().value?.segment.toUpperCase() ?? "")
    .join("");
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

/** Filled 24x24 glyphs for platform-native chrome (reply, heart, vote, …). */
const GLYPHS = {
  reply: "M1.751 10c0-4.42 3.584-8 8.005-8h4.366c4.49 0 8.129 3.64 8.129 8.13 0 2.96-1.607 5.68-4.196 7.11l-8.054 4.46v-3.69h-.067c-4.49.1-8.183-3.51-8.183-8.01z",
  repost:
    "M4.5 3.88l4.432 4.14-1.364 1.46L5.5 7.55V16c0 1.1.896 2 2 2H13v2H7.5c-2.209 0-4-1.79-4-4V7.55L1.432 9.48.068 8.02 4.5 3.88zM16.5 6H11V4h5.5c2.209 0 4 1.79 4 4v8.45l2.068-1.93 1.364 1.46-4.432 4.14-4.432-4.14 1.364-1.46 2.068 1.93V8c0-1.1-.896-2-2-2z",
  heart:
    "M20.884 13.19c-1.351 2.48-4.001 5.12-8.379 7.67l-.503.3-.504-.3c-4.379-2.55-7.029-5.19-8.382-7.67-1.36-2.5-1.41-4.86-.514-6.67.887-1.79 2.647-2.91 4.601-3.01 1.651-.09 3.368.56 4.798 2.01 1.429-1.45 3.146-2.1 4.796-2.01 1.954.1 3.714 1.22 4.601 3.01.896 1.81.846 4.17-.514 6.67z",
  chart: "M8.75 21V3h2v18h-2zM18 21V8.5h2V21h-2zM4 21l.004-10h2L6 21H4zm9.248 0v-7h2v7h-2z",
  voteUp: "M12 4l7 8h-4v8H9v-8H5l7-8z",
  voteDown: "M12 20l-7-8h4V4h6v8h4l-7 8z",
  comment: "M4 3h16a1 1 0 011 1v12a1 1 0 01-1 1H8.7L4 20.5V4a1 1 0 011-1z",
  share: "M21 12l-8-7v4C7 9 3.5 13.5 2.5 19c2.5-3.5 6-5 10.5-5v4l8-6z",
  bookmark: "M6 3h12a1 1 0 011 1v17l-7-4.5L5 21V4a1 1 0 011-1z",
  dots: "M2 12a2 2 0 1 1 4 0 2 2 0 0 1-4 0zm8 0a2 2 0 1 1 4 0 2 2 0 0 1-4 0zm8 0a2 2 0 1 1 4 0 2 2 0 0 1-4 0z",
};

function Glyph({ name, className = "d-glyph" }: { name: keyof typeof GLYPHS; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path fill="currentColor" d={GLYPHS[name]} />
    </svg>
  );
}

function providerHasIcon(provider: string | null | undefined) {
  const meta = providerMeta(provider);
  return !!(meta && "icon" in meta && meta.icon);
}

const SOCIAL_PROVIDERS = new Set(["threads", "bluesky", "mastodon", "linkedin", "facebook"]);

/** reddit.com/r/<sub>/… -> "r/<sub>" */
function redditSub(url: string | null) {
  const m = url?.match(/reddit\.com\/(r\/[\w-]+)/i);
  return m ? m[1] : "Reddit";
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

function SiteMark({ dump }: { dump: Dump }) {
  if (providerHasIcon(dump.provider)) return <ProviderIcon provider={dump.provider} className="d-prov d-kicker-prov" />;
  return <Favicon domain={dump.domain} />;
}

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
  /** The meta row without the site label, for cards whose kicker already names the site. */
  bareMeta: ReactNode;
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

function Img({ dump, bits, className, alt = "" }: { dump: Dump; bits: CardBits; className: string; alt?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img className={className} src={dump.imageUrl!} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => bits.setImgFailed(true)} />
  );
}

/** Image that fades in once decoded — unless it was already cached, so revisits don't flicker. */
function FadeImg({ dump, bits, className, alt = "" }: { dump: Dump; bits: CardBits; className?: string; alt?: string }) {
  const [loaded, setLoaded] = useState(false);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={(el) => {
        if (el?.complete && el.naturalWidth) setLoaded(true);
      }}
      className={className}
      src={dump.imageUrl!}
      alt={alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      data-loaded={loaded || undefined}
      onLoad={() => setLoaded(true)}
      onError={() => bits.setImgFailed(true)}
    />
  );
}

/* ============================ platform-native cards ============================ */

/** x — an embedded tweet: avatar, name, @handle, big X, text, media, reply/repost/like/views. */
function XCard({ dump, bits }: { dump: Dump; bits: CardBits }) {
  const author = postAuthor(dump) ?? dump.author;
  const raw = dump.author?.replace(/^@/, "");
  // oEmbed author_name can be a display name ("Jane Doe"), not a handle — only @-ify real handles.
  const handle = raw && /^[\w.]{1,30}$/.test(raw) ? `@${raw}` : null;
  const text = dump.description ?? dump.summary ?? bits.title;
  return (
    <article {...bits.cardProps} className="d-card d-tw group">
      {bits.actions}
      <a href={bits.href ?? undefined} target="_blank" rel="noreferrer" className="d-tw-head">
        <span className="d-tw-avatar">{author ? initials(author) : <ProviderIcon provider="x" />}</span>
        <span className="min-w-0">
          <span className="d-tw-name">{author ?? "Post"}</span>
          <span className="d-tw-handle">{handle ?? "X"}</span>
        </span>
        <ProviderIcon provider="x" className="d-tw-logo" />
      </a>
      {bits.processing && !text ? shimmerLines() : text && <p className="d-tw-text">{text}</p>}
      {bits.showMedia && (
        <a href={bits.href ?? undefined} target="_blank" rel="noreferrer" className="d-tw-media">
          <Img dump={dump} bits={bits} className="d-tw-img" />
        </a>
      )}
      <div className="d-tw-actions" aria-hidden>
        <span className="d-tw-act"><Glyph name="reply" /></span>
        <span className="d-tw-act d-tw-repost"><Glyph name="repost" /></span>
        <span className="d-tw-act d-tw-like"><Glyph name="heart" /></span>
        <span className="d-tw-act"><Glyph name="chart" /></span>
      </div>
      {dump.note && <p className="d-annotation">{dump.note}</p>}
      {bits.meta}
    </article>
  );
}

/** threads/bluesky/mastodon/linkedin/facebook — social post: avatar, author, brand mark, text, media. */
function PostCard({ dump, bits }: { dump: Dump; bits: CardBits }) {
  const provider = providerMeta(dump.provider);
  const author = postAuthor(dump);
  const postText = dump.description ?? dump.summary ?? dump.title;
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
      {bits.showMedia && <Img dump={dump} bits={bits} className="d-post-media" />}
      {dump.note && <p className="d-annotation">{dump.note}</p>}
      {bits.meta}
    </article>
  );
}

/** reddit — vote rail + "r/sub · u/author · ago" + headline + text. */
function RedditCard({ dump, bits }: { dump: Dump; bits: CardBits }) {
  const sub = redditSub(dump.url);
  const author = dump.author?.replace(/^u\//, "");
  const headline = bits.title ?? bits.site;
  const text = dump.description ?? dump.summary;
  return (
    <article {...bits.cardProps} className="d-card d-rd group">
      {bits.actions}
      <div className="d-rd-votes" aria-hidden>
        <Glyph name="voteUp" className="d-rd-arrow" />
        <Glyph name="voteDown" className="d-rd-arrow" />
      </div>
      <div className="d-rd-body">
        <div className="d-rd-top">
          <span className="d-rd-mark"><ProviderIcon provider="reddit" /></span>
          <a href={bits.href ?? undefined} target="_blank" rel="noreferrer" className="d-rd-sub">{sub}</a>
          <span className="d-rd-by">
            {author ? `· Posted by u/${author} · ` : "· "}
            {timeAgo(dump.createdAt)}
          </span>
        </div>
        {bits.processing && !headline && !text ? (
          shimmerLines()
        ) : (
          <>
            {headline && (
              <h3 className="d-rd-title">
                <a href={bits.href ?? undefined} target="_blank" rel="noreferrer">{headline}</a>
              </h3>
            )}
            {text && text !== headline && <p className="d-post-text">{text}</p>}
          </>
        )}
        {bits.showMedia && <Img dump={dump} bits={bits} className="d-post-media" />}
        {dump.note && <p className="d-annotation">{dump.note}</p>}
        {bits.meta}
      </div>
    </article>
  );
}

/** hackernews — compact item like the HN list: orange Y block, headline, "(site)". */
function HnCard({ dump, bits }: { dump: Dump; bits: CardBits }) {
  const headline = bits.title ?? dump.url;
  const showSite = headline !== "news.ycombinator.com" && headline !== dump.domain;
  const text = dump.description ?? dump.summary;
  return (
    <article {...bits.cardProps} className="d-card group">
      {bits.actions}
      <div className="d-body">
        <a href={bits.href ?? undefined} target="_blank" rel="noreferrer" className="d-hn">
          <span className="d-hn-mark"><ProviderIcon provider="hackernews" /></span>
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

/** github — mark + owner/repo (+ ref), description; og:image backdrop only if present. */
function GithubCard({ dump, bits }: { dump: Dump; bits: CardBits }) {
  const gh = dump.url ? githubRef(dump.url) : null;
  const dek = githubDek(dump, gh?.repo ?? null);
  return (
    <article {...bits.cardProps} className="d-card group">
      {bits.actions}
      <div className="d-body">
        <a className="d-gh" href={bits.href ?? undefined} target="_blank" rel="noreferrer">
          <span className="d-gh-mark"><ProviderIcon provider="github" /></span>
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

/** youtube keeps the platform-native card: thumbnail first, then channel-avatar +
 *  title + channel line — matching YouTube's own listing. */
function YouTubeCard({ dump, bits }: { dump: Dump; bits: CardBits }) {
  const provider = providerMeta(dump.provider);
  return (
    <article {...bits.cardProps} className="d-card d-vid group">
      {bits.actions}
      <a href={bits.href ?? undefined} target="_blank" rel="noreferrer" className="d-vid-thumb">
        {bits.showMedia ? (
          <Img dump={dump} bits={bits} className="d-vid-img" />
        ) : (
          <span className="d-vid-placeholder" aria-hidden>
            <ProviderIcon provider={dump.provider} />
          </span>
        )}
        <PlayBadge />
        <Flag dump={dump} />
      </a>
      <a href={bits.href ?? undefined} target="_blank" rel="noreferrer" className="d-vid-info">
        <span className="d-vid-avatar">{dump.author ? initials(dump.author) : <ProviderIcon provider={dump.provider} />}</span>
        <span className="min-w-0">
          {bits.processing && !bits.title ? (
            shimmerLines()
          ) : (
            <>
              <span className="d-vid-title">{bits.title ?? provider?.label ?? "Video"}</span>
              <span className="d-vid-channel">{[dump.author, provider?.label].filter(Boolean).join(" · ")}</span>
            </>
          )}
        </span>
      </a>
      {dump.note && <p className="d-annotation">{dump.note}</p>}
      {bits.meta}
    </article>
  );
}

/** video — youtube keeps its platform-native card; every other provider (vimeo, twitch, tiktok,
 *  loom, dailymotion, plain links) gets the cinema layout: like the media card, the thumbnail is
 *  the card — glass byline chip at rest, title/byline/dek/note/meta rise in a glass panel on
 *  hover/focus (touch shows the title in the chip). */
function VideoCard({ dump, bits }: { dump: Dump; bits: CardBits }) {
  if (dump.provider === "youtube") return <YouTubeCard dump={dump} bits={bits} />;
  const t = mediaText(dump, bits);
  const byline =
    [dump.author?.trim(), providerMeta(dump.provider)?.label].filter(Boolean).join(" · ") ||
    (dump.url ? bits.site : null);
  const restLabel = byline ?? t.title ?? t.note;
  const touchLabel = t.title ?? byline ?? t.note;
  return (
    <article {...bits.cardProps} className="d-card d-mediacard d-vidcard group" data-open={dump.status === "failed" || undefined}>
      {bits.actions}
      <a href={bits.href ?? undefined} target="_blank" rel="noreferrer" className="d-media d-vmedia" aria-label={t.title ?? byline ?? "Open video"}>
        {bits.showMedia ? (
          <FadeImg dump={dump} bits={bits} alt={t.title ?? ""} />
        ) : (
          <span className="d-vph" aria-hidden>
            <ProviderIcon provider={dump.provider} />
          </span>
        )}
        <span className="d-vscrim" aria-hidden />
        <PlayBadge />
        <Flag dump={dump} />
      </a>
      {bits.processing ? (
        <span className="d-mchip" aria-hidden>
          <span className="d-mchip-sorting shimmer" />
        </span>
      ) : (
        (restLabel || t.hasMark) && (
          <span className="d-mchip" aria-hidden>
            {t.hasMark ? <ProviderIcon provider={dump.provider} className="d-mchip-prov" /> : <span className="d-dot" />}
            {restLabel && <span className="d-mchip-text d-mchip-rest" dir="auto">{restLabel}</span>}
            {touchLabel && <span className="d-mchip-text d-mchip-touch" dir="auto">{touchLabel}</span>}
          </span>
        )
      )}
      <div className="d-mpanel">
        {bits.processing && !t.title ? (
          shimmerLines()
        ) : (
          <>
            {t.title && (
              <h3 className="d-mpanel-title" dir="auto">
                {bits.href ? <a href={bits.href} target="_blank" rel="noreferrer">{t.title}</a> : t.title}
              </h3>
            )}
            {byline && (
              <p className="d-mpanel-by">
                {t.hasMark && <ProviderIcon provider={dump.provider} className="d-mpanel-prov" />}
                <span className="min-w-0 truncate" dir="auto">{byline}</span>
              </p>
            )}
            {t.dek && <p className="d-mpanel-dek" dir="auto">{t.dek}</p>}
            {t.note && <p className="d-annotation d-mpanel-note" dir="auto">{t.note}</p>}
          </>
        )}
        {bits.meta}
      </div>
    </article>
  );
}

/** Camera-roll / upload defaults ("IMG 4821", "Image", "Screenshot 2026-…") aren't titles. */
const PLACEHOLDER_TITLE = /^(?:image|photo|picture|untitled|(?:img|dsc|dscn|dcim|pxl|mvimg|gopr|screenshot|screen shot)[\s_-]*\d[\w\s.:-]*)$/i;
/** Stock-site boilerplate ("Download this free HD photo of … by …") isn't a description. */
const BOILERPLATE_DEK = /^(download this (free )?(hd )?(photo|image|picture)|free download|find more|discover more)/i;

function mediaText(dump: Dump, bits: CardBits) {
  const t = bits.title?.trim() || null;
  const title = t && !PLACEHOLDER_TITLE.test(t) ? t : null;
  const providerLabel = providerMeta(dump.provider)?.label ?? null;
  // Creator, else the platform; nothing for plain uploads.
  const byline = dump.author?.trim() || providerLabel || (dump.url ? bits.site : null);
  const d = bits.dek?.trim() || null;
  const dek = d && d !== title && !BOILERPLATE_DEK.test(d) ? d : null;
  return { title, byline, dek, note: dump.note?.trim() || null, hasMark: providerHasIcon(dump.provider) };
}

/** image-kind dumps from visual platforms — the image is the card: a glass byline chip at rest,
 *  title / dek / note / meta rise in a glass panel on hover or focus (touch shows the title in the chip). */
function MediaCard({ dump, bits }: { dump: Dump; bits: CardBits }) {
  const t = mediaText(dump, bits);
  const restLabel = t.byline ?? t.title ?? t.note;
  const touchLabel = t.title ?? t.byline ?? t.note;
  return (
    <article {...bits.cardProps} className="d-card d-mediacard group" data-open={dump.status === "failed" || undefined}>
      {bits.actions}
      <a href={bits.href ?? undefined} target="_blank" rel="noreferrer" className="d-media" aria-label={t.title ?? t.byline ?? "Open image"}>
        <FadeImg dump={dump} bits={bits} alt={t.title ?? ""} />
        {dump.kind === "video" && <PlayBadge />}
      </a>
      {bits.processing ? (
        <span className="d-mchip" aria-hidden>
          <span className="d-mchip-sorting shimmer" />
        </span>
      ) : (
        (restLabel || t.hasMark) && (
          <span className="d-mchip" aria-hidden>
            {t.hasMark ? <ProviderIcon provider={dump.provider} className="d-mchip-prov" /> : <span className="d-dot" />}
            {restLabel && <span className="d-mchip-text d-mchip-rest" dir="auto">{restLabel}</span>}
            {touchLabel && <span className="d-mchip-text d-mchip-touch" dir="auto">{touchLabel}</span>}
          </span>
        )
      )}
      <div className="d-mpanel">
        {bits.processing && !t.title ? (
          shimmerLines()
        ) : (
          <>
            {t.title && (
              <h3 className="d-mpanel-title" dir="auto">
                {bits.href ? <a href={bits.href} target="_blank" rel="noreferrer">{t.title}</a> : t.title}
              </h3>
            )}
            {t.byline && (
              <p className="d-mpanel-by">
                {t.hasMark && <ProviderIcon provider={dump.provider} className="d-mpanel-prov" />}
                <span className="min-w-0 truncate" dir="auto">{t.byline}</span>
              </p>
            )}
            {t.dek && <p className="d-mpanel-dek" dir="auto">{t.dek}</p>}
            {t.note && <p className="d-annotation d-mpanel-note" dir="auto">{t.note}</p>}
          </>
        )}
        {bits.meta}
      </div>
    </article>
  );
}

/** instagram — the IG grid post: square-ish media, action bar (heart/comment/share/bookmark), caption. */
function IgCard({ dump, bits }: { dump: Dump; bits: CardBits }) {
  const author = postAuthor(dump);
  const caption = dump.description ?? dump.summary ?? bits.title;
  const headline = bits.title && bits.title !== caption && !attributionName(dump.title, dump) ? bits.title : null;
  return (
    <article {...bits.cardProps} className="d-card group">
      {bits.actions}
      <a href={bits.href ?? undefined} target="_blank" rel="noreferrer" className="d-ig-head">
        <span className="d-ig-ring"><span className="d-ig-avatar">{author ? initials(author) : <ProviderIcon provider="instagram" />}</span></span>
        <span className="d-ig-name min-w-0">{author ?? "Instagram"}</span>
        <Glyph name="dots" className="d-ig-dots" />
      </a>
      {bits.showMedia ? (
        <a href={bits.href ?? undefined} target="_blank" rel="noreferrer" className="d-ig-media">
          <Img dump={dump} bits={bits} className="d-ig-img" />
        </a>
      ) : null}
      <div className="d-ig-actions" aria-hidden>
        <Glyph name="heart" className="d-glyph d-ig-heart" />
        <Glyph name="comment" className="d-glyph" />
        <Glyph name="share" className="d-glyph" />
        <Glyph name="bookmark" className="d-glyph d-ig-save" />
      </div>
      {caption && <p className="d-ig-caption">{author && <strong>{author} </strong>}{caption}</p>}
      {headline && <p className="d-ig-subject">{headline}</p>}
      {dump.note && <p className="d-annotation">{dump.note}</p>}
      {bits.meta}
    </article>
  );
}

/** spotify/soundcloud/applemusic/bandcamp — a square frosted-glass player widget: the card IS
 *  the widget. The player chrome is decorative (the card opens the source link). Cover art only
 *  when the dump actually has art — a bare audio file collapses to text + transport + progress.
 *  Note + meta live in a frosted panel inside the tile, revealed on hover like Media/Video. */
function MusicCard({ dump, bits }: { dump: Dump; bits: CardBits }) {
  const provider = providerMeta(dump.provider);
  const sub = dump.author ?? (bits.dek !== bits.title ? bits.dek : null) ?? provider?.label;
  const title = bits.title ?? provider?.label ?? "Audio";
  return (
    <article {...bits.cardProps} className="d-card d-mus group" data-open={dump.status === "failed" || undefined}>
      {bits.actions}
      <a
        href={bits.href ?? undefined}
        target="_blank"
        rel="noreferrer"
        className={`d-mus-widget${bits.showMedia ? "" : " d-mus-widget--noart"}`}
        aria-label={title}
      >
        {bits.showMedia && (
          <span className="d-mus-art">
            <FadeImg dump={dump} bits={bits} className="d-mus-img" alt={title} />
          </span>
        )}
        <span className="d-mus-face min-w-0">
          {bits.processing && !bits.title ? (
            shimmerLines()
          ) : (
            <>
              <span className="d-mus-text min-w-0">
                <span className="d-mus-title" dir="auto">{title}</span>
                {sub && <span className="d-mus-sub" dir="auto">{sub}</span>}
              </span>
              <span className="d-mus-transport" aria-hidden>
                <svg viewBox="0 0 24 24"><path fill="currentColor" d="M6 5h2.4v14H6zM18 5.5v13L8.4 12z" /></svg>
                <svg viewBox="0 0 24 24" className="d-mus-transport-pause"><path fill="currentColor" d="M7.5 5h3v14h-3zM13.5 5h3v14h-3z" /></svg>
                <svg viewBox="0 0 24 24"><path fill="currentColor" d="M15.6 5H18v14h-2.4zM6 5.5v13L15.6 12z" /></svg>
              </span>
            </>
          )}
        </span>
        {!(bits.processing && !bits.title) && (
          <span className="d-mus-prog" aria-hidden>
            <span className="d-mus-prog-fill" />
          </span>
        )}
        <ProviderIcon provider={dump.provider} className="d-prov d-mus-src" />
      </a>
      <div className="d-mus-panel">
        {!(bits.processing && !bits.title) && (
          <p className="d-mus-ptitle" dir="auto">{title}</p>
        )}
        {dump.note && <p className="d-mus-note" dir="auto">{dump.note}</p>}
        {bits.meta}
      </div>
    </article>
  );
}

const squash = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/** Publication the article came from: brand label for known services, else site name, else domain. */
function articleSource(dump: Dump, site: string | null) {
  const provider = providerMeta(dump.provider);
  return (providerHasIcon(dump.provider) ? provider?.label : null) ?? site ?? dump.domain;
}

/** "A Complete Guide to useEffect — overreacted" -> "A Complete Guide to useEffect": the kicker already names the site. */
function articleHeadline(title: string, dump: Dump, source: string | null) {
  const m = title.match(/^(.+?)\s+[-–—|·:]\s+([^-–—|·:]{2,60})$/u);
  if (!m) return title;
  const tail = squash(m[2]);
  const names = [source, dump.siteName, providerMeta(dump.provider)?.label, dump.domain, dump.domain?.split(".").slice(-2, -1)[0]];
  return names.some((n) => n && squash(n) === tail) ? m[1] : title;
}

/** article — site-name kicker (brand mark for publications) + headline and dek wrapping a small floated thumb.
 *  The headline link stretches over the whole card, so the card reads (and clicks) as one object. */
function ArticleCard({ dump, bits }: { dump: Dump; bits: CardBits }) {
  const source = articleSource(dump, bits.site);
  const rawTitle = bits.title ?? bits.site ?? dump.url;
  const headline = rawTitle ? articleHeadline(rawTitle, dump, source) : null;
  const dek = bits.dek && squash(bits.dek) !== squash(rawTitle ?? "") && squash(bits.dek) !== squash(headline ?? "") ? bits.dek : null;
  // No real title yet, only the URL-derived domain: don't print the site name twice.
  const echoesSource = !!headline && !!source && squash(headline) === squash(source);
  return (
    <article {...bits.cardProps} className="d-card d-article group">
      {bits.actions}
      <div className="d-body d-article-body">
        {source && !(echoesSource && !bits.processing) && (
          <div className="d-kicker" dir="auto">
            <SiteMark dump={dump} />
            <span className="min-w-0 truncate">{source}</span>
          </div>
        )}
        {bits.processing && (!bits.title || echoesSource) ? (
          shimmerLines()
        ) : (
          <>
            {bits.showMedia && <Img dump={dump} bits={bits} className="d-thumb d-article-thumb" />}
            {headline && (
              <h3 className="d-headline d-article-title" dir="auto">
                {bits.href ? <a href={bits.href} target="_blank" rel="noreferrer">{headline}</a> : headline}
              </h3>
            )}
            {dek && <p className="d-dek d-article-dek" dir="auto">{dek}</p>}
          </>
        )}
        {dump.note && <p className="d-annotation" dir="auto">{dump.note}</p>}
        {bits.bareMeta}
      </div>
    </article>
  );
}

/** link — favicon kicker + title + description; hero image when one exists. */
function LinkCard({ dump, bits }: { dump: Dump; bits: CardBits }) {
  return (
    <article {...bits.cardProps} className="d-card group">
      {bits.actions}
      {bits.showMedia && (
        <a href={bits.href ?? undefined} target="_blank" rel="noreferrer" className="d-media">
          <Img dump={dump} bits={bits} className="" alt={bits.title ?? ""} />
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
                {bits.href ? <a href={bits.href} target="_blank" rel="noreferrer">{bits.title ?? bits.site ?? dump.url}</a> : bits.title ?? bits.site ?? dump.url}
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

/* ================================== dispatch ================================== */

export default function DumpCard({ dump, fresh, removing, onTopic, onDelete, onRetry }: Props) {
  const [imgFailed, setImgFailed] = useState(false);
  const topic = topicMeta(dump.topic);
  const kind = dump.kind;
  const provider = providerMeta(dump.provider);
  const processing = dump.status === "processing";
  const subject = dump.subject && (dump.subject.confidence ?? 0) >= SUBJECT_MIN_CONFIDENCE ? dump.subject : null;
  const title = subject ? subjectLine(subject) : dump.title || (dump.url ? titleFromUrl(dump.url) : null);
  const href = dump.url ?? (kind === "image" ? dump.imageUrl : null);
  const site = dump.siteName && dump.siteName.length < 30 ? dump.siteName : dump.domain;
  const showMedia = !!dump.imageUrl && !imgFailed;
  const dek = dump.summary ?? dump.description;
  const filedBy = dump.classifiedBy === "you" ? "Filed by you" : dump.classifiedBy === "ai" ? "Filed by AI" : "Filed automatically";

  const actions = (
    <div className="d-actions">
      <select aria-label="Move to topic" value="" onChange={(e) => e.target.value && onTopic(dump.id, e.target.value)}>
        <option value="" disabled>Move…</option>
        {TOPICS.filter((t) => t.id !== dump.topic).map((t) => (
          <option key={t.id} value={t.id}>{t.label}</option>
        ))}
      </select>
      <button onClick={() => onDelete(dump.id)} aria-label="Delete" title="Delete">×</button>
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

  const metaRow = (siteLabel: string | null) => (
    <div className="d-meta">
      {topicChip}
      {siteLabel && <span className="min-w-0 truncate">{siteLabel}</span>}
      {dump.status === "failed" && (
        <button onClick={() => onRetry(dump.id)} className="d-retry">Retry</button>
      )}
      <time className="ml-auto shrink-0 whitespace-nowrap" dateTime={new Date(dump.createdAt).toISOString()}>
        {timeAgo(dump.createdAt)}
      </time>
    </div>
  );
  const meta = metaRow(site ?? provider?.label ?? kindMeta(kind).singular);

  const bits: CardBits = {
    actions,
    meta,
    bareMeta: metaRow(null),
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
  if (dump.provider === "x") return <XCard dump={dump} bits={bits} />;
  if (dump.provider === "reddit") return <RedditCard dump={dump} bits={bits} />;
  if (dump.provider === "hackernews") return <HnCard dump={dump} bits={bits} />;
  if (dump.provider === "github") return <GithubCard dump={dump} bits={bits} />;
  if (dump.provider === "instagram") return <IgCard dump={dump} bits={bits} />;
  if (kind === "audio") return <MusicCard dump={dump} bits={bits} />;
  if (kind === "video") return <VideoCard dump={dump} bits={bits} />;
  if (kind === "image" && showMedia) return <MediaCard dump={dump} bits={bits} />;
  if (kind === "post" || SOCIAL_PROVIDERS.has(dump.provider ?? "")) return <PostCard dump={dump} bits={bits} />;
  if (kind === "article") return <ArticleCard dump={dump} bits={bits} />;
  return <LinkCard dump={dump} bits={bits} />;
}
