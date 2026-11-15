import { describe, expect, it } from "vitest";
import { githubRef, isDirectVideoUrl, kindFromUrl, normalizeUrl, parseInput, providerFromUrl, titleFromUrl, videoTitleFromUrl } from "../detect";

describe("direct video files", () => {
  it.each(["mp4", "webm", "mov", "m4v"])("recognizes .%s files with query strings and fragments", (ext) => {
    const url = `https://example.com/My%20clip.${ext}?download=1#start`;
    expect(isDirectVideoUrl(url)).toBe(true);
    expect(kindFromUrl(url)).toBe("video");
    expect(videoTitleFromUrl(url)).toBe("My clip");
    expect(titleFromUrl(url)).toBe("My clip");
  });
  it("does not mistake video platform pages or query parameters for files", () => {
    expect(isDirectVideoUrl("https://youtube.com/watch?v=video.mp4")).toBe(false);
    expect(isDirectVideoUrl("not a URL")).toBe(false);
    expect(videoTitleFromUrl("https://example.com/%invalid.MP4")).toBe("%invalid");
  });
});

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

describe("providerFromUrl", () => {
  it.each([
    ["https://github.com/vercel/next.js", "github"],
    ["https://gist.github.com/user/abc123", "github"],
    ["https://x.com/jack/status/20", "x"],
    ["https://twitter.com/jack/status/20", "x"],
    ["https://www.threads.net/@user/post/abc", "threads"],
    ["https://bsky.app/profile/user/post/abc", "bluesky"],
    ["https://www.reddit.com/r/cooking/comments/abc/x/", "reddit"],
    ["https://news.ycombinator.com/item?id=123", "hackernews"],
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "youtube"],
    ["https://youtu.be/dQw4w9WgXcQ", "youtube"],
    ["https://www.tiktok.com/@user/video/123", "tiktok"],
    ["https://open.spotify.com/track/123", "spotify"],
    ["https://soundcloud.com/artist/track", "soundcloud"],
    ["https://someone.substack.com/p/my-essay", "substack"],
    ["https://mastodon.social/@user/123456", "mastodon"],
    ["https://en.wikipedia.org/wiki/Function_(mathematics)", "wikipedia"],
    ["https://example.com/a", null],
    ["not a url", null],
  ])("%s -> %s", (url, provider) => {
    expect(providerFromUrl(url)).toBe(provider);
  });
});

describe("githubRef", () => {
  it("reads owner/repo, plus a ref for pulls and issues", () => {
    expect(githubRef("https://github.com/vercel/next.js")).toEqual({ repo: "vercel/next.js", ref: undefined });
    expect(githubRef("https://github.com/vercel/next.js/pull/123")).toEqual({ repo: "vercel/next.js", ref: "#123" });
    expect(githubRef("https://github.com/vercel/next.js/issues/45")).toEqual({ repo: "vercel/next.js", ref: "#45" });
  });

  it("handles gists and ignores non-repo pages", () => {
    expect(githubRef("https://gist.github.com/mattn/abcdef1234567890")).toEqual({ repo: "mattn/abcdef123456" });
    expect(githubRef("https://github.com/explore")).toBeNull();
    expect(githubRef("https://github.com/settings/profile")).toBeNull();
    expect(githubRef("https://example.com/vercel/next.js")).toBeNull();
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
