import * as cheerio from "cheerio";
import dns from "node:dns/promises";
import net from "node:net";
import { domainOf, kindFromUrl } from "./detect";
import type { Kind } from "./taxonomy";

export interface Extracted {
  kind: Kind;
  title: string | null;
  description: string | null;
  content: string | null;
  imageUrl: string | null;
  siteName: string | null;
  author: string | null;
}

const UA = "Mozilla/5.0 (compatible; DumpBot/0.1; +https://github.com/hsk-victor/Dump)";
const TIMEOUT_MS = 8000;
const MAX_BYTES = 2_000_000;

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return isPrivateIp(v6.slice(7));
  return v6 === "::1" || v6 === "::" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80");
}

/** Refuse to fetch internal network addresses (basic SSRF guard). */
async function assertPublicUrl(url: string) {
  const u = new URL(url);
  if (!["http:", "https:"].includes(u.protocol)) throw new Error("Only http(s) URLs are supported");
  if (process.env.DUMP_ALLOW_PRIVATE_URLS === "1") return;
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  if (addrs.some((a) => isPrivateIp(a.address))) throw new Error("Refusing to fetch a private network address");
}

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  let current = url;
  for (let hop = 0; hop < 5; hop++) {
    await assertPublicUrl(current);
    const res = await fetch(current, {
      ...init,
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "user-agent": UA, "accept-language": "en;q=0.9,*;q=0.5", ...(init.headers ?? {}) },
    });
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

async function readLimited(res: Response): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  reader.cancel().catch(() => {});
  return new TextDecoder().decode(Buffer.concat(chunks));
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

async function fetchOEmbed(url: string): Promise<OEmbed | null> {
  const endpoint = oembedEndpoint(url);
  if (!endpoint) return null;
  try {
    const res = await fetchWithTimeout(endpoint, { headers: { accept: "application/json" } });
    if (!res.ok) return null;
    return (await res.json()) as OEmbed;
  } catch {
    return null;
  }
}

function textFromEmbedHtml(html: string | undefined): string | null {
  if (!html) return null;
  const $ = cheerio.load(html);
  const p = $("blockquote p").first().text() || $("blockquote").first().text() || $.root().text();
  const text = p.replace(/\s+/g, " ").trim();
  return text || null;
}

interface PageMeta {
  title: string | null;
  description: string | null;
  content: string | null;
  imageUrl: string | null;
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

  const ogType = meta("og:type");
  return {
    title: meta("og:title", "twitter:title") ?? ($("title").first().text().trim() || null),
    description: meta("og:description", "twitter:description", "description"),
    content: content || null,
    imageUrl: abs(meta("og:image", "og:image:url", "twitter:image", "twitter:image:src")),
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
  const urlKind = kindFromUrl(url);
  const host = domainOf(url) ?? "";
  const oembed = await fetchOEmbed(url);

  let page: PageMeta | null = null;
  let contentType = "";
  let finalUrl = url;
  const isX = /(^|\.)(x|twitter)\.com$/.test(host);
  if (!isX) {
    try {
      const res = await fetchWithTimeout(url, { headers: { accept: "text/html,application/xhtml+xml,image/*;q=0.8,*/*;q=0.5" } });
      contentType = res.headers.get("content-type") ?? "";
      finalUrl = res.url || url;
      if (res.ok && /html|xml/.test(contentType)) page = parseHtml(await readLimited(res), finalUrl);
      else res.body?.cancel().catch(() => {});
    } catch {
      page = null;
    }
  }

  if (contentType.startsWith("image/")) {
    return { kind: "image", title: decodeURIComponent(new URL(url).pathname.split("/").pop() || "Image"), description: null, content: null, imageUrl: url, siteName: host, author: null };
  }
  if (contentType.startsWith("video/")) {
    return { kind: "video", title: null, description: null, content: null, imageUrl: null, siteName: host, author: null };
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
      siteName: "X",
      author,
    };
  }

  return {
    kind,
    title: oembed?.title ?? page?.title ?? null,
    description: page?.description ?? (embedText && embedText !== oembed?.title ? embedText : null),
    content: page?.content ?? embedText,
    imageUrl: oembed?.thumbnail_url ?? page?.imageUrl ?? null,
    siteName: page?.siteName ?? oembed?.provider_name ?? host,
    author: oembed?.author_name ?? page?.author ?? null,
  };
}
