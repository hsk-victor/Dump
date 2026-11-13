import { describe, expect, it } from "vitest";
import { parseHtml, isPrivateIp } from "../extract";

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
