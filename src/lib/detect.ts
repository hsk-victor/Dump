import type { Kind } from "./taxonomy";

const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/i;
const BARE_DOMAIN_RE = /^(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:[/?#][^\s]*)?$/i;

export type ParsedInput =
  | { type: "url"; url: string; note: string | null }
  | { type: "note"; text: string };

/** Splits raw dump text into either a link (plus optional note) or a plain note. */
export function parseInput(raw: string): ParsedInput {
  const text = raw.trim();
  if (!text) return { type: "note", text: "" };

  if (!/\s/.test(text) && BARE_DOMAIN_RE.test(text) && !text.includes("@")) {
    return { type: "url", url: normalizeUrl(`https://${text}`), note: null };
  }

  const match = text.match(URL_RE);
  if (match) {
    const url = match[0].replace(/[),.;!?]+$/, "");
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
