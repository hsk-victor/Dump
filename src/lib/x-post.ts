import * as cheerio from "cheerio";
import type { Extracted } from "./extract";

interface Entity {
  url: string;
  expanded_url?: string;
  display_url?: string;
}

interface Variant {
  content_type: string;
  url: string;
  bitrate?: number;
}

export interface SyndicationTweet {
  text?: string;
  user?: { name: string; screen_name: string; profile_image_url_https?: string };
  entities?: { urls?: Entity[]; media?: Entity[] };
  photos?: { url: string }[];
  mediaDetails?: {
    type: string;
    media_url_https: string;
    video_info?: { variants: Variant[] };
  }[];
}

export function syndicationUrl(url: string): string | null {
  const parsed = new URL(url);
  if (!/(^|\.)(x|twitter)\.com$/.test(parsed.hostname)) return null;
  const id = parsed.pathname.match(/\/status(?:es)?\/(\d+)/)?.[1];
  if (!id) return null;
  const token = ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
  return `https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${token}`;
}

export function parseSyndication(tweet: SyndicationTweet): Extracted | null {
  if (!tweet.text || !tweet.user?.screen_name) return null;
  let text = tweet.text.replace(/&(?:#(?:[xX][\da-fA-F]+|\d+)|[a-zA-Z][a-zA-Z\d]*);/g, (entity) =>
    cheerio.load(`<span data-value="${entity}"></span>`, null, false)("span").attr("data-value") ?? entity,
  );
  for (const media of tweet.entities?.media ?? []) text = text.split(media.url).join("");
  for (const link of tweet.entities?.urls ?? []) {
    text = text.split(link.url).join(link.expanded_url ?? link.display_url ?? link.url);
  }
  text = text.replace(/\s+pic\.(?:twitter|x)\.com\/\S+\s*$/i, "").trim();
  const images = tweet.photos?.map((p) => p.url) ?? tweet.mediaDetails?.filter((m) => m.type === "photo").map((m) => m.media_url_https) ?? [];
  const video = tweet.mediaDetails?.find((m) => m.type === "video" || m.type === "animated_gif");
  const variants = (video?.video_info?.variants ?? []).filter((v) => v.content_type === "video/mp4");
  const height = (v: Variant) => Number(v.url.match(/\/(\d+)x(\d+)\//)?.[2] ?? Infinity);
  const bounded = variants.filter((v) => height(v) <= 720);
  const selected = bounded.length
    ? bounded.sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0]
    : variants.sort((a, b) => height(a) - height(b) || (a.bitrate ?? 0) - (b.bitrate ?? 0))[0];
  return {
    kind: "post",
    title: `${tweet.user.name} on X`,
    description: text,
    content: text,
    author: tweet.user.name,
    authorHandle: tweet.user.screen_name,
    authorAvatarUrl: tweet.user.profile_image_url_https ?? null,
    imageUrl: images[0] ?? null,
    imageUrls: images,
    videoUrl: selected?.url ?? null,
    videoPosterUrl: video?.media_url_https ?? null,
    siteName: "X",
    unreachable: false,
  };
}
