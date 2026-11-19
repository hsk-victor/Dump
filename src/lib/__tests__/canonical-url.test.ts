import { describe, expect, it } from "vitest";
import { canonicalUrl } from "../canonical-url";

describe("canonicalUrl", () => {
  it.each([
    "https://twitter.com/NASAWebb/status/1546621080298835970",
    "https://x.com/NASAWebb/status/1546621080298835970?s=20",
    "https://x.com/NASAWebb/status/1546621080298835970",
    "https://mobile.twitter.com/renamed/status/1546621080298835970?t=abc",
    "https://www.x.com/i/web/status/1546621080298835970#photo",
    "https://fxtwitter.com/renamed/status/1546621080298835970/",
    "https://vxtwitter.com/renamed/status/1546621080298835970/video/1",
  ])("matches X posts by status ID: %s", (url) => {
    expect(canonicalUrl(url)).toBe("https://x.com/i/web/status/1546621080298835970");
  });

  it.each([
    "https://youtu.be/AbC_123?t=12&si=tracking",
    "https://www.youtube.com/watch?v=AbC_123&list=playlist&index=2",
    "https://m.youtube.com/shorts/AbC_123#fragment",
    "https://youtube.com/embed/AbC_123",
    "https://youtube.com/live/AbC_123",
  ])("matches YouTube videos: %s", (url) => {
    expect(canonicalUrl(url)).toBe("https://youtube.com/watch?v=AbC_123");
  });

  it("normalizes host prefixes, fragments, slashes, tracking and query order", () => {
    expect(canonicalUrl("https://WWW.Mobile.Example.COM/article/?q=test&page=2&utm_source=x&FBCLID=x&gclid=x&igshid=x&si=x&ref_src=x#section"))
      .toBe("https://example.com/article?page=2&q=test");
    expect(canonicalUrl("https://example.com")).toBe(canonicalUrl("https://m.example.com/#top"));
  });

  it.each([
    ["https://example.com/?id=1", "https://example.com/?id=2"],
    ["https://example.com/?page=1", "https://example.com/?page=2"],
    ["https://example.com/?q=one", "https://example.com/?q=two"],
    ["https://example.com/?s=one&t=1", "https://example.com/?s=two&t=2"],
    ["https://example.com/?next=path/", "https://example.com/?next=path"],
    ["https://x.com/a/status/123", "https://x.com/a/status/124"],
    ["https://x.com/a/status/123", "https://x.com.evil.com/a/status/123"],
    ["https://youtube.com/watch?v=abc", "https://youtu.be/ABC"],
    ["https://youtube.com/playlist?list=one", "https://youtube.com/playlist?list=two"],
    ["https://example.com/Path", "https://example.com/path"],
  ])("keeps different pages distinct: %s vs %s", (a, b) => {
    expect(canonicalUrl(a)).not.toBe(canonicalUrl(b));
  });

  it.each(["", "not a URL", "http://[invalid", "mailto:test@example.com"])("leaves invalid or unsupported input unchanged: %s", (url) => {
    expect(canonicalUrl(url)).toBe(url);
  });
});
