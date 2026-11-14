import type { Kind, Provider } from "./taxonomy";

const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/i;
const BARE_DOMAIN_RE = /^(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:[/?#][^\s]*)?$/i;

export type ParsedInput =
  | { type: "url"; url: string; note: string | null }
  | { type: "note"; text: string };

/** Drops sentence punctuation after a URL, keeping a closing ")" that balances one inside it (e.g. Wikipedia links). */
function trimTrailingPunctuation(url: string): string {
  let out = url;
  for (;;) {
    const last = out.slice(-1);
    if (/[,.;:!?'"]/.test(last)) out = out.slice(0, -1);
    else if (last === ")" && (out.match(/\)/g)?.length ?? 0) > (out.match(/\(/g)?.length ?? 0)) out = out.slice(0, -1);
    else return out;
  }
}

/** Splits raw dump text into either a link (plus optional note) or a plain note. */
export function parseInput(raw: string): ParsedInput {
  const text = raw.trim();
  if (!text) return { type: "note", text: "" };

  if (!/\s/.test(text) && BARE_DOMAIN_RE.test(text) && !text.includes("@")) {
    return { type: "url", url: normalizeUrl(`https://${text}`), note: null };
  }

  const match = text.match(URL_RE);
  if (match) {
    const url = trimTrailingPunctuation(match[0]);
    const rest = (text.slice(0, match.index) + " " + text.slice((match.index ?? 0) + match[0].length))
      .replace(/\s+/g, " ")
      .trim();
    // A long block of prose that merely mentions a link is still a note.
    if (rest.length > 280) return { type: "note", text };
    return { type: "url", url: normalizeUrl(url), note: rest || null };
  }

  return { type: "note", text };
}

const TRACKING_PARAMS = /^(utm_|fbclid$|gclid$|mc_|igshid$|si$|ref_src$|ref_url$)/i;

export function normalizeUrl(input: string): string {
  try {
    const u = new URL(input);
    for (const key of [...u.searchParams.keys()]) {
      if (TRACKING_PARAMS.test(key)) u.searchParams.delete(key);
    }
    u.hash = u.hash === "#" ? "" : u.hash;
    return u.toString();
  } catch {
    return input;
  }
}

export function domainOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^(www\.|m\.|mobile\.)/, "").toLowerCase();
  } catch {
    return null;
  }
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|svg|bmp|heic)(\?|$)/i;
const VIDEO_EXT = /\.(mp4|webm|mov|m4v)(\?|$)/i;
const AUDIO_EXT = /\.(mp3|m4a|wav|ogg|flac)(\?|$)/i;

export function isDirectVideoUrl(url: string): boolean {
  try {
    return VIDEO_EXT.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

export function videoTitleFromUrl(url: string): string {
  const filename = new URL(url).pathname.split("/").filter(Boolean).pop() ?? "Video";
  let decoded = filename;
  try {
    decoded = decodeURIComponent(filename);
  } catch {}
  return decoded.replace(/\.(mp4|webm|mov|m4v)$/i, "").replace(/[-_]+/g, " ") || "Video";
}

function hostMatches(host: string, domains: string[]) {
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
}

/** Best guess of what kind of thing a URL points to, using only the URL itself. */
export function kindFromUrl(url: string): Kind | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = domainOf(url) ?? "";
  const path = u.pathname;

  if (IMAGE_EXT.test(path)) return "image";
  if (VIDEO_EXT.test(path)) return "video";
  if (AUDIO_EXT.test(path)) return "audio";

  if (hostMatches(host, ["x.com", "twitter.com"]) && /\/status(es)?\/\d+/.test(path)) return "post";
  if (hostMatches(host, ["threads.net", "threads.com"]) && /\/post\//.test(path)) return "post";
  if (hostMatches(host, ["bsky.app"]) && /\/post\//.test(path)) return "post";
  if (hostMatches(host, ["reddit.com", "redd.it"]) && /\/comments\//.test(path)) return "post";
  if (hostMatches(host, ["linkedin.com"]) && /\/(posts|feed\/update)\//.test(path)) return "post";
  if (hostMatches(host, ["instagram.com"]) && /^\/(p|reel)\//.test(path)) return path.startsWith("/reel") ? "video" : "post";
  if (hostMatches(host, ["facebook.com"]) && /\/(posts|permalink|story)/.test(path)) return "post";
  if (hostMatches(host, ["news.ycombinator.com"]) && u.searchParams.has("id")) return "post";
  if (/^\/@[\w.]+\/\d+$/.test(path)) return "post"; // Mastodon-style

  if (hostMatches(host, ["youtube.com", "youtu.be", "vimeo.com", "tiktok.com", "twitch.tv", "loom.com", "dailymotion.com"])) {
    return "video";
  }
  if (hostMatches(host, ["open.spotify.com", "soundcloud.com", "podcasts.apple.com", "music.apple.com", "bandcamp.com"])) {
    return "audio";
  }
  if (hostMatches(host, ["i.imgur.com", "pinterest.com", "pin.it", "unsplash.com", "dribbble.com", "flickr.com"])) {
    return "image";
  }
  if (hostMatches(host, ["medium.com", "substack.com", "dev.to", "hashnode.dev", "mirror.xyz", "wikipedia.org"])) {
    return "article";
  }
  if (/\/(blog|posts?|articles?|news|story|stories|recipes?|guides?|p)\/[^/]+/.test(path) || /\/\d{4}\/\d{2}\//.test(path)) {
    return "article";
  }
  if (/\.pdf(\?|$)/i.test(path)) return "article";
  return null;
}

/**
 * Which service a URL belongs to. `kind` stays coarse (link, post, video…);
 * the provider picks the brand icon and card variant (github, youtube, x…).
 */
export function providerFromUrl(url: string): Provider | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = domainOf(url) ?? "";
  const path = u.pathname;

  if (hostMatches(host, ["github.com"])) return "github";
  if (hostMatches(host, ["x.com", "twitter.com"])) return "x";
  if (hostMatches(host, ["threads.net", "threads.com"])) return "threads";
  if (hostMatches(host, ["bsky.app"])) return "bluesky";
  if (hostMatches(host, ["reddit.com", "redd.it"])) return "reddit";
  if (hostMatches(host, ["linkedin.com"])) return "linkedin";
  if (hostMatches(host, ["news.ycombinator.com"])) return "hackernews";
  if (hostMatches(host, ["instagram.com"])) return "instagram";
  if (hostMatches(host, ["facebook.com", "fb.watch"])) return "facebook";
  if (hostMatches(host, ["youtube.com", "youtu.be"])) return "youtube";
  if (hostMatches(host, ["vimeo.com"])) return "vimeo";
  if (hostMatches(host, ["tiktok.com"])) return "tiktok";
  if (hostMatches(host, ["twitch.tv"])) return "twitch";
  if (hostMatches(host, ["loom.com"])) return "loom";
  if (hostMatches(host, ["dailymotion.com", "dai.ly"])) return "dailymotion";
  if (hostMatches(host, ["spotify.com"])) return "spotify";
  if (hostMatches(host, ["soundcloud.com"])) return "soundcloud";
  if (hostMatches(host, ["podcasts.apple.com", "music.apple.com", "itunes.apple.com"])) return "applemusic";
  if (hostMatches(host, ["bandcamp.com"])) return "bandcamp";
  if (hostMatches(host, ["imgur.com"])) return "imgur";
  if (hostMatches(host, ["pinterest.com", "pin.it"])) return "pinterest";
  if (hostMatches(host, ["unsplash.com"])) return "unsplash";
  if (hostMatches(host, ["dribbble.com"])) return "dribbble";
  if (hostMatches(host, ["flickr.com"])) return "flickr";
  if (hostMatches(host, ["medium.com"])) return "medium";
  if (hostMatches(host, ["substack.com"])) return "substack";
  if (hostMatches(host, ["dev.to"])) return "devto";
  if (hostMatches(host, ["hashnode.dev", "hashnode.com"])) return "hashnode";
  if (hostMatches(host, ["mirror.xyz"])) return "mirror";
  if (hostMatches(host, ["wikipedia.org"])) return "wikipedia";
  if (/^\/@[\w.]+\/\d+$/.test(path)) return "mastodon"; // federated: the path shape is the tell
  return null;
}

/** github.com top-level segments that aren't an owner name. */
const GITHUB_NON_REPO = new Set([
  "about", "apps", "collections", "contact", "copilot", "codespaces", "customer-stories",
  "enterprise", "events", "explore", "features", "gist", "login", "marketplace", "new",
  "notifications", "orgs", "pricing", "readme", "search", "security", "settings",
  "signup", "sponsors", "team", "topics", "trending",
]);

/**
 * The repo a GitHub URL points at: { repo: "owner/name", ref: "#123" } for pulls/issues,
 * { repo: "user/gist-id" } for gists. Null for non-repo pages (explore, settings, …).
 */
export function githubRef(url: string): { repo: string; ref?: string } | null {
  const host = domainOf(url) ?? "";
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const seg = u.pathname.split("/").filter(Boolean);
  if (host === "gist.github.com") {
    return seg.length >= 2 ? { repo: `${seg[0]}/${seg[1].slice(0, 12)}` } : null;
  }
  if (host !== "github.com" || seg.length < 2 || GITHUB_NON_REPO.has(seg[0].toLowerCase())) return null;
  const m = u.pathname.match(/^\/[^/]+\/[^/]+\/(?:pull|issues)\/(\d+)/);
  return { repo: `${seg[0]}/${seg[1]}`, ref: m ? `#${m[1]}` : undefined };
}

export type GithubKind = "repo" | "issue" | "pr" | "discussion" | "file" | "profile" | "page";

/** What a GitHub URL actually is — decided by the path alone, never by guessed data. */
export interface GithubInfo {
  kind: GithubKind;
  /** "owner/repo" when the URL names one. */
  repo: string | null;
  /** "#123" for issues/PRs/discussions. */
  ref: string | null;
  /** For /blob|tree|raw/ pages: branch and path inside the repo. */
  filePath: string | null;
  /** Profile login for single-segment URLs. */
  login: string | null;
}

export function githubInfo(url: string | null): GithubInfo {
  const none: GithubInfo = { kind: "page", repo: null, ref: null, filePath: null, login: null };
  if (!url) return none;
  const host = domainOf(url) ?? "";
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return none;
  }
  let seg: string[];
  try {
    seg = u.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return none;
  }
  if (host === "gist.github.com") {
    return { ...none, kind: "file", repo: seg.length >= 2 ? `${seg[0]}/${seg[1].slice(0, 12)}` : null };
  }
  if (host !== "github.com" || seg.length === 0 || GITHUB_NON_REPO.has(seg[0].toLowerCase())) return none;
  if (seg.length === 1) return { ...none, kind: "profile", login: seg[0] };
  const repo = `${seg[0]}/${seg[1]}`;
  const m = u.pathname.match(/^\/[^/]+\/[^/]+\/(issues|pull|discussions)\/(\d+)/);
  if (m) {
    const kind = m[1] === "issues" ? "issue" : m[1] === "pull" ? "pr" : "discussion";
    return { ...none, kind, repo, ref: `#${m[2]}` };
  }
  const fm = u.pathname.match(/^\/[^/]+\/[^/]+\/(?:blob|tree|raw)\/(.+)/);
  if (fm) {
    const rest = seg.slice(3);
    return { ...none, kind: "file", repo, filePath: rest.join("/") || null };
  }
  return { ...none, kind: "repo", repo };
}

/** Short label a GitHub save's kind gets in the card's corner tag. */
export const GITHUB_TAG: Record<GithubKind, string | null> = {
  repo: null,
  issue: "Issue",
  pr: "PR",
  discussion: "Discussion",
  file: "File",
  profile: "Profile",
  page: null,
};

/** A readable fallback title from the URL path, e.g. ".../spinach-and-feta-burgers/" -> "Spinach and feta burgers". */
export function titleFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const segments = u.pathname.split("/").filter(Boolean).map((s) => decodeURIComponent(s));
    const slug = [...segments].reverse().find((s) => /[a-z]/i.test(s) && /[-_ ]/.test(s) && s.length > 6);
    if (!slug) return domainOf(url);
    const words = slug.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
    return words.charAt(0).toUpperCase() + words.slice(1);
  } catch {
    return null;
  }
}
