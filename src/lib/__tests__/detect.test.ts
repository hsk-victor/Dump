import { describe, expect, it } from "vitest";
import { kindFromUrl, normalizeUrl, parseInput, titleFromUrl } from "../detect";

describe("parseInput", () => {
  it("treats a lone URL as a link", () => {
    expect(parseInput("https://example.com/a")).toEqual({ type: "url", url: "https://example.com/a", note: null });
  });

  it("accepts bare domains", () => {
    expect(parseInput("github.com/vercel/next.js")).toMatchObject({ type: "url", url: "https://github.com/vercel/next.js" });
  });

  it("keeps surrounding text as the note", () => {
    expect(parseInput("try this later https://example.com/recipe.")).toEqual({
      type: "url",
      url: "https://example.com/recipe",
      note: "try this later",
    });
  });

  it("treats plain text as a note", () => {
    expect(parseInput("  buy milk  ")).toEqual({ type: "note", text: "buy milk" });
    expect(parseInput("me@example.com")).toEqual({ type: "note", text: "me@example.com" });
  });
});

describe("normalizeUrl", () => {
  it("strips tracking params", () => {
    expect(normalizeUrl("https://x.com/a/status/1?s=20&utm_source=foo&t=abc")).toBe("https://x.com/a/status/1?s=20&t=abc");
  });
});

describe("kindFromUrl", () => {
  it.each([
    ["https://x.com/jack/status/20", "post"],
    ["https://twitter.com/jack/status/20", "post"],
    ["https://www.reddit.com/r/cooking/comments/abc/best_pasta/", "post"],
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "video"],
    ["https://youtu.be/dQw4w9WgXcQ", "video"],
    ["https://open.spotify.com/track/123", "audio"],
    ["https://example.com/cat.jpg", "image"],
    ["https://someone.substack.com/p/my-essay", "article"],
    ["https://blog.example.com/2024/05/hello", "article"],
    ["https://github.com/vercel/next.js", null],
  ])("%s -> %s", (url, kind) => {
    expect(kindFromUrl(url)).toBe(kind);
  });
});

describe("titleFromUrl", () => {
  it("turns slugs into titles", () => {
    expect(titleFromUrl("https://www.allrecipes.com/recipe/158968/spinach-and-feta-turkey-burgers/")).toBe("Spinach and feta turkey burgers");
    expect(titleFromUrl("https://www.imdb.com/title/tt0111161/")).toBe("imdb.com");
  });
});

describe("parseInput parentheses", () => {
  it("keeps a closing parenthesis that belongs to the URL", () => {
    expect(parseInput("https://en.wikipedia.org/wiki/Function_(mathematics)")).toMatchObject({
      type: "url",
      url: "https://en.wikipedia.org/wiki/Function_(mathematics)",
    });
  });

  it("drops a parenthesis that wraps the URL in prose", () => {
    expect(parseInput("worth a read (https://example.com/post).")).toMatchObject({
      type: "url",
      url: "https://example.com/post",
    });
    expect(parseInput("see (https://en.wikipedia.org/wiki/Function_(mathematics))")).toMatchObject({
      url: "https://en.wikipedia.org/wiki/Function_(mathematics)",
    });
  });
});
