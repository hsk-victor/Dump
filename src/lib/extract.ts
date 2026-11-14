import * as cheerio from "cheerio";
import dns from "node:dns";
import net from "node:net";
import { Agent, fetch as undiciFetch } from "undici";
import { domainOf, kindFromUrl } from "./detect";
import type { Kind } from "./taxonomy";
import { parseSyndication, syndicationUrl, type SyndicationTweet } from "./x-post";

export interface Extracted {
  kind: Kind;
  title: string | null;
  description: string | null;
  content: string | null;
  imageUrl: string | null;
  /** Every image the source advertised (og:image arrays, oEmbed thumbnail first). imageUrl is [0]. */
  imageUrls: string[];
  siteName: string | null;
  author: string | null;
  authorHandle?: string | null;
  authorAvatarUrl?: string | null;
  videoUrl?: string | null;
  videoPosterUrl?: string | null;
  /** True when no request for this URL got any HTTP response (network error, timeout, blocked). */
  unreachable: boolean;
}

const UA = "Mozilla/5.0 (compatible; DumpBot/0.1; +https://github.com/hsk-victor/Dump)";
const TIMEOUT_MS = 8000;
const MAX_BYTES = 2_000_000;

function isPrivateIpv4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

/** Expands any valid IPv6 spelling (compressed, embedded IPv4, zone id) into its 8 16-bit words. */
function ipv6Words(ip: string): number[] | null {
  let s = ip.toLowerCase().split("%")[0];
  const v4Tail = s.match(/^(.*:)(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4Tail) {
    const [a, b, c, d] = v4Tail.slice(2).map(Number);
    s = `${v4Tail[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = 8 - head.length - tail.length;
  if (halves.length === 1 ? fill !== 0 : fill < 1) return null;
  const words = [...head, ...Array(halves.length === 2 ? fill : 0).fill("0"), ...tail].map((w) => (/^[0-9a-f]{1,4}$/.test(w) ? parseInt(w, 16) : NaN));
  return words.some(Number.isNaN) ? null : words;
}

const wordsToIpv4 = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) return isPrivateIpv4(ip);
  const w = ipv6Words(ip);
  if (!w) return true;
  const zeros = (n: number) => w.slice(0, n).every((x) => x === 0);
  // IPv4-mapped (::ffff:a.b.c.d), IPv4-compatible (::a.b.c.d, incl. :: and ::1), NAT64 (64:ff9b::a.b.c.d), 6to4 (2002:AABB:CCDD::).
  if ((zeros(5) && w[5] === 0xffff) || zeros(6)) return isPrivateIpv4(wordsToIpv4(w[6], w[7]));
  if (w[0] === 0x64 && w[1] === 0xff9b && w.slice(2, 6).every((x) => x === 0)) return isPrivateIpv4(wordsToIpv4(w[6], w[7]));
  if (w[0] === 0x2002) return isPrivateIpv4(wordsToIpv4(w[1], w[2]));
  return (w[0] & 0xfe00) === 0xfc00 || (w[0] & 0xffc0) === 0xfe80 || (w[0] & 0xffc0) === 0xfec0 || (w[0] & 0xff00) === 0xff00;
}

const allowPrivate = () => process.env.DUMP_ALLOW_PRIVATE_URLS === "1";

/**
 * Basic SSRF guard. IP-literal hosts are checked here; hostnames are checked at connect time by
 * `guardedLookup`, so the address we validate is the address we actually connect to (no DNS rebinding).
 */
function assertPublicUrl(url: string) {
  const u = new URL(url);
  if (!["http:", "https:"].includes(u.protocol)) throw new Error("Only http(s) URLs are supported");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (!allowPrivate() && net.isIP(host) && isPrivateIp(host)) throw new Error("Refusing to fetch a private network address");
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void;

function guardedLookup(hostname: string, options: dns.LookupOptions, callback: LookupCallback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addrs) => {
    if (err) return callback(err, []);
    if (!allowPrivate() && addrs.some((a) => isPrivateIp(a.address))) {
      return callback(Object.assign(new Error(`Refusing to fetch a private network address (${hostname})`), { code: "EPRIVATE" }), []);
    }
    if (options.all) return callback(null, addrs);
    if (!addrs.length) return callback(Object.assign(new Error(`No address for ${hostname}`), { code: "ENOTFOUND" }), []);
    callback(null, addrs[0].address, addrs[0].family);
  });
}

const dispatcher = new Agent({ connect: { lookup: guardedLookup as never } });

export async function fetchWithTimeout(url: string, init: { headers?: Record<string, string> } = {}): Promise<Response> {
  let current = url;
  for (let hop = 0; hop < 5; hop++) {
    assertPublicUrl(current);
    const res = (await undiciFetch(current, {
      dispatcher,
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "user-agent": UA, "accept-language": "en;q=0.9,*;q=0.5", ...(init.headers ?? {}) },
    })) as unknown as Response;
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      res.body?.cancel().catch(() => {});
      current = new URL(location, current).toString();
      continue;
    }
    Object.defineProperty(res, "url", { value: current });
    return res;
  }
  throw new Error("Too many redirects");
}

async function readBytes(res: Response, max: number): Promise<{ data: Buffer; truncated: boolean }> {
  if (!res.body) return { data: Buffer.alloc(0), truncated: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let done = false;
  while (size < max) {
    const chunk = await reader.read();
    if (chunk.done) {
      done = true;
      break;
    }
    chunks.push(chunk.value);
    size += chunk.value.byteLength;
  }
  reader.cancel().catch(() => {});
  return { data: Buffer.concat(chunks), truncated: !done };
}

async function readLimited(res: Response): Promise<string> {
  return new TextDecoder().decode((await readBytes(res, MAX_BYTES)).data);
}

const MAX_IMAGE_BYTES = 16 * 1024 * 1024;

/** Downloads an image through the same private-network guard used for pages. Null on any failure. */
export async function fetchImage(url: string): Promise<Buffer | null> {
  try {
    const res = await fetchWithTimeout(url, { headers: { accept: "image/*" } });
    if (!res.ok || !(res.headers.get("content-type") ?? "").startsWith("image/")) {
      res.body?.cancel().catch(() => {});
      return null;
    }
    const { data, truncated } = await readBytes(res, MAX_IMAGE_BYTES);
    return truncated ? null : data;
  } catch {
    return null;
  }
}

interface OEmbed {
  title?: string;
  author_name?: string;
  provider_name?: string;
  thumbnail_url?: string;
  html?: string;
  type?: string;
}

function oembedEndpoint(url: string): string | null {
  const host = domainOf(url) ?? "";
  const enc = encodeURIComponent(url);
  if (/(^|\.)(x|twitter)\.com$/.test(host)) return `https://publish.twitter.com/oembed?omit_script=1&dnt=1&url=${enc}`;
  if (/(^|\.)(youtube\.com|youtu\.be)$/.test(host)) return `https://www.youtube.com/oembed?format=json&url=${enc}`;
  if (/(^|\.)vimeo\.com$/.test(host)) return `https://vimeo.com/api/oembed.json?url=${enc}`;
  if (/(^|\.)tiktok\.com$/.test(host)) return `https://www.tiktok.com/oembed?url=${enc}`;
  if (/(^|\.)reddit\.com$/.test(host)) return `https://www.reddit.com/oembed?url=${enc}`;
  if (/(^|\.)spotify\.com$/.test(host)) return `https://open.spotify.com/oembed?url=${enc}`;
  if (/(^|\.)soundcloud\.com$/.test(host)) return `https://soundcloud.com/oembed?format=json&url=${enc}`;
  if (/(^|\.)flickr\.com$/.test(host)) return `https://www.flickr.com/services/oembed?format=json&url=${enc}`;
  return null;
}

async function fetchOEmbed(url: string): Promise<{ data: OEmbed | null; reached: boolean } | null> {
  const endpoint = oembedEndpoint(url);
  if (!endpoint) return null;
  let reached = false;
  try {
    const res = await fetchWithTimeout(endpoint, { headers: { accept: "application/json" } });
    reached = true;
    if (!res.ok) return { data: null, reached };
    return { data: (await res.json()) as OEmbed, reached };
  } catch {
    return { data: null, reached };
  }
}

function textFromEmbedHtml(html: string | undefined): string | null {
  if (!html) return null;
  const $ = cheerio.load(html);
  $("br").replaceWith("\n");
  const p = $("blockquote p").first().text() || $("blockquote").first().text() || $.root().text();
  const text = p.replace(/[^\S\n]+/g, " ").trim();
  return text || null;
}

interface PageMeta {
  title: string | null;
  description: string | null;
  content: string | null;
  imageUrl: string | null;
  imageUrls: string[];
  siteName: string | null;
  author: string | null;
  ogType: string | null;
  hasArticleMeta: boolean;
}

export function parseHtml(html: string, baseUrl: string): PageMeta {
  const $ = cheerio.load(html);
  const meta = (...names: string[]) => {
    for (const n of names) {
      const v = $(`meta[property="${n}"]`).attr("content") ?? $(`meta[name="${n}"]`).attr("content");
      if (v && v.trim()) return v.trim();
    }
    return null;
  };
  const abs = (u: string | null) => {
    if (!u) return null;
    try {
      return new URL(u, baseUrl).toString();
    } catch {
      return null;
    }
  };

  let jsonLdType: string | null = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    if (jsonLdType) return;
    const m = $(el).text().match(/"@type"\s*:\s*"([^"]+)"/);
    if (m) jsonLdType = m[1];
  });

  $("script, style, noscript, svg, nav, header, footer, aside, form, iframe").remove();
  const main = $("article").first().length ? $("article").first() : $("main").first().length ? $("main").first() : $("body");
  const content = main
    .find("h1, h2, h3, p, li, blockquote")
    .map((_, el) => $(el).text().replace(/\s+/g, " ").trim())
    .get()
    .filter((t) => t.length > 30)
    .join("\n")
    .slice(0, 20000);

  const imageUrls = [
    ...new Set(
      ["og:image", "og:image:url", "twitter:image", "twitter:image:src"]
        .flatMap((n) => $(`meta[property="${n}"], meta[name="${n}"]`).map((_, el) => $(el).attr("content")?.trim()).get())
        .map((v) => abs(v ?? null))
        .filter((v): v is string => !!v),
    ),
  ].slice(0, 8);

  const ogType = meta("og:type");
  return {
    title: meta("og:title", "twitter:title") ?? ($("title").first().text().trim() || null),
    description: meta("og:description", "twitter:description", "description"),
    content: content || null,
    imageUrl: imageUrls[0] ?? null,
    imageUrls,
    siteName: meta("og:site_name", "application-name"),
    author: meta("author", "article:author", "twitter:creator"),
    ogType: ogType ?? jsonLdType,
    hasArticleMeta:
      !!meta("article:published_time", "article:author") ||
      /Article|BlogPosting|NewsArticle|Recipe/i.test(jsonLdType ?? ""),
  };
}

function kindFromMeta(meta: PageMeta, wordCount: number): Kind | null {
  const t = (meta.ogType ?? "").toLowerCase();
  if (t.startsWith("video")) return "video";
  if (t.startsWith("music")) return "audio";
  if (t === "article" || meta.hasArticleMeta || wordCount > 600) return "article";
  return null;
}

/** Fetches whatever we can learn about a URL: oEmbed for social/video sites, then the page's own metadata. */
export async function extractUrl(url: string): Promise<Extracted> {
  const endpoint = syndicationUrl(url);
  if (endpoint) {
    try {
      const response = await fetchWithTimeout(endpoint, { headers: { accept: "application/json" } });
      if (response.ok) {
        const post = parseSyndication(JSON.parse(await readLimited(response)) as SyndicationTweet);
        if (post) return post;
      } else response.body?.cancel().catch(() => {});
    } catch {
      // Fall back to oEmbed when syndication is unavailable.
    }
  }
  const urlKind = kindFromUrl(url);
  const host = domainOf(url) ?? "";
  const oembedResult = await fetchOEmbed(url);
  const oembed = oembedResult?.data ?? null;
  let reached = oembedResult?.reached ?? false;

  let page: PageMeta | null = null;
  let contentType = "";
  let finalUrl = url;
  const isX = /(^|\.)(x|twitter)\.com$/.test(host);
  if (!isX) {
    try {
      const res = await fetchWithTimeout(url, { headers: { accept: "text/html,application/xhtml+xml,image/*;q=0.8,*/*;q=0.5" } });
      reached = true;
      contentType = res.headers.get("content-type") ?? "";
      finalUrl = res.url || url;
      if (res.ok && /html|xml/.test(contentType)) page = parseHtml(await readLimited(res), finalUrl);
      else res.body?.cancel().catch(() => {});
    } catch {
      page = null;
    }
  }

  if (contentType.startsWith("image/")) {
    return { kind: "image", title: decodeURIComponent(new URL(url).pathname.split("/").pop() || "Image"), description: null, content: null, imageUrl: url, imageUrls: [url], siteName: host, author: null, unreachable: false };
  }
  if (contentType.startsWith("video/")) {
    return { kind: "video", title: null, description: null, content: null, imageUrl: null, imageUrls: [], siteName: host, author: null, unreachable: false };
  }

  const embedText = textFromEmbedHtml(oembed?.html);
  const words = (page?.content ?? "").split(/\s+/).length;
  const kind: Kind = urlKind ?? (page ? kindFromMeta(page, words) : null) ?? (contentType.includes("pdf") ? "article" : "link");

  if (isX) {
    const author = oembed?.author_name ?? null;
    return {
      kind: urlKind ?? "post",
      title: author ? `${author} on X` : "Post on X",
      description: embedText,
      content: embedText,
      imageUrl: null,
      imageUrls: [],
      siteName: "X",
      author,
      unreachable: !reached,
    };
  }

  const imageUrls = [...new Set([oembed?.thumbnail_url, ...(page?.imageUrls ?? [])].filter((v): v is string => !!v))];

  return {
    kind,
    title: oembed?.title ?? page?.title ?? null,
    description: page?.description ?? (embedText && embedText !== oembed?.title ? embedText : null),
    content: page?.content ?? embedText,
    imageUrl: imageUrls[0] ?? null,
    imageUrls,
    siteName: page?.siteName ?? oembed?.provider_name ?? host,
    author: oembed?.author_name ?? page?.author ?? null,
    unreachable: !reached,
  };
}
