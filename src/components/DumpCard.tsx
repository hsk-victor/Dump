"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Menu } from "@base-ui/react/menu";
import type { Dump, VideoCopy } from "@/lib/db";
import { exhaustedVideoAsset, mediaSources, videoPoster, videoCopyAction, videoSources } from "@/lib/media";
import { setVideoCopy } from "@/lib/video-copy";
import { ArchiveImage } from "./Media";
import { SUBJECT_MIN_CONFIDENCE, subjectLine, kindMeta, providerMeta, topicMeta, type TopicMeta } from "@/lib/taxonomy";
import { GITHUB_TAG, githubInfo, type GithubInfo, titleFromUrl } from "@/lib/detect";
import { PhoneMenu, PhoneMenuRoot } from "./PhoneMenu";
import { cardState, LOADING_DEADLINE_MS, LOADING_LABEL_DELAY_MS, STILL_LOADING_MS, type CardState } from "@/lib/card-state";

/** Wiring for the actions-row grip: the parent feed owns the drag lifecycle. */
export interface DragHandle {
  onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => void;
}

interface Props {
  dump: Dump;
  phone?: boolean;
  fresh?: boolean;
  removing?: boolean;
  onTopic: (id: string, topic: string) => void;
  onDelete: (id: string) => void;
  onRetry: (id: string) => void;
  onPin: (id: string, pinned: boolean) => void;
  /** Persists a note's edited body; resolves false when the save failed. */
  onSaveNote: (id: string, content: string) => Promise<boolean>;
  /** Present when the card can be grabbed and reordered. */
  drag?: DragHandle;
  /** Live category list — colors chips and fills the Move menu. */
  topics: TopicMeta[];
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
  pin: "M16 9V4l1 0c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1l1 0v5c0 1.66-1.34 3-3 3h-1v2h7v7l1 1 1-1v-7h7v-2h-1c-1.66 0-3-1.34-3-3z",
  pencil: "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z",
  unlink:
    "M17 7h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1 0 1.43-.98 2.63-2.31 2.98l1.46 1.46C20.88 15.61 22 13.95 22 12c0-2.76-2.24-5-5-5zm-1 4h-2.19l2 2H16zM2 4.27l3.11 3.11C3.29 8.12 2 9.91 2 12c0 2.76 2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1 0-1.59 1.21-2.9 2.76-3.07L8.73 11H8v2h2.73L13 15.27V17h1.73l4.01 4L20 19.74 3.27 3 2 4.27z",
  note: "M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm8 1.5V8h4.5L14 3.5zM8 12h8v1.5H8V12zm0 4h8v1.5H8V16z",
  globe:
    "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm6.93 6h-2.95a15.6 15.6 0 0 0-1.38-3.56A8.03 8.03 0 0 1 18.93 8zM12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96zM4.26 14a8.2 8.2 0 0 1 0-4h3.38a16.5 16.5 0 0 0 0 4H4.26zm.81 2h2.95c.32 1.25.78 2.45 1.38 3.56A7.99 7.99 0 0 1 5.07 16zm2.95-8H5.07a7.99 7.99 0 0 1 4.33-3.56A15.6 15.6 0 0 0 8.02 8zM12 19.96c-.83-1.2-1.48-2.53-1.91-3.96h3.82c-.43 1.43-1.08 2.76-1.91 3.96zM14.34 14H9.66a14.7 14.7 0 0 1 0-4h4.68a14.7 14.7 0 0 1 0 4zm.25 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95a8.03 8.03 0 0 1-4.33 3.56zM16.36 14a16.5 16.5 0 0 0 0-4h3.38a8.2 8.2 0 0 1 0 4h-3.38z",
  grip: "M11 18c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2zm-2-8c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm0-5c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm6 4c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z",
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

/** The card's one small source cue: brand mark, else the site's favicon, else a globe. */
function SourceGlyph({ dump }: { dump: Dump }) {
  const [bad, setBad] = useState(false);
  if (providerHasIcon(dump.provider)) return <ProviderIcon provider={dump.provider} className="d-prov d-src" />;
  if (dump.kind === "note") return <Glyph name="note" className="d-src" />;
  if (!dump.domain || bad) return <Glyph name="globe" className="d-src" />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="d-src d-src-favicon"
      src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(dump.domain)}&sz=64`}
      alt=""
      loading="lazy"
      onError={() => setBad(true)}
    />
  );
}

/** GitHub's repository octicon. */
function RepoGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="d-gh-repo" aria-hidden>
      <path fill="currentColor" d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8ZM5 12.25a.25.25 0 0 1 .25-.25h3.5a.25.25 0 0 1 .25.25v3.25a.25.25 0 0 1-.4.2l-1.45-1.087a.249.249 0 0 0-.3 0L5.4 15.7a.25.25 0 0 1-.4-.2Z" />
    </svg>
  );
}

/** A real carousel count is the only chrome a media card shows at rest. */
function MediaMark({ dump }: { dump: Dump }) {
  const count = dump.imageUrls.length;
  return count > 1 ? <span className="d-mcount">1/{count}</span> : null;
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

/** A video whose only kept copy is its poster can't play: say so instead of drawing a play button. */
function PlayOrPreview({ bits }: { bits: CardBits }) {
  if (bits.posterOnly) return <span className="d-preview-only">Preview only</span>;
  return <PlayBadge />;
}

/** Exception rows under the content, above topic/date: loading, original unavailable, failed.
 *  A saved card renders none — that's the quiet default. */
function StateRows({ state, retryName, onRetry, videoCopy, onVideoCopy, canSaveVideo }: { state: CardState; retryName: string; onRetry: () => void; videoCopy: VideoCopy | null; onVideoCopy: (keep: boolean) => void; canSaveVideo: boolean }) {
  // One start and one outcome message: "Still …" is the same operation, not a new announcement.
  const live = state.failed?.label ?? (state.loading?.showLabel ? state.loading.label.replace(/^Still (\w)/, (_, c: string) => c.toUpperCase()) : "");
  const unavailableCopy = !!state.unavailable && videoCopy?.state === "missing";
  const unavailableLabel = unavailableCopy ? "Original unavailable · Local copy missing" : "Original unavailable";
  return (
    <>
      <span className="sr-only" aria-live="polite">
        {unavailableCopy ? unavailableLabel : videoCopy?.state === "pending" ? "Saving video…" : videoCopy?.state === "failed" ? "Couldn't save video" : videoCopy?.state === "missing" ? "Local copy missing" : live}
      </span>
      {videoCopy && !unavailableCopy && (
        <div className={`d-state${videoCopy.state === "failed" ? " d-state-failed" : videoCopy.state === "pending" ? " d-state-loading" : ""}`}>
          {videoCopy.state === "pending" && <span className="d-spinner" aria-hidden />}
          <span className="d-state-text">{videoCopy.state === "pending" ? "Saving video…" : videoCopy.state === "failed" ? "Couldn't save video" : "Local copy missing"}</span>
          {videoCopy.state === "pending" ? (
            <button type="button" className="d-state-retry" onClick={() => onVideoCopy(false)} aria-label={`Cancel saving video, ${retryName}`}>Cancel</button>
          ) : canSaveVideo && (
            <button type="button" className="d-state-retry" onClick={() => onVideoCopy(true)} aria-label={`Retry saving video, ${retryName}`}>Retry</button>
          )}
        </div>
      )}
      {state.unavailable && (
        <div className="d-state d-state-gone">
          <Glyph name="unlink" className="d-state-icon" />
          <span className="d-state-text">
            {unavailableLabel}
            {!unavailableCopy && state.unavailable.detail && <span className="d-state-sub">{state.unavailable.detail}</span>}
          </span>
        </div>
      )}
      {state.loading?.showLabel && (
        <div className="d-state d-state-loading">
          <span className="d-spinner" aria-hidden />
          <span className="d-state-text">{state.loading.label}</span>
        </div>
      )}
      {state.failed && (
        <div className="d-state d-state-failed">
          <span className="d-state-text">{state.failed.label}</span>
          <button type="button" className="d-state-retry" onClick={onRetry} aria-label={`${state.failed.action}, ${retryName}`}>
            Retry
          </button>
        </div>
      )}
    </>
  );
}

/** Re-renders a loading card exactly when its label should change (300ms, 10s, 30s). */
function useStateClock(processing: boolean, since: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!processing) return;
    const age = Date.now() - since;
    const next = [LOADING_LABEL_DELAY_MS, STILL_LOADING_MS, LOADING_DEADLINE_MS].find((t) => t > age);
    if (next === undefined) return;
    const t = window.setTimeout(() => setNow(Date.now()), next - age + 5);
    return () => window.clearTimeout(t);
  }, [processing, since, now]);
  return now;
}

const subscribeOnline = (cb: () => void) => {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
};
function useOnline() {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
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
  phone: boolean;
  /** Exception rows, then the bottom rail: the source cue at rest; Dump's actions
   *  fill its trailing end on hover/focus (in flow on phones). */
  rail: (glyph?: ReactNode) => ReactNode;
  /** Media cards: the in-flow rail on phones; on desktop just the exception rows, since
   *  the source rides in the hover actions. */
  mediaFoot: (glyph?: ReactNode) => ReactNode;
  href: string | null;
  title: string | null;
  dek: string | null;
  site: string | null;
  showMedia: boolean;
  setImgFailed: (v: boolean) => void;
  processing: boolean;
  /** Failed, unavailable or saving a video copy: media cards show their retained details in flow. */
  exposed: boolean;
  /** Original confirmed gone. */
  gone: boolean;
  posterOnly: boolean;
  onVideoMissing: (local: string) => void;
  cardProps: Record<string, unknown>;
  /** Persistent badge marking a pinned media card on desktop (other cards get a rail pin). */
  pinBadge: ReactNode;
  /** Note-card editing, hoisted here so the menu can offer Edit. */
  editingNote: boolean;
  beginNoteEdit: () => void;
  endNoteEdit: () => void;
  onSaveNote: Props["onSaveNote"];
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
    <ArchiveImage dump={dump} className={className} src={dump.imageUrl!} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => bits.setImgFailed(true)} />
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
    <ArchiveImage dump={dump}
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

/** Inline video: plays muted on loop while at least a quarter of it is on
 *  screen and pauses when scrolled away, so off-screen cards cost nothing.
 *  `prefers-reduced-motion` holds playback until the user starts it; a clip
 *  without `controls` (ambient animation) gets a tap-to-play overlay instead. */
function LoopVideo({
  src,
  dump,
  poster,
  controls,
  className,
  label,
  onVideoMissing,
}: {
  src: string;
  dump: Dump;
  poster?: string;
  controls?: boolean;
  className?: string;
  label: string;
  onVideoMissing: (local: string) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const sources = videoSources(dump, src);
  const [failedSources, setFailedSources] = useState<Set<string>>(new Set());
  const currentSource = sources.find((url) => !failedSources.has(url));
  const [failedPosters, setFailedPosters] = useState<Set<string>>(new Set());
  const posters = dump.videoPosterUrl ? mediaSources(dump, dump.videoPosterUrl) : [videoPoster(dump) ?? poster];
  const shownPoster = posters.find((url) => url && !failedPosters.has(url));
  const posterCount = posters.filter(Boolean).length;
  useEffect(() => {
    if (!shownPoster || posterCount < 2) return;
    const image = new Image();
    image.onerror = () => setFailedPosters((failed) => new Set([...failed, shownPoster]));
    image.src = shownPoster;
    return () => { image.onerror = null; };
  }, [shownPoster, posterCount]);
  const [playing, setPlaying] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    const el = video.current;
    if (!el) return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    let inView = false;
    const sync = () => {
      if (inView && !preference.matches) void el.play().catch(() => {});
      else el.pause();
    };
    const observer = new IntersectionObserver(
      ([entry]) => {
        // isIntersecting trips on any sliver; the fraction is what honors the threshold.
        inView = entry.intersectionRatio >= 0.25;
        sync();
      },
      { threshold: 0.25 },
    );
    observer.observe(el);
    setReducedMotion(preference.matches);
    const onPreference = () => {
      setReducedMotion(preference.matches);
      sync();
    };
    preference.addEventListener("change", onPreference);
    return () => {
      observer.disconnect();
      preference.removeEventListener("change", onPreference);
    };
  }, [currentSource]);
  if (!currentSource) return <>
    {shownPoster && <ArchiveImage dump={dump} src={shownPoster} className={className} alt={label} />}
    <span className="d-preview-only">Preview only</span>
  </>;
  return (
    <>
      <video
        ref={video}
        className={className}
        src={currentSource}
        poster={shownPoster}
        controls={controls}
        muted
        loop
        playsInline
        preload="metadata"
        aria-label={label}
        onPlaying={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onError={() => {
          setPlaying(false);
          const failed = new Set([...failedSources, currentSource]);
          setFailedSources(failed);
          const local = exhaustedVideoAsset(sources, failed);
          if (local) onVideoMissing(local);
        }}
      />
      {!controls && (reducedMotion || !playing) && (
        <button
          className="d-animation-toggle"
          aria-label={playing ? "Pause animation" : "Play animation"}
          onClick={() => {
            if (playing) video.current?.pause();
            else void video.current?.play().catch(() => setPlaying(false));
          }}
        >
          {!playing && <PlayBadge />}
        </button>
      )}
    </>
  );
}

function XVideo({ dump, author, onVideoMissing }: { dump: Dump; author: string | null; onVideoMissing: (local: string) => void }) {
  const animated = dump.videoType === "animated_gif";
  return (
    <div className="d-post-video-frame">
      <LoopVideo
        dump={dump}
        onVideoMissing={onVideoMissing}
        className="d-post-video"
        src={`/api/dumps/${dump.id}/video`}
        poster={dump.videoPosterUrl ?? undefined}
        controls={!animated}
        label={`${animated ? "Animation" : "Video"} by ${author ?? "X author"}`}
      />
    </div>
  );
}

/** x — native post chrome with inline media; a gone post keeps whatever was saved. */
function XCard({ dump, bits }: { dump: Dump; bits: CardBits }) {
  const [failedIdx, setFailedIdx] = useState<ReadonlySet<number>>(new Set());
  const [xrFailed, setXrFailed] = useState(false);
  const author = postAuthor(dump);
  const raw = (dump.authorHandle ?? dump.author)?.replace(/^@/, "");
  // oEmbed author_name can be a display name ("Jane Doe"), not a handle — only @-ify real handles.
  const handle = raw && /^[\w.]{1,30}$/.test(raw) ? `@${raw}` : null;
  const byline = (handle && handle !== author ? handle : null) ?? "X";
  const postText = dump.description ?? dump.summary;
  const text = postText || null;
  const headline =
    bits.title && !bits.processing && bits.title !== postText && bits.title !== dump.domain && !attributionName(dump.title, dump) ? bits.title : null;
  const allImages = dump.imageUrls.length ? dump.imageUrls : dump.imageUrl ? [dump.imageUrl] : [];
  const images = allImages.filter((_, i) => !failedIdx.has(i));
  // Media posts show the media itself; the render is for text-only posts.
  const hasMedia = allImages.length > 0 || !!dump.videoUrl;
  // A lost uploads dir or a foreign-shape snapshot (no light PNG) leaves no
  // usable render — fall back to the built card.
  const xr = hasMedia || xrFailed || !dump.xRender?.light ? null : dump.xRender;
  const media = images.length > 0 || !!dump.videoUrl;
  const bare = media && !images.length && !!dump.videoUrl;
  return (
    <article {...bits.cardProps} className={`d-card d-post group${xr ? " d-xpost" : bare ? " d-xvid" : ""}`}>
      {xr ? (
        /* The post as x.com draws it — a snapshot rendered at save time. */
        <a href={bits.href ?? undefined} target="_blank" rel="noreferrer" className="d-xrender">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={xr.light} alt={text ?? `Post by ${author ?? "an X author"}`} className="d-xrender-img" loading="lazy" onError={() => setXrFailed(true)} />
          {xr.dark && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={xr.dark} alt={text ?? `Post by ${author ?? "an X author"}`} className="d-xrender-img d-xrender-dark" loading="lazy" onError={() => setXrFailed(true)} />
          )}
        </a>
      ) : media ? (
        /* Just the media — it still links through to the post. */
        <>
          {dump.videoUrl &&
            (bits.posterOnly ? (
              <div className="d-post-video-frame d-poster-frame">
                {videoPoster(dump) && (
                  <ArchiveImage dump={dump} className="d-post-video" src={dump.videoPosterUrl ?? videoPoster(dump)} alt="" loading="lazy" referrerPolicy="no-referrer" />
                )}
                <PlayOrPreview bits={bits} />
              </div>
            ) : (
              <XVideo dump={dump} author={author} onVideoMissing={bits.onVideoMissing} />
            ))}
          {images.length > 0 && (
            <a href={bits.href ?? undefined} target="_blank" rel="noreferrer" className={`d-post-gallery${images.length > 1 ? " d-post-grid" : ""}`}>
              {allImages.map((src, i) => !failedIdx.has(i) && (
                <ArchiveImage dump={dump} key={src} src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedIdx((s) => new Set(s).add(i))} />
              ))}
            </a>
          )}
        </>
      ) : (
        <>
          <a href={bits.href ?? undefined} target="_blank" rel="noreferrer" className="d-post-head">
            <span className="d-avatar">
              {dump.authorAvatarUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={dump.authorAvatarUrl} alt="" referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.hidden = true; }} />
              ) : author ? initials(author) : <ProviderIcon provider="x" />}
            </span>
            <span className="min-w-0">
              <span className="d-author-name" dir="auto">{author ?? "Post"}</span>
              <span className="d-author-site" dir="auto">{byline}</span>
            </span>
            <ProviderIcon provider="x" className="d-prov d-post-prov" />
          </a>
          {bits.processing && !text ? (
            shimmerLines()
          ) : (
            <>
              {headline && <p className="d-post-headline" dir="auto">{headline}</p>}
              {text && <p className="d-post-text" dir="auto">{text}</p>}
            </>
          )}
        </>
      )}
      {dump.note && <p className="d-annotation" dir="auto">{dump.note}</p>}
      {bits.rail(xr || media ? <SourceGlyph dump={dump} /> : null)}
    </article>
  );
}

/** threads/bluesky/mastodon/linkedin/facebook — an excerpt: the saved words on a warm
 *  reading surface, framed media, and the provider mark as the one source cue. */
function PostCard({ dump, bits }: { dump: Dump; bits: CardBits }) {
  const [failedIdx, setFailedIdx] = useState<ReadonlySet<number>>(new Set());
  const author = postAuthor(dump);
  const postText = dump.description ?? dump.summary ?? dump.title;
  const allImages = dump.imageUrls.length ? dump.imageUrls : dump.imageUrl ? [dump.imageUrl] : [];
  const shownIdx = allImages.findIndex((_, i) => !failedIdx.has(i));
  const images = allImages.filter((_, i) => !failedIdx.has(i));
  return (
    <article {...bits.cardProps} className="d-card d-post d-excerpt group">
      {bits.processing && !postText ? shimmerLines() : postText && (
        <blockquote className="d-excerpt-quote">
          <p className="d-excerpt-text" dir="auto">{postText}</p>
        </blockquote>
      )}
      {images.length > 0 && (
        <a href={bits.href ?? undefined} target="_blank" rel="noreferrer" className="d-post-gallery">
          <ArchiveImage dump={dump} src={images[0]} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedIdx((s) => new Set(s).add(shownIdx))} />
          {images.length > 1 && <span className="d-post-count">1/{images.length}</span>}
        </a>
      )}
      {dump.note && <p className="d-annotation" dir="auto">{dump.note}</p>}
      {/* A failed fetch may have kept little but who posted it. */}
      {bits.exposed && author && <p className="d-excerpt-by" dir="auto">{author}</p>}
      {bits.rail(<SourceGlyph dump={dump} />)}
    </article>
  );
}

/** reddit — community mark + r/sub, discussion title, a short excerpt and framed
 *  media. No vote rail, author, age or counts; a gone thread keeps whatever was saved. */
function RedditCard({ dump, bits }: { dump: Dump; bits: CardBits }) {
  const [failedIdx, setFailedIdx] = useState<ReadonlySet<number>>(new Set());
  const sub = redditSub(dump.url);
  const headline = bits.title ?? bits.site;
  const text = dump.description ?? dump.summary;
  const allImages = dump.imageUrls.length ? dump.imageUrls : dump.imageUrl ? [dump.imageUrl] : [];
  const shownIdx = allImages.findIndex((_, i) => !failedIdx.has(i));
  const images = allImages.filter((_, i) => !failedIdx.has(i));
  return (
    <article {...bits.cardProps} className="d-card d-rd group">
      <div className="d-rd-body">
        <div className="d-rd-top">
          <span className="d-rd-mark"><ProviderIcon provider="reddit" /></span>
          <a href={bits.href ?? undefined} target="_blank" rel="noreferrer" className="d-rd-sub" dir="auto">{sub}</a>
        </div>
        {bits.processing && !dump.title && !text ? (
          shimmerLines()
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
            <ArchiveImage dump={dump} src={images[0]} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedIdx((s) => new Set(s).add(shownIdx))} />
            {dump.kind === "video" && <PlayOrPreview bits={bits} />}
            {images.length > 1 && <span className="d-post-count">1/{images.length}</span>}
          </a>
        )}
        {dump.note && <p className="d-annotation" dir="auto">{dump.note}</p>}
        {bits.rail()}
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

/** hackernews — a firm headline ("Show HN" stays part of it) and the Y mark as its source cue. */
function HnCard({ dump, bits }: { dump: Dump; bits: CardBits }) {
  const item = hnItem(bits.title);
  const sparse = !item.raw || item.raw === dump.domain || item.raw === dump.url;
  const headline = sparse ? hnFallback(dump, item.raw) : item.raw;
  const text = dump.description ?? dump.summary;
  const body = text && text !== headline ? text : null;
  const empty = bits.processing && sparse;
  return (
    <article {...bits.cardProps} className="d-card d-hn group">
      <div className="d-body">
        {empty ? (
          shimmerLines()
        ) : (
          <>
            <h3 className="d-headline d-hn-title" dir="auto">
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
        {bits.rail(<SourceGlyph dump={dump} />)}
      </div>
    </article>
  );
}

/** github — a repository reads as GitHub's own repository card: the repo glyph, blue
 *  owner / name and its real description, never invented stats. Other pages (issues,
 *  PRs, files, profiles) keep their type and title; a saved preview image still leads. */
function GithubCard({ dump, bits }: { dump: Dump; bits: CardBits }) {
  const info = githubInfo(dump.url);
  const title = githubTitle(dump, info);
  const dek = githubDek(dump, info);
  const tag = GITHUB_TAG[info.kind];
  // Issues/PRs/discussions carry a real title; for repos, files and profiles the
  // image already says it — the panel names the thing instead.
  const titled = info.kind === "issue" || info.kind === "pr" || info.kind === "discussion";
  const label = (titled ? title : info.filePath ?? info.repo ?? info.login ?? title) ?? info.repo ?? info.login ?? "GitHub";
  const panelDek = dek && dek !== label ? dek : null;
  const tagLabel = `${tag ?? ""}${tag && info.ref ? ` ${info.ref}` : ""}`;

  if (info.kind === "repo" && info.repo) {
    const [owner, name] = info.repo.split("/");
    const about = dek ?? title;
    const path = (
      <>
        {owner} / <strong>{name}</strong>
      </>
    );
    return (
      <article {...bits.cardProps} className="d-card d-gh group">
        <div className="d-body">
          <h3 className="d-gh-path">
            <RepoGlyph />
            {bits.href ? (
              <a href={bits.href} target="_blank" rel="noreferrer">
                {path}
              </a>
            ) : (
              <span>{path}</span>
            )}
          </h3>
          {bits.processing && !about ? shimmerLines() : about && <p className="d-gh-about" dir="auto">{about}</p>}
          {dump.note && (
            <p className="d-annotation" dir="auto">
              {dump.note}
            </p>
          )}
          {bits.rail(<SourceGlyph dump={dump} />)}
        </div>
      </article>
    );
  }

  if (bits.showMedia) {
    return (
      <article {...bits.cardProps} className="d-card d-mediacard d-ghcard group" data-open={bits.exposed || undefined}>
        {bits.pinBadge}
        <div className="d-mframe">
          <a href={bits.href ?? undefined} target="_blank" rel="noreferrer" className="d-media" aria-label={label}>
            <FadeImg dump={dump} bits={bits} alt={titled ? (title ?? "") : ""} />
            <MediaMark dump={dump} />
            {tag && <span className="d-gh-tag">{tagLabel}</span>}
          </a>
        </div>
        <MediaFoot dump={dump} bits={bits} title={label} byline={null} dek={panelDek} />
      </article>
    );
  }

  return (
    <article {...bits.cardProps} className="d-card group">
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
        {bits.processing && !title ? (
          shimmerLines()
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
        {bits.rail()}
      </div>
    </article>
  );
}

/** Under a media card: the retained details while something needs attention, else just
 *  the owner's own note; then the exception rows (plus the rail on phones). */
function MediaFoot({ dump, bits, title, byline, dek }: { dump: Dump; bits: CardBits; title: string | null; byline: string | null; dek: string | null }) {
  return (
    <>
      {bits.exposed ? (
        <div className="d-mpanel">
          {title && (
            <h3 className="d-mpanel-title" dir="auto">
              {bits.href ? <a href={bits.href} target="_blank" rel="noreferrer">{title}</a> : title}
            </h3>
          )}
          {byline && (
            <p className="d-mpanel-by">
              <span className="min-w-0 truncate" dir="auto">{byline}</span>
            </p>
          )}
          {dek && <p className="d-mpanel-dek" dir="auto">{dek}</p>}
          {dump.note && <p className="d-annotation d-mpanel-note" dir="auto">{dump.note}</p>}
        </div>
      ) : (
        dump.note && <p className="d-annotation d-mnote" dir="auto">{dump.note}</p>
      )}
      {bits.mediaFoot(<SourceGlyph dump={dump} />)}
    </>
  );
}

/** video — every provider (YouTube, Vimeo, TikTok, Loom, plain files) shares one quiet poster
 *  at its native ratio with a small play cue. No logo, caption or creator on the face. */
function VideoCard({ dump, bits }: { dump: Dump; bits: CardBits }) {
  const t = mediaText(dump, bits);
  const poster = dump.videoPosterUrl ?? videoPoster(dump);
  const byline =
    [dump.author?.trim(), providerMeta(dump.provider)?.label].filter(Boolean).join(" · ") ||
    (dump.url ? bits.site : null);
  const label = [t.title, byline].filter(Boolean).join(", ") || "Open video";
  return (
    <article {...bits.cardProps} className={`d-card d-mediacard d-vidcard group${dump.videoUrl ? " d-inline-video" : ""}${dump.provider === "tiktok" ? " d-vidcard-portrait" : ""}`} data-open={bits.exposed || undefined}>
      {bits.pinBadge}
      <div className="d-mframe">
        {dump.videoUrl && !bits.posterOnly ? (
          <div className="d-media d-vmedia">
            <LoopVideo dump={dump} src={dump.videoUrl} poster={dump.videoPosterUrl ?? undefined} controls label={t.title ?? "Video"} onVideoMissing={bits.onVideoMissing} />
            <MediaMark dump={dump} />
          </div>
        ) : (
          <a href={bits.href ?? undefined} target="_blank" rel="noreferrer" className="d-media d-vmedia" aria-label={label}>
            {bits.posterOnly && poster ? (
              <FadeImg dump={{ ...dump, imageUrl: poster, imageUrls: [poster] }} bits={bits} alt={t.title ?? ""} />
            ) : bits.showMedia ? (
              <FadeImg dump={dump} bits={bits} alt={t.title ?? ""} />
            ) : (
              <span className="d-vph" aria-hidden>
                <ProviderIcon provider={dump.provider} />
              </span>
            )}
            <PlayOrPreview bits={bits} />
            <MediaMark dump={dump} />
          </a>
        )}
      </div>
      <MediaFoot dump={dump} bits={bits} title={t.title} byline={byline} dek={t.dek} />
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

/** image-kind dumps — the image is the card: pure media at rest, nothing laid over it
 *  but a real carousel count. */
function MediaCard({ dump, bits }: { dump: Dump; bits: CardBits }) {
  const t = mediaText(dump, bits);
  return (
    <article {...bits.cardProps} className="d-card d-mediacard group" data-open={bits.exposed || undefined}>
      {bits.pinBadge}
      <div className="d-mframe">
        <a href={bits.href ?? undefined} target="_blank" rel="noreferrer" className="d-media" aria-label={t.title ?? t.byline ?? "Open image"}>
          <FadeImg dump={dump} bits={bits} alt={t.title ?? ""} />
          {dump.kind === "video" && <PlayOrPreview bits={bits} />}
          <MediaMark dump={dump} />
        </a>
      </div>
      <MediaFoot dump={dump} bits={bits} title={t.title} byline={t.byline} dek={t.dek} />
    </article>
  );
}

/** instagram — shares the media-card shell: pure media at rest with an honest 1/N
 *  counter; no logo over the photo. The URL picks the shape — /p/ posts keep their
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
  return (
    <article
      {...bits.cardProps}
      className={`d-card d-mediacard d-igcard${shape === "reel" ? " d-igreel" : ""} group`}
      data-open={bits.exposed || undefined}
    >
      {bits.pinBadge}
      <div className="d-mframe">
        {bits.showMedia ? (
          <a href={bits.href ?? undefined} target="_blank" rel="noreferrer" className="d-media" aria-label={title ?? byline ?? "Open on Instagram"}>
            <FadeImg dump={dump} bits={bits} alt={title ?? ""} />
            {(shape === "reel" || dump.kind === "video") && <PlayOrPreview bits={bits} />}
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
      </div>
      <MediaFoot dump={dump} bits={bits} title={title} byline={byline} dek={dek} />
    </article>
  );
}

/** spotify/soundcloud/applemusic/bandcamp — square album artwork, nothing pretending to be a
 *  player. Without art: the title and artist, with the service mark as the source cue. */
function MusicCard({ dump, bits }: { dump: Dump; bits: CardBits }) {
  const provider = providerMeta(dump.provider);
  const sub = dump.author ?? (bits.dek !== bits.title ? bits.dek : null) ?? provider?.label ?? null;
  const title = bits.title ?? provider?.label ?? "Audio";
  if (bits.showMedia) {
    return (
      <article {...bits.cardProps} className="d-card d-mediacard d-muscard group" data-open={bits.exposed || undefined}>
        {bits.pinBadge}
        <div className="d-mframe">
          <a href={bits.href ?? undefined} target="_blank" rel="noreferrer" className="d-media" aria-label={[title, sub].filter(Boolean).join(", ")}>
            <FadeImg dump={dump} bits={bits} alt={title} />
          </a>
        </div>
        <MediaFoot dump={dump} bits={bits} title={title} byline={sub} dek={null} />
      </article>
    );
  }
  return (
    <article {...bits.cardProps} className="d-card d-musnoart group">
      <div className="d-body">
        {bits.processing && !bits.title ? (
          shimmerLines()
        ) : (
          <>
            <h3 className="d-headline" dir="auto">
              {bits.href ? <a href={bits.href} target="_blank" rel="noreferrer">{title}</a> : title}
            </h3>
            {sub && <p className="d-dek" dir="auto">{sub}</p>}
          </>
        )}
        {dump.note && <p className="d-annotation" dir="auto">{dump.note}</p>}
        {bits.rail(<SourceGlyph dump={dump} />)}
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

/** article — a captured cover leads; otherwise the headline carries the card. The headline
 *  link stretches over the whole card, and the site's mark is the one source cue. */
function ArticleCard({ dump, bits }: { dump: Dump; bits: CardBits }) {
  const source = articleSource(dump, bits.site);
  const rawTitle = bits.title ?? bits.site ?? dump.url;
  const headline = rawTitle ? articleHeadline(rawTitle, dump, source) : null;
  const dek = bits.dek && squash(bits.dek) !== squash(rawTitle ?? "") && squash(bits.dek) !== squash(headline ?? "") ? bits.dek : null;
  // No real title yet, only the URL-derived domain: don't print the site name twice.
  const echoesSource = !!headline && !!source && squash(headline) === squash(source);
  return (
    <article {...bits.cardProps} className="d-card d-article group">
      {bits.showMedia && (
        <div className="d-article-cover">
          <Img dump={dump} bits={bits} className="d-article-img" />
        </div>
      )}
      <div className="d-body d-article-body">
        {bits.processing && (!bits.title || echoesSource) ? (
          shimmerLines()
        ) : (
          <>
            {headline && (
              <h3 className="d-headline d-article-title" dir="auto">
                {bits.href ? <a href={bits.href} target="_blank" rel="noreferrer">{headline}</a> : headline}
              </h3>
            )}
            {dek && <p className="d-dek d-article-dek" dir="auto">{dek}</p>}
          </>
        )}
        {dump.note && <p className="d-annotation" dir="auto">{dump.note}</p>}
        {bits.rail(<SourceGlyph dump={dump} />)}
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

/** note — an index card: the note's first line as an uppercase heading over ruled
 *  writing lines, with a red margin rule on the leading edge. Plain card stock —
 *  the topic tint stays in the meta row, not the paper. User text only: no URL,
 *  no provider, nothing to link to. Clicking the body (or the Edit action) swaps
 *  the ruled text for an editor on the same lines. */
function NoteCard({ dump, bits }: { dump: Dump; bits: CardBits }) {
  const body = dump.content || bits.title;
  const [expanded, setExpanded] = useState(false);
  // The first line is the note's own heading; the rest sits on the ruled lines.
  const lines = (body ?? "").split("\n");
  const heading = lines.length > 1 && lines[0].trim() ? lines[0].trim() : null;
  const text = heading ? lines.slice(1).join("\n").replace(/^\s*\n/, "") : body;
  const preview = bits.phone && text ? notePreview(text) : text;
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const openTimer = useRef<number | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const editing = bits.editingNote;

  useEffect(() => () => window.clearTimeout(openTimer.current), []);

  useEffect(() => {
    if (!editing) return;
    const el = areaRef.current;
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, [editing]);

  const save = async () => {
    const el = areaRef.current;
    if (!el || saving) return;
    const text = el.value.trim();
    // Clicking away without changes (or a wiped note) just closes the editor.
    if (!text || text === (dump.content ?? "").trim()) {
      setSaveFailed(false);
      bits.endNoteEdit();
      return;
    }
    setSaving(true);
    // A request that never got an answer (offline, server down) is a failed save too.
    const ok = await bits.onSaveNote(dump.id, text).catch(() => false);
    setSaving(false);
    // A failed save keeps the editor and the draft open until a retry lands.
    setSaveFailed(!ok);
    if (ok) bits.endNoteEdit();
  };

  const discard = () => {
    const dirty = (areaRef.current?.value.trim() ?? "") !== (dump.content ?? "").trim();
    if (dirty && !window.confirm("Discard your unsaved changes to this note?")) return;
    setSaveFailed(false);
    bits.endNoteEdit();
  };

  return (
    <article {...bits.cardProps} className="d-card group">
      <div className="d-note-body" dir={noteDir(body ?? "")}>
        {editing ? (
          <>
            <div className="d-note-head">
              <span className="d-note-title">Editing</span>
            </div>
            <textarea
              ref={areaRef}
              className="d-note-edit"
              defaultValue={dump.content ?? ""}
              dir={noteDir(dump.content ?? "")}
              rows={Math.min(Math.max((dump.content ?? "").split("\n").length, 3), 30)}
              maxLength={50000}
              aria-label="Note text"
              onBlur={() => {
                if (!saveFailed) void save();
              }}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  void save();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  discard();
                }
              }}
            />
            {saveFailed && (
              <div className="d-state d-state-failed" role="alert">
                <span className="d-state-text">Not saved</span>
                <button
                  type="button"
                  className="d-state-retry"
                  disabled={saving}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => void save()}
                  aria-label="Retry saving note"
                >
                  {saving ? "Saving…" : "Retry"}
                </button>
              </div>
            )}
          </>
        ) : bits.processing && !body ? (
          shimmerLines()
        ) : (
          <>
            {heading && (
              <div className="d-note-head">
                <span className="d-note-title" dir="auto">{heading}</span>
              </div>
            )}
            {text && (
              <p
                className="d-note-lines"
                dir="auto"
                title={bits.phone ? undefined : "Click to edit"}
                onClick={(e) => {
                  if (bits.phone) return;
                  // Entering edit removes the text, so a single click only arms
                  // a timer — a second click (or an in-flight selection) cancels
                  // it, leaving double-click word select and drag-select intact.
                  if (e.detail === 1) {
                    openTimer.current = window.setTimeout(() => {
                      if (!window.getSelection()?.toString()) bits.beginNoteEdit();
                    }, 250);
                  } else {
                    window.clearTimeout(openTimer.current);
                  }
                }}
              >
                {expanded ? text : preview}
              </p>
            )}
            {preview !== text && (
              <button type="button" className="d-note-more" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
                {expanded ? "Read less" : "Read more"}
              </button>
            )}
          </>
        )}
        {dump.note && (
          <p className="d-annotation" dir="auto">
            {dump.note}
          </p>
        )}
        {bits.rail(<SourceGlyph dump={dump} />)}
      </div>
    </article>
  );
}

export function notePreview(text: string) {
  if (text.length <= 360 && text.split("\n").length <= 6) return text;
  const firstLines = text.split("\n").slice(0, 6).join("\n").trimEnd();
  if (firstLines.length <= 360) return firstLines;
  const prefix = Array.from(firstLines).slice(0, 360).join("");
  const boundary = prefix.search(/\s+\S*$/);
  return boundary > 220 ? prefix.slice(0, boundary) : prefix;
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

/** link — the fallback: a bookmark, not a preview. The title is a classic underlined
 *  hyperlink and the card itself is the way out to the page; the site's mark is its source cue. */
function LinkCard({ dump, bits }: { dump: Dump; bits: CardBits }) {
  // Bare-URL dumps title to the domain — show host+path instead so the card
  // still reads like an address.
  const titleIsDomain = bits.title != null && bits.title === dump.domain;
  const headline = titleIsDomain ? linkAddress(dump) ?? bits.title : bits.title;
  const empty = bits.processing && !headline;
  return (
    <article {...bits.cardProps} className="d-card d-link group">
      <div className="d-body d-link-body">
        {empty ? (
          <span className="d-link-shimmer">
            <span className="shimmer" />
          </span>
        ) : (
          <h3 className="d-link-title" dir="auto">
            {bits.href ? (
              <a href={bits.href} target="_blank" rel="noreferrer">
                {headline ?? dump.domain ?? dump.url}
              </a>
            ) : (
              headline ?? dump.domain ?? dump.url ?? "Link"
            )}
          </h3>
        )}
        {dump.note && (
          <p className="d-annotation" dir="auto">
            {dump.note}
          </p>
        )}
        {bits.rail(<SourceGlyph dump={dump} />)}
      </div>
    </article>
  );
}

/* ================================== dispatch ================================== */

export default function DumpCard({ dump, phone = false, fresh, removing, onTopic, onDelete, onRetry, onPin, onSaveNote, drag, topics }: Props) {
  const [videoIssue, setVideoIssue] = useState<{ version: number; value: VideoCopy | null } | null>(null);
  const videoCopy = videoIssue?.version === dump.updatedAt ? videoIssue.value : dump.videoCopy;
  const effectiveDump = { ...dump, videoCopy };
  const refreshVideo = () => window.dispatchEvent(new Event("dump-updated"));
  const changeVideoCopy = (keep: boolean) => {
    setVideoIssue({ version: dump.updatedAt, value: keep ? { state: "pending", startedAt: Date.now() } : null });
    void setVideoCopy(dump.id, keep, refreshVideo, () => setVideoIssue({ version: dump.updatedAt, value: { state: "failed", startedAt: Date.now(), error: "Request failed" } }));
  };
  const onVideoMissing = (local: string) => {
    setVideoIssue({ version: dump.updatedAt, value: { state: "missing", startedAt: Date.now() } });
    void fetch(`/api/dumps/${dump.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ failedVideoUrl: local }) }).then(refreshVideo).catch(() => {});
  };
  const [imgFailed, setImgFailed] = useState(false);
  const [editingNote, setEditingNote] = useState(false);

  const processing = dump.status === "processing";
  const now = useStateClock(processing, dump.updatedAt);
  const online = useOnline();
  const state = cardState(effectiveDump, now, online);
  const gone = !!state.unavailable;
  const exposed = !!(state.failed || state.unavailable || videoCopy);

  const topic = topicMeta(dump.topic, topics);
  const kind = dump.kind;
  const provider = providerMeta(dump.provider);
  const subject = dump.subject && (dump.subject.confidence ?? 0) >= SUBJECT_MIN_CONFIDENCE ? dump.subject : null;
  const title = subject ? subjectLine(subject) : dump.title || (dump.url ? titleFromUrl(dump.url) : null);
  // A confirmed-gone original is a dead end: only a locally stored image still opens.
  const localImage = dump.imageUrl?.startsWith("/api/files/") ? dump.imageUrl : dump.imageUrl ? dump.mediaArchive?.[dump.imageUrl] : null;
  const href = gone ? (kind === "image" ? localImage : null) : dump.url ?? (kind === "image" ? dump.imageUrl : null);
  const site = dump.siteName && dump.siteName.length < 30 ? dump.siteName : dump.domain;
  const showMedia = !!dump.imageUrl && !imgFailed;
  const dek = dump.summary ?? dump.description;

  const grip = drag && (
    <button
      className="d-drag"
      onPointerDown={drag.onPointerDown}
      onContextMenu={(e) => e.preventDefault()}
      aria-label="Drag to move"
      title="Drag to move"
    >
      <Glyph name="grip" />
    </button>
  );
  const destinations = topics.filter((t) => t.id !== dump.topic).map((t) => (
    <Menu.Item key={t.id} className="d-menu-item" onClick={() => onTopic(dump.id, t.id)}>
      <span className="d-dot" style={{ "--topic": t.color } as CSSProperties} />
      {t.label}
    </Menu.Item>
  ));
  const copyLink = () => {
    if (dump.url) void navigator.clipboard?.writeText(dump.url).catch(() => {});
  };
  const openLabel = gone ? "Open saved image" : provider ? `Open in ${provider.label}` : "Open original";
  const leadItems = (
    <>
      {href && kind !== "note" && (
        <Menu.Item className="d-menu-item" onClick={() => window.open(href, "_blank", "noreferrer")}>{openLabel}</Menu.Item>
      )}
      {kind === "note" && !editingNote && (
        <Menu.Item className="d-menu-item" onClick={() => setEditingNote(true)}>Edit</Menu.Item>
      )}
      <Menu.Item className="d-menu-item" onClick={() => onPin(dump.id, !dump.pinned)}>{dump.pinned ? "Unpin" : "Pin"}</Menu.Item>
    </>
  );
  const sourceItems = (
    <>
      {videoCopyAction(effectiveDump) && (
        <Menu.Item className="d-menu-item" onClick={() => changeVideoCopy(videoCopyAction(effectiveDump) === "Save video copy")}>{videoCopyAction(effectiveDump)}</Menu.Item>
      )}
      {dump.url && (
        <Menu.Item className="d-menu-item" onClick={copyLink}>Copy original link</Menu.Item>
      )}
      {gone && !processing && (
        <Menu.Item className="d-menu-item" onClick={() => onRetry(dump.id)}>Check original again</Menu.Item>
      )}
    </>
  );
  const dots = (
    <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20" aria-hidden>
      <circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" />
    </svg>
  );
  // Hover/focus adds only these: reorder and one overflow menu (the source cue rides along on media cards).
  const actions = phone ? (
    <div className="d-phone-actions">
      {grip}
      <PhoneMenuRoot>
        <Menu.Trigger className="d-more" aria-label="Card actions">{dots}</Menu.Trigger>
        <PhoneMenu>
          {leadItems}
          {destinations.length > 0 && (
            <PhoneMenuRoot submenu>
              <Menu.SubmenuTrigger className="d-menu-item" data-move-trigger>Move…</Menu.SubmenuTrigger>
              <PhoneMenu submenu>{destinations}</PhoneMenu>
            </PhoneMenuRoot>
          )}
          {sourceItems}
          <Menu.Item className="d-menu-item" onClick={() => onDelete(dump.id)}>Delete</Menu.Item>
        </PhoneMenu>
      </PhoneMenuRoot>
    </div>
  ) : (
    <div className="d-actions">
      <span className="d-actions-src">
        <SourceGlyph dump={dump} />
      </span>
      {grip}
      <Menu.Root>
        <Menu.Trigger className="d-more" aria-label="Card actions" title="More">{dots}</Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner className="d-menu-positioner" side="bottom" align="end" sideOffset={4}>
            <Menu.Popup className="d-menu">
              {leadItems}
              {destinations.length > 0 && (
                <Menu.SubmenuRoot>
                  <Menu.SubmenuTrigger className="d-menu-item" data-move-trigger>Move…</Menu.SubmenuTrigger>
                  <Menu.Portal>
                    <Menu.Positioner className="d-menu-positioner" sideOffset={4}>
                      <Menu.Popup className="d-menu">{destinations}</Menu.Popup>
                    </Menu.Positioner>
                  </Menu.Portal>
                </Menu.SubmenuRoot>
              )}
              {sourceItems}
              <Menu.Separator className="d-menu-sep" />
              <Menu.Item className="d-menu-item d-menu-danger" onClick={() => onDelete(dump.id)}>Delete</Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </div>
  );

  const stateRows = (
    <StateRows
      state={state}
      retryName={title ?? dump.domain ?? kindMeta(kind).singular}
      onRetry={() => onRetry(dump.id)}
      videoCopy={videoCopy}
      onVideoCopy={changeVideoCopy}
      canSaveVideo={!!videoCopyAction(effectiveDump)}
    />
  );
  const rail = (glyph?: ReactNode) => (
    <>
      {stateRows}
      <div className="d-rail">
        {glyph}
        {dump.pinned && <Glyph name="pin" className="d-meta-pin" />}
        {phone && actions}
      </div>
    </>
  );

  const bits: CardBits = {
    phone,
    rail,
    // Retained details, the owner's note and inline players' native controls get a rail too,
    // so the actions never cover text or video controls.
    mediaFoot: (glyph) => (phone || exposed || dump.note || (kind === "video" && dump.videoUrl) ? rail(glyph) : stateRows),
    exposed,
    gone,
    posterOnly: state.posterOnly,
    onVideoMissing,
    href,
    title,
    dek,
    site,
    showMedia,
    setImgFailed,
    processing,
    pinBadge: dump.pinned && !phone ? (
      <span className="d-pin-badge" title="Pinned">
        <Glyph name="pin" />
      </span>
    ) : null,
    editingNote,
    beginNoteEdit: () => setEditingNote(true),
    endNoteEdit: () => setEditingNote(false),
    onSaveNote,
    cardProps: {
      "data-kind": kind,
      "data-provider": dump.provider ?? undefined,
      "data-fresh": fresh || undefined,
      "data-removing": removing || undefined,
      "data-pinned": dump.pinned || undefined,
      "data-exception": exposed || undefined,
      "data-note": dump.note ? true : undefined,
      style: { "--topic": topic.color, "--provider": provider && "color" in provider ? provider.color : undefined } as CSSProperties,
    },
  };

  const card = renderCard(dump, bits);
  return phone ? card : <div className="d-card-shell">{card}{actions}</div>;
}

function renderCard(dump: Dump, bits: CardBits) {
  const { kind } = dump;
  if (kind === "note") return <NoteCard dump={dump} bits={bits} />;
  // The bare fallback is for records with nothing to show but a URL; any retained title,
  // author or text keeps its family's own chrome.
  if (bits.phone && bits.exposed && !bits.dek && !dump.title && !dump.author && !bits.showMedia && !dump.videoUrl && !dump.xRender) {
    return (
      <article {...bits.cardProps} className="d-card d-body">
        <p className="d-kicker">{providerMeta(dump.provider)?.label ?? bits.site ?? kindMeta(kind).singular}</p>
        <p className="d-headline" dir="auto">{dump.title || linkAddress(dump) || dump.domain || "Preview unavailable"}</p>
        {dump.note && <p className="d-annotation" dir="auto">{dump.note}</p>}
        {bits.href && dump.url && <a className="d-original" href={dump.url} target="_blank" rel="noreferrer">Open original</a>}
        {bits.rail(<SourceGlyph dump={dump} />)}
      </article>
    );
  }
  if (kind === "video" && dump.videoUrl) return <VideoCard dump={dump} bits={bits} />;
  if (dump.provider === "x") return <XCard dump={dump} bits={bits} />;
  if (dump.provider === "reddit") return <RedditCard dump={dump} bits={bits} />;
  if (dump.provider === "hackernews") return <HnCard dump={dump} bits={bits} />;
  if (dump.provider === "github") return <GithubCard dump={dump} bits={bits} />;
  if (dump.provider === "instagram") return <IgCard dump={dump} bits={bits} />;
  if (kind === "audio") return <MusicCard dump={dump} bits={bits} />;
  if (kind === "video") return <VideoCard dump={dump} bits={bits} />;
  if (kind === "image" && bits.showMedia) return <MediaCard dump={dump} bits={bits} />;
  if (kind === "post" || SOCIAL_PROVIDERS.has(dump.provider ?? "")) return <PostCard dump={dump} bits={bits} />;
  if (kind === "article") return <ArticleCard dump={dump} bits={bits} />;
  return <LinkCard dump={dump} bits={bits} />;
}
