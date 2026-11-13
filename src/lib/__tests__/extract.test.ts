import { describe, expect, it } from "vitest";
import { parseHtml } from "../extract";

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
