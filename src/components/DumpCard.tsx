"use client";

import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { Menu } from "@base-ui/react/menu";
import type { Dump } from "@/lib/db";
import { SUBJECT_MIN_CONFIDENCE, subjectLine, TOPICS, kindMeta, providerMeta, topicMeta } from "@/lib/taxonomy";
import { timeAgo, shortDate } from "@/lib/format";
import { GITHUB_TAG, githubInfo, type GithubInfo, titleFromUrl } from "@/lib/detect";

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
  film: "M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z",
  person: "M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z",
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

/** Media-card chrome: provider roundel bottom-left, "1/N" counter top-right on multi-image. */
function MediaMark({ dump }: { dump: Dump }) {
  const meta = providerMeta(dump.provider);
  const icon = meta && "icon" in meta && meta.icon;
  const count = dump.imageUrls.length;
  if (!icon && count < 2) return null;
  return (
    <>
      {icon && (
        <span className="d-mmark" title={meta.label}>
          <ProviderIcon provider={dump.provider} />
        </span>
      )}
      {count > 1 && <span className="d-mcount">1/{count}</span>}
    </>
  );
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

/** GitHub titles come back like "GitHub - owner/repo: Desc" or
 *  "Fix bug · Pull Request #12 · owner/repo"; strip the site boilerplate. */
function githubTitle(dump: Dump, info: GithubInfo): string | null {
  let t = (dump.title ?? "").trim();
  if (info.repo) {
    const esc = escapeRe(info.repo);
    t = t
      .replace(new RegExp(`^GitHub\\s*-\\s*${esc}:\\s*`, "i"), "")
      .replace(new RegExp(`\\s*·\\s*(?:Issue|Pull Request|Discussion)\\s*#\\d+\\s*·\\s*${esc}\\s*$`, "i"), "")
      .replace(new RegExp(`\\s*·\\s*${esc}\\s*(?:·\\s*GitHub)?$`, "i"), "")
      .trim();
  }
  if (info.kind === "profile" && info.login) {
    t = t.replace(new RegExp(`^${escapeRe(info.login)}\\s*-\\s*Overview\\s*$`, "i"), info.login).trim();
  }
  // Nothing left but the provider's own echo of the URL — not a title.
  if (!t || /^github\s*-\s*/i.test(t) || (info.repo && t.toLowerCase() === info.repo.toLowerCase())) return null;
  return t;
}

/** Descriptions carry GitHub boilerplate too: "Contribute to owner/repo
 *  development by creating an account on GitHub." and "… - login" on profiles. */
function githubDek(dump: Dump, info: GithubInfo): string | null {
  let d = (dump.description ?? dump.summary ?? "").trim();
  if (!d) return null;
  d = d
    .replace(/\s*Contribute to [\w./-]+ development by creating an account on GitHub\.\s*$/i, "")
    .replace(/\s*-\s*[\w.-]+\s*$/i, (m) => (info.kind === "profile" ? "" : m))
    .trim();
  return d || null;
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
  /** Touch tap-to-reveal: first tap on a media card's face opens its panel (data-open). */
  revealed: boolean;
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

/** Image that fades in once decoded — unless it was already cached, so revisits don't flicker.
 *  Falls back through imageUrls on error; the card only goes media-less when every candidate fails. */
function FadeImg({ dump, bits, className, alt = "" }: { dump: Dump; bits: CardBits; className?: string; alt?: string }) {
  const [loaded, setLoaded] = useState(false);
  const [failedIdx, setFailedIdx] = useState<ReadonlySet<number>>(new Set());
  const all = dump.imageUrls.length ? dump.imageUrls : dump.imageUrl ? [dump.imageUrl] : [];
  const srcIdx = all.findIndex((_, i) => !failedIdx.has(i));
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={(el) => {
        if (el?.complete && el.naturalWidth) setLoaded(true);
      }}
      className={className}
      src={(srcIdx >= 0 ? all[srcIdx] : dump.imageUrl)!}
      alt={alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      data-loaded={loaded || undefined}
      onLoad={() => setLoaded(true)}
      onError={() => {
        setLoaded(false);
        if (srcIdx >= 0 && srcIdx < all.length - 1) {
          setFailedIdx((s) => new Set(s).add(srcIdx));
        } else {
          bits.setImgFailed(true);
        }
      }}
    />
  );
}

/* ============================ platform-native cards ============================ */

/** x — shares the Post card chrome (avatar + name + byline header, provider
 *  mark, framed media with 1/N counter); the tweet text is the content. X
 *  oEmbed rarely returns media or avatars, so the card is designed text-first;
 *  a dead tweet renders a tombstone instead of empty chrome. */
function XCard({ dump, bits }: { dump: Dump; bits: CardBits }) {
  const [failedIdx, setFailedIdx] = useState<ReadonlySet<number>>(new Set());
  const author = postAuthor(dump);
  const raw = dump.author?.replace(/^@/, "");
  // oEmbed author_name can be a display name ("Jane Doe"), not a handle — only @-ify real handles.
  const handle = raw && /^[\w.]{1,30}$/.test(raw) ? `@${raw}` : null;
  const byline = (handle && handle !== author ? handle : null) ?? "X";
  const postText = dump.description ?? dump.summary;
  const text = postText || null;
  const headline =
    bits.title && !bits.processing && bits.title !== postText && !attributionName(dump.title, dump) ? bits.title : null;
  const allImages = dump.imageUrls.length ? dump.imageUrls : dump.imageUrl ? [dump.imageUrl] : [];
  const shownIdx = allImages.findIndex((_, i) => !failedIdx.has(i));
  const images = allImages.filter((_, i) => !failedIdx.has(i));
  return (
    <article {...bits.cardProps} className="d-card d-post group">
      {bits.actions}
      <a href={bits.href ?? undefined} target="_blank" rel="noreferrer" className="d-post-head">
        <span className="d-avatar">{author ? initials(author) : <ProviderIcon provider="x" />}</span>
        <span className="min-w-0">
          <span className="d-author-name" dir="auto">{author ?? "Post"}</span>
          <span className="d-author-site" dir="auto">{byline}</span>
        </span>
        <ProviderIcon provider="x" className="d-prov d-post-prov" />
      </a>
      {bits.processing && !text ? (
        shimmerLines()
      ) : dump.status === "failed" && !text ? (
        <p className="d-tomb">This post doesn&rsquo;t exist.</p>
      ) : (
        <>
          {headline && <p className="d-post-headline" dir="auto">{headline}</p>}
          {text && <p className="d-post-text" dir="auto">{text}</p>}
        </>
      )}
      {images.length > 0 && (
        <a href={bits.href ?? undefined} target="_blank" rel="noreferrer" className="d-post-gallery">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={images[0]} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedIdx((s) => new Set(s).add(shownIdx))} />
          {images.length > 1 && <span className="d-post-count">1/{images.length}</span>}
        </a>
      )}
      {dump.note && <p className="d-annotation" dir="auto">{dump.note}</p>}
      {bits.meta}
    </article>
  );
}

/** threads/bluesky/mastodon/linkedin/facebook — embed look: avatar + name + handle
 *  header, provider mark, text, framed media (a 2×2-capable grid for multiple). */
function PostCard({ dump, bits }: { dump: Dump; bits: CardBits }) {
  const [failedIdx, setFailedIdx] = useState<ReadonlySet<number>>(new Set());
  const provider = providerMeta(dump.provider);
  const author = postAuthor(dump);
  const raw = dump.author?.replace(/^@/, "");
  // oEmbed author_name can be a display name ("Jane Doe"), not a handle — only @-ify real handles.
  const handle = raw && /^[\w.@]{1,40}$/.test(raw) ? `@${raw}` : null;
  const byline = (handle && handle !== author ? handle : null) ?? bits.site ?? provider?.label ?? dump.domain ?? "Post";
  const postText = dump.description ?? dump.summary ?? dump.title;
  const headline = bits.title && bits.title !== postText && !attributionName(dump.title, dump) ? bits.title : null;
  const allImages = dump.imageUrls.length ? dump.imageUrls : dump.imageUrl ? [dump.imageUrl] : [];
  const shownIdx = allImages.findIndex((_, i) => !failedIdx.has(i));
  const images = allImages.filter((_, i) => !failedIdx.has(i));
  return (
    <article {...bits.cardProps} className="d-card d-post group">
      {bits.actions}
      <a href={bits.href ?? undefined} target="_blank" rel="noreferrer" className="d-post-head">
        <span className="d-avatar">{author ? initials(author) : dump.provider ? <ProviderIcon provider={dump.provider} /> : <Glyph name="person" />}</span>
        <span className="min-w-0">
          <span className="d-author-name" dir="auto">{author ?? provider?.label ?? "Post"}</span>
          <span className="d-author-site" dir="auto">{byline}</span>
        </span>
        <ProviderIcon provider={dump.provider} className="d-prov d-post-prov" />
      </a>
      {bits.processing && !postText ? shimmerLines() : (
        <>
          {headline && <p className="d-post-headline" dir="auto">{headline}</p>}
          {postText && <p className="d-post-text" dir="auto">{postText}</p>}
        </>
      )}
      {images.length > 0 && (
        <a href={bits.href ?? undefined} target="_blank" rel="noreferrer" className="d-post-gallery">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={images[0]} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedIdx((s) => new Set(s).add(shownIdx))} />
          {images.length > 1 && <span className="d-post-count">1/{images.length}</span>}
        </a>
      )}
      {dump.note && <p className="d-annotation" dir="auto">{dump.note}</p>}
      {bits.meta}
    </article>
  );
}

/** reddit — r/sub roundel + "r/sub · u/author · ago" kicker, headline, text,
 *  framed media with a 1/N counter. Native-reddit identity without the vote
 *  rail or action row; a dead thread renders a tombstone. */
function RedditCard({ dump, bits }: { dump: Dump; bits: CardBits }) {
  const [failedIdx, setFailedIdx] = useState<ReadonlySet<number>>(new Set());
  const sub = redditSub(dump.url);
  const author = dump.author?.replace(/^u\//, "");
  const headline = bits.title ?? bits.site;
  const text = dump.description ?? dump.summary;
  const allImages = dump.imageUrls.length ? dump.imageUrls : dump.imageUrl ? [dump.imageUrl] : [];
  const shownIdx = allImages.findIndex((_, i) => !failedIdx.has(i));
  const images = allImages.filter((_, i) => !failedIdx.has(i));
  const dead = dump.status === "failed" && !text;
  return (
    <article {...bits.cardProps} className="d-card d-rd group">
      {bits.actions}
      <div className="d-rd-body">
        <div className="d-rd-top">
          <span className="d-rd-mark"><ProviderIcon provider="reddit" /></span>
          <a href={bits.href ?? undefined} target="_blank" rel="noreferrer" className="d-rd-sub" dir="auto">{sub}</a>
          <span className="d-rd-by" dir="auto">
            {author ? `u/${author} · ` : ""}
            {timeAgo(dump.createdAt)}
          </span>
        </div>
        {bits.processing && !dump.title && !text ? (
          shimmerLines()
        ) : dead ? (
          <p className="d-tomb">This thread doesn&rsquo;t exist.</p>
        ) : (
          <>
            {headline && (
              <h3 className="d-rd-title" dir="auto">
                <a href={bits.href ?? undefined} target="_blank" rel="noreferrer">{headline}</a>
              </h3>
            )}
            {text && text !== headline && <p className="d-rd-text" dir="auto">{text}</p>}
          </>
        )}
        {images.length > 0 && (
          <a href={bits.href ?? undefined} target="_blank" rel="noreferrer" className="d-rd-media">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={images[0]} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedIdx((s) => new Set(s).add(shownIdx))} />
            {dump.kind === "video" && <PlayBadge />}
            {images.length > 1 && <span className="d-post-count">1/{images.length}</span>}
          </a>
        )}
        {dump.note && <p className="d-annotation" dir="auto">{dump.note}</p>}
        {bits.meta}
      </div>
    </article>
  );
}

/* What an HN item fetch yields: "<story> | Hacker News" — no author, points, or
   comments, so the card keeps only what is real: title, item type, age, id. */
const HN_PREFIX = /^(Ask|Show|Launch|Tell) HN:\s*/i;
const HN_JOB = /\bis hiring\b|\(YC [A-Z]\d{2}\)|\(YC [FW]\d{2}\)/i;

function hnItem(rawTitle: string | null | undefined) {
  const raw = (rawTitle ?? "")
    .replace(/\s*\|\s*Hacker News\s*$/, "")
    .replace(/\.{3}\s*$/, "…")
    .trim();
  const m = raw.match(HN_PREFIX);
  if (m) {
    const lead = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
    return { kind: m[1].toLowerCase(), tag: `${lead}_HN`.toUpperCase(), raw, rest: raw.slice(m[0].length) || raw };
  }
  if (HN_JOB.test(raw)) return { kind: "job", tag: "JOB", raw, rest: raw };
  return { kind: "story", tag: "STORY", raw, rest: raw };
}

function hnId(url: string | null) {
  return url?.match(/[?&]id=(\d+)/)?.[1] ?? null;
}

/** Fallback when the fetch left nothing but the URL (titleFromUrl → domain). */
function hnFallback(dump: Dump, domainish: string | null) {
  if (domainish && domainish !== dump.domain && domainish !== dump.url) return domainish;
  const id = hnId(dump.url);
  return id ? `Item #${id}` : "Hacker News";
}

/** hackernews — flat Y-orange rail + mono kicker (:\ HACKER_NEWS, type tag),    *
 *  headline as a stretched link over the whole card. */
function HnCard({ dump, bits }: { dump: Dump; bits: CardBits }) {
  const item = hnItem(bits.title);
  const sparse = !item.raw || item.raw === dump.domain || item.raw === dump.url;
  const headline = sparse ? hnFallback(dump, item.raw) : item.kind === "story" || item.kind === "job" ? item.raw : item.rest;
  const text = dump.description ?? dump.summary;
  const body = text && text !== headline ? text : null;
  const dead = dump.status === "failed" && sparse && !body;
  const empty = bits.processing && sparse;
  return (
    <article {...bits.cardProps} className="d-card d-hn group">
      {bits.actions}
      <div className="d-body">
        <div className="d-kicker d-hn-kicker" dir="auto">
          <ProviderIcon provider="hackernews" className="d-prov d-kicker-prov" />
          <span className="min-w-0 truncate">
            <span className="d-hn-ps">:\</span>Hacker_News{!sparse && item.kind !== "story" && <span className="d-hn-tag">&thinsp;{item.tag}</span>}
          </span>
        </div>
        {empty ? (
          shimmerLines()
        ) : dead ? (
          <p className="d-tomb">This item doesn&rsquo;t exist.</p>
        ) : (
          <>
            <h3 className="d-headline" dir="auto">
              {bits.href ? (
                <a href={bits.href} target="_blank" rel="noreferrer">
                  {headline}
                </a>
              ) : (
                headline
              )}
            </h3>
            {body && (
              <p className="d-dek" dir="auto">
                {body}
              </p>
            )}
          </>
        )}
        {dump.note && (
          <p className="d-annotation" dir="auto">
            {dump.note}
          </p>
        )}
        {bits.bareMeta}
      </div>
    </article>
  );
}

/** github — media-first, like the media cards: GitHub's generated og:image (repo
 *  name, description, stats) IS the card at rest; a type tag names the page kind
 *  (Issue/PR/File/Profile) and a glass panel with title + meta rises on hover.
 *  No image → quiet kicker + headline body; dead saves get a tombstone. */
function GithubCard({ dump, bits }: { dump: Dump; bits: CardBits }) {
  const info = githubInfo(dump.url);
  const title = githubTitle(dump, info);
  const dek = githubDek(dump, info);
  const tag = GITHUB_TAG[info.kind];
  const dead = dump.status === "failed";
  // Issues/PRs/discussions carry a real title; for repos, files and profiles the
  // image already says it — the panel names the thing instead.
  const titled = info.kind === "issue" || info.kind === "pr" || info.kind === "discussion";
  const label = (titled ? title : info.filePath ?? info.repo ?? info.login ?? title) ?? info.repo ?? info.login ?? "GitHub";
  const panelDek = dek && dek !== label ? dek : null;
  const tagLabel = `${tag ?? ""}${tag && info.ref ? ` ${info.ref}` : ""}`;

  if (bits.showMedia) {
    return (
      <article {...bits.cardProps} className="d-card d-mediacard d-ghcard group" data-open={dead || bits.revealed || undefined}>
        {bits.actions}
        <a href={bits.href ?? undefined} target="_blank" rel="noreferrer" className="d-media" aria-label={label}>
          <FadeImg dump={dump} bits={bits} alt={titled ? (title ?? "") : ""} />
          <MediaMark dump={dump} />
          {tag && <span className="d-gh-tag">{tagLabel}</span>}
        </a>
        {bits.processing && (
          <span className="d-mchip" aria-hidden>
            <span className="d-mchip-sorting shimmer" />
          </span>
        )}
        <div className="d-mpanel">
          {dead ? (
            <>
              <h3 className="d-mpanel-title" dir="auto">
                {bits.href ? (
                  <a href={bits.href} target="_blank" rel="noreferrer">
                    {label}
                  </a>
                ) : (
                  label
                )}
              </h3>
              <p className="d-tomb">This GitHub page doesn&rsquo;t exist.</p>
            </>
          ) : (
            <>
              <h3 className="d-mpanel-title" dir="auto">
                {bits.href ? (
                  <a href={bits.href} target="_blank" rel="noreferrer">
                    {label}
                  </a>
                ) : (
                  label
                )}
              </h3>
              {panelDek && (
                <p className="d-mpanel-dek" dir="auto">
                  {panelDek}
                </p>
              )}
            </>
          )}
          {dump.note && (
            <p className="d-mpanel-note" dir="auto">
              {dump.note}
            </p>
          )}
          {bits.meta}
        </div>
      </article>
    );
  }

  return (
    <article {...bits.cardProps} className="d-card group">
      {bits.actions}
      <div className="d-body">
        <div className="d-kicker" dir="auto">
          <ProviderIcon provider="github" className="d-prov d-kicker-prov" />
          <span className="min-w-0 truncate">
            GitHub
            {tag && (
              <span className="d-gh-tag-inline">
                {" "}
                · {tagLabel}
              </span>
            )}
          </span>
        </div>
        {bits.processing ? (
          shimmerLines()
        ) : dead ? (
          <>
            <h3 className="d-headline" dir="auto">
              {bits.href ? (
                <a href={bits.href} target="_blank" rel="noreferrer">
                  {label}
                </a>
              ) : (
                label
              )}
            </h3>
            <p className="d-tomb">This GitHub page doesn&rsquo;t exist.</p>
          </>
        ) : (
          <>
            <h3 className="d-headline" dir="auto">
              {bits.href ? (
                <a href={bits.href} target="_blank" rel="noreferrer">
                  {label}
                </a>
              ) : (
                label
              )}
            </h3>
            {dek && (
              <p className="d-dek" dir="auto">
                {dek}
              </p>
            )}
          </>
        )}
        {dump.note && (
          <p className="d-annotation" dir="auto">
            {dump.note}
          </p>
        )}
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
 *  the card — pure media at rest, title/byline/dek/note/meta rise in a glass panel on hover/focus. */
function VideoCard({ dump, bits }: { dump: Dump; bits: CardBits }) {
  if (dump.provider === "youtube") return <YouTubeCard dump={dump} bits={bits} />;
  const t = mediaText(dump, bits);
  const byline =
    [dump.author?.trim(), providerMeta(dump.provider)?.label].filter(Boolean).join(" · ") ||
    (dump.url ? bits.site : null);
  return (
    <article {...bits.cardProps} className="d-card d-mediacard d-vidcard group" data-open={dump.status === "failed" || bits.revealed || undefined}>
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
        <MediaMark dump={dump} />
      </a>
      {bits.processing && (
        <span className="d-mchip" aria-hidden>
          <span className="d-mchip-sorting shimmer" />
        </span>
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

/** image-kind dumps from visual platforms — the image is the card: pure media at rest,
 *  title / dek / note / meta rise in a glass panel on hover or focus. */
function MediaCard({ dump, bits }: { dump: Dump; bits: CardBits }) {
  const t = mediaText(dump, bits);
  return (
    <article {...bits.cardProps} className="d-card d-mediacard group" data-open={dump.status === "failed" || bits.revealed || undefined}>
      {bits.actions}
      <a href={bits.href ?? undefined} target="_blank" rel="noreferrer" className="d-media" aria-label={t.title ?? t.byline ?? "Open image"}>
        <FadeImg dump={dump} bits={bits} alt={t.title ?? ""} />
        {dump.kind === "video" && <PlayBadge />}
        <MediaMark dump={dump} />
      </a>
      {bits.processing && (
        <span className="d-mchip" aria-hidden>
          <span className="d-mchip-sorting shimmer" />
        </span>
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

/** instagram — shares the media-card shell: pure media at rest, the provider
 *  roundel + 1/N counter at the corners, and caption/byline/note/meta rising in
 *  a glass panel on hover/focus. The URL picks the shape — /p/ posts keep their
 *  natural ratio; /reel/ reels frame at 9:16 with a film flag + play badge.
 *  Server fetches hit Instagram's login wall, so URL-only dumps collapse to a
 *  quiet "saved" tile that still names the shape and shortcode. */
function IgCard({ dump, bits }: { dump: Dump; bits: CardBits }) {
  const shape = dump.url && /instagram\.com\/reels?\//.test(dump.url) ? "reel" : "post";
  const shortcode = dump.url?.match(/instagram\.com\/(?:p|reels?)\/([^/?#]+)/)?.[1] ?? null;
  const author = postAuthor(dump);
  const raw = author?.replace(/^@/, "");
  // Only @-ify a real handle — a display name or an "… on Instagram" title isn't one.
  const handle = raw && /^[\w.]{1,30}$/.test(raw) ? `@${raw}` : null;
  const byline = [handle, "Instagram"].filter(Boolean).join(" · ");
  const caption = dump.description?.trim() || dump.summary?.trim() || null;
  // Sparse dumps only have a URL-derived title ("instagram.com") — not a caption.
  const urlTitle = !bits.title || bits.title === dump.domain || bits.title === dump.url;
  const headline = !urlTitle && bits.title !== caption && !attributionName(dump.title, dump) ? bits.title : null;
  const title = headline ?? caption;
  const dek = headline && caption && caption !== headline ? caption : null;
  const dead = dump.status === "failed" && !title;
  return (
    <article
      {...bits.cardProps}
      className={`d-card d-mediacard d-igcard${shape === "reel" ? " d-igreel" : ""} group`}
      data-open={dump.status === "failed" || bits.revealed || undefined}
    >
      {bits.actions}
      {bits.showMedia ? (
        <a
          href={bits.href ?? undefined}
          target="_blank"
          rel="noreferrer"
          className="d-media"
          aria-label={title ?? byline ?? "Open on Instagram"}
        >
          <FadeImg dump={dump} bits={bits} alt={title ?? ""} />
          {shape === "reel" && (
            <span className="d-ig-flag" title="Reel">
              <Glyph name="film" />
            </span>
          )}
          {(shape === "reel" || dump.kind === "video") && <PlayBadge />}
          <MediaMark dump={dump} />
        </a>
      ) : (
        <a href={bits.href ?? undefined} target="_blank" rel="noreferrer" className="d-media d-ig-empty" aria-label="Open on Instagram">
          <span className="d-ig-mark" aria-hidden>
            <ProviderIcon provider="instagram" />
          </span>
          <span>
            <span className="d-ig-empty-name">Instagram {shape === "reel" ? "reel" : "post"}</span>
            {shortcode && <span className="d-ig-empty-sub">/{shape === "reel" ? "reel" : "p"}/{shortcode}</span>}
          </span>
        </a>
      )}
      {bits.processing && (
        <span className="d-mchip" aria-hidden>
          <span className="d-mchip-sorting shimmer" />
        </span>
      )}
      <div className="d-mpanel">
        {bits.processing && !title ? (
          shimmerLines()
        ) : dead ? (
          <p className="d-tomb">This post doesn&rsquo;t exist.</p>
        ) : (
          <>
            {title && (
              <h3 className="d-mpanel-title" dir="auto">
                {bits.href ? (
                  <a href={bits.href} target="_blank" rel="noreferrer">
                    {title}
                  </a>
                ) : (
                  title
                )}
              </h3>
            )}
            <p className="d-mpanel-by">
              <ProviderIcon provider="instagram" className="d-mpanel-prov" />
              <span className="min-w-0 truncate" dir="auto">
                {byline}
              </span>
            </p>
            {dek && <p className="d-mpanel-dek" dir="auto">{dek}</p>}
            {dump.note && <p className="d-annotation d-mpanel-note" dir="auto">{dump.note}</p>}
          </>
        )}
        {bits.meta}
      </div>
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
    <article {...bits.cardProps} className="d-card d-mus group" data-open={dump.status === "failed" || bits.revealed || undefined}>
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

const NOTE_RTL_RE = /[\u0591-\u07FF\u08A0-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFC]/;
const NOTE_LTR_RE = /[A-Za-z\u00C0-\u024F\u1E00-\u1EFF]/;

/** First-strong-character direction. dir="auto" can't be used on the note body:
 *  it skips children carrying their own dir attribute, so the margin rule would
 *  never flip for an RTL note whose header contains a Latin date. */
function noteDir(text: string): "rtl" | "ltr" {
  for (const ch of text) {
    if (NOTE_RTL_RE.test(ch)) return "rtl";
    if (NOTE_LTR_RE.test(ch)) return "ltr";
  }
  return "ltr";
}

/** The text under the catalog header: the title already shows the first line,
 *  so drop it from the ruled text to avoid printing it twice. */
function noteBody(dump: Dump): string | null {
  const content = dump.content ?? "";
  const title = dump.title;
  if (title && content.startsWith(title)) return content.slice(title.length).trimStart() || null;
  return content || null;
}

/** note — an index card: a catalog header (uppercase title + date) over ruled
 *  writing lines, with a red margin rule on the leading edge. Plain card stock —
 *  the topic tint stays in the meta row, not the paper. User text only: no URL,
 *  no provider, nothing to link to. */
function NoteCard({ dump, bits }: { dump: Dump; bits: CardBits }) {
  const body = noteBody(dump);
  return (
    <article {...bits.cardProps} className="d-card group">
      {bits.actions}
      <div className="d-note-body" dir={noteDir(dump.title ?? dump.content ?? "")}>
        {bits.processing && !bits.title ? (
          shimmerLines()
        ) : (
          <>
            <div className="d-note-head">
              <span className="d-note-title" dir="auto">
                {bits.title ?? "Note"}
              </span>
              <time className="d-note-date" dateTime={new Date(dump.createdAt).toISOString()}>
                {shortDate(dump.createdAt)}
              </time>
            </div>
            {body && (
              <p className="d-note-lines" dir="auto">
                {body}
              </p>
            )}
          </>
        )}
        {dump.note && (
          <p className="d-annotation" dir="auto">
            {dump.note}
          </p>
        )}
        {bits.meta}
      </div>
    </article>
  );
}

/** The URL as a readable address: host + path, query dropped unless it's the whole story. */
function linkAddress(dump: Dump): string | null {
  if (!dump.url) return null;
  try {
    const u = new URL(dump.url);
    const path = u.pathname.replace(/\/$/, "");
    const shown = u.host + (path === "" ? "" : decodeURIComponent(path));
    return shown === dump.domain ? null : shown;
  } catch {
    return dump.url;
  }
}

/** Favicon chip: a letter squircle under the favicon-service image, which fades
 *  in on top — the letter stays behind when a site has no icon. */
function LinkMark({ dump }: { dump: Dump }) {
  const [bad, setBad] = useState(false);
  const [loaded, setLoaded] = useState(false);
  return (
    <span className="d-linkmark" aria-hidden>
      <span className="d-linkmark-letter">{dump.domain?.[0]?.toUpperCase() ?? "·"}</span>
      {dump.domain && !bad && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="d-linkmark-img"
          src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(dump.domain)}&sz=64`}
          alt=""
          loading="lazy"
          data-loaded={loaded || undefined}
          onLoad={() => setLoaded(true)}
          onError={() => setBad(true)}
        />
      )}
    </span>
  );
}

/** link — the fallback: a bookmark, not a preview. You save a link to find it
 *  again, so the card is just favicon + title + domain — the title is a classic
 *  blue underlined hyperlink and the card itself is the way out to the page. */
function LinkCard({ dump, bits }: { dump: Dump; bits: CardBits }) {
  // Bare-URL dumps title to the domain — show host+path instead so the card
  // still reads like an address, and don't print the domain twice.
  const titleIsDomain = bits.title != null && bits.title === dump.domain;
  const headline = titleIsDomain ? linkAddress(dump) ?? bits.title : bits.title;
  const empty = bits.processing && !headline;
  const dead = dump.status === "failed" && !headline;
  return (
    <article {...bits.cardProps} className="d-card d-link group">
      {bits.actions}
      <div className="d-link-body">
        <LinkMark dump={dump} />
        {empty ? (
          <span className="d-link-shimmer">
            <span className="shimmer" />
          </span>
        ) : dead ? (
          <p className="d-tomb">This page doesn&rsquo;t exist.</p>
        ) : (
          <div className="d-link-text">
            <h3 className="d-link-title" dir="auto">
              {bits.href ? (
                <a href={bits.href} target="_blank" rel="noreferrer">
                  {headline ?? dump.domain ?? dump.url}
                </a>
              ) : (
                headline ?? dump.domain ?? dump.url ?? "Link"
              )}
            </h3>
            {dump.domain && !titleIsDomain && (
              <span className="d-link-domain" dir="ltr">
                {dump.domain}
              </span>
            )}
          </div>
        )}
      </div>
      {dump.note && (
        <p className="d-annotation" dir="auto">
          {dump.note}
        </p>
      )}
      {bits.bareMeta}
    </article>
  );
}

/* ================================== dispatch ================================== */

export default function DumpCard({ dump, fresh, removing, onTopic, onDelete, onRetry }: Props) {
  const [imgFailed, setImgFailed] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const cardRef = useRef<HTMLElement | null>(null);

  /* A tap outside an open media card closes its panel again. */
  useEffect(() => {
    if (!revealed) return;
    const onDown = (e: PointerEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) setRevealed(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [revealed]);

  /* Tap-to-reveal on coarse pointers, detected with the same capability query
   * the CSS gates on — matchMedia("(hover: none), (pointer: coarse)"). First
   * tap on a media card's face link opens the panel instead of navigating;
   * the second tap follows the link (links inside the open panel navigate
   * directly). Failed dumps keep their always-open panel, so this never runs
   * for them. e.detail === 0 lets keyboard-initiated clicks navigate. */
  const onCardClick = (e: MouseEvent<HTMLElement>) => {
    if (revealed || dump.status === "failed" || e.detail === 0) return;
    const card = e.currentTarget;
    if (!card.classList.contains("d-mediacard") && !card.classList.contains("d-mus")) return;
    if (!window.matchMedia("(hover: none), (pointer: coarse)").matches) return;
    if (!(e.target as HTMLElement).closest("a.d-media, a.d-mus-widget")) return;
    e.preventDefault();
    setRevealed(true);
  };
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
      <Menu.Root>
        <Menu.Trigger className="d-move" aria-label="Move to topic">
          Move…
          <svg viewBox="0 0 10 6" className="d-move-caret" aria-hidden>
            <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner side="bottom" align="end" sideOffset={4}>
            <Menu.Popup className="d-menu">
              {TOPICS.filter((t) => t.id !== dump.topic).map((t) => (
                <Menu.Item key={t.id} className="d-menu-item" onClick={() => onTopic(dump.id, t.id)}>
                  {t.label}
                </Menu.Item>
              ))}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
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
    revealed,
    cardProps: {
      "data-kind": kind,
      "data-provider": dump.provider ?? undefined,
      "data-fresh": fresh || undefined,
      "data-removing": removing || undefined,
      ref: cardRef,
      onClick: onCardClick,
      style: { "--topic": topic.color, "--provider": provider && "color" in provider ? provider.color : undefined } as CSSProperties,
    },
  };

  if (kind === "note") return <NoteCard dump={dump} bits={bits} />;
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
