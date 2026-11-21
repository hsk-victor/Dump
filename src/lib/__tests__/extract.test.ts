import { describe, expect, it } from "vitest";
import { parseHtml, parseTikTokItem, isPrivateIp, isGoneStatus, isTransientStatus } from "../extract";

describe("parseHtml", () => {
  it("reads Open Graph metadata and resolves relative images", () => {
    const html = `<html><head><title>Fallback</title>
      <meta property="og:title" content="Great Article">
      <meta property="og:description" content="About things">
      <meta property="og:image" content="/img/cover.png">
      <meta property="og:type" content="article">
      <meta property="article:published_time" content="2024-01-01">
      <meta property="og:site_name" content="Example">
      </head><body><article><p>${"Lots of words here. ".repeat(5)}</p></article></body></html>`;
    const meta = parseHtml(html, "https://example.com/posts/1");
    expect(meta).toMatchObject({
      title: "Great Article",
      description: "About things",
      imageUrl: "https://example.com/img/cover.png",
      siteName: "Example",
      ogType: "article",
      hasArticleMeta: true,
    });
    expect(meta.content).toContain("Lots of words here.");
  });

  it("falls back to <title>", () => {
    expect(parseHtml("<title> Hello </title>", "https://e.com").title).toBe("Hello");
  });
});

describe("isPrivateIp", () => {
  it.each(["127.0.0.1", "10.1.2.3", "192.168.0.1", "169.254.169.254", "0.0.0.0", "::1", "::", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "0:0:0:0:0:ffff:a9fe:a9fe", "::7f00:1", "64:ff9b::7f00:1", "2002:7f00:1::", "not-an-ip"])(
    "blocks %s",
    (ip) => expect(isPrivateIp(ip)).toBe(true),
  );

  it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "::ffff:8.8.8.8", "::ffff:808:808"])("allows %s", (ip) =>
    expect(isPrivateIp(ip)).toBe(false),
  );
});

describe("TikTok pages", () => {
  const signed = "https://p19-common-sign.tiktokcdn-us.com/cover~tplv-tiktokx-origin.image?x-expires=1795240800&x-signature=abc";
  const universal = (itemStruct: unknown) =>
    `<html><head><title>TikTok - Make Your Day</title></head><body><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify({
      __DEFAULT_SCOPE__: { "webapp.video-detail": { itemInfo: { itemStruct } } },
    })}</script></body></html>`;

  it("reads the caption, author and cover from the hydration JSON", () => {
    const html = universal({
      desc: "Scramble up ur name & I’ll try to guess it😍❤️ #foryoupage",
      author: { uniqueId: "scout2015", nickname: "Scout, Suki & Stella" },
      video: { cover: "https://cdn.example/cover.jpg", originCover: signed },
    });
    expect(parseHtml(html, "https://www.tiktok.com/@scout2015/video/6718335390845095173")).toMatchObject({
      title: "Scramble up ur name & I’ll try to guess it😍❤️ #foryoupage",
      description: "Scramble up ur name & I’ll try to guess it😍❤️ #foryoupage",
      author: "Scout, Suki & Stella",
      authorHandle: "scout2015",
      imageUrl: signed,
      imageUrls: [signed],
      siteName: "TikTok",
      ogType: "video",
    });
  });

  it("reads older SIGI_STATE pages", () => {
    const state = {
      ItemModule: { "1": { desc: "Old caption", author: "olduser", video: { cover: signed } } },
      UserModule: { users: { olduser: { nickname: "Old User" } } },
    };
    const html = `<script id="SIGI_STATE" type="application/json">${JSON.stringify(state)}</script>`;
    expect(parseTikTokItem(html)).toEqual({ caption: "Old caption", author: "Old User", handle: "olduser", cover: signed });
  });

  it("falls back to the handle and keeps og tags when the page has them", () => {
    const html = universal({ desc: "", author: { uniqueId: "someone" } }).replace(
      "<head>",
      `<head><meta property="og:image" content="https://cdn.example/og.jpg">`,
    );
    expect(parseHtml(html, "https://www.tiktok.com/@someone/video/1")).toMatchObject({ title: "TikTok - Make Your Day", author: "someone", imageUrl: "https://cdn.example/og.jpg" });
  });

  it("ignores malformed hydration data and non-TikTok hosts", () => {
    expect(parseTikTokItem(`<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">{not json</script>`)).toBeNull();
    const html = universal({ desc: "Caption", author: { uniqueId: "u" } });
    expect(parseHtml(html, "https://example.com/page")).toMatchObject({ title: "TikTok - Make Your Day", author: null });
  });
});

describe("isGoneStatus", () => {
  it("only treats 404 and 410 as a removed original", () => {
    expect([404, 410].every(isGoneStatus)).toBe(true);
    expect([200, 401, 403, 429, 500, 502, 503].some(isGoneStatus)).toBe(false);
  });
});

describe("isTransientStatus", () => {
  it("treats rate limits and server errors as retryable, never as gone", () => {
    expect([429, 500, 502, 503, 504].every(isTransientStatus)).toBe(true);
    expect([200, 401, 403, 404, 410].some(isTransientStatus)).toBe(false);
  });
});
