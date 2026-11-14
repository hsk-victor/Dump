import { beforeEach, expect, it, vi } from "vitest";

const fetch = vi.hoisted(() => vi.fn());
vi.mock("undici", async (original) => ({ ...await original<typeof import("undici")>(), fetch }));
const { extractUrl, fetchWithTimeout } = await import("../extract");
const url = "https://x.com/BrettFromDJ/status/2065157792109916488";

beforeEach(() => { fetch.mockReset(); });

it("fetches syndication first and skips oEmbed when it has a tweet", async () => {
  fetch.mockResolvedValue(new Response(JSON.stringify({ text: "Hello", user: { name: "Brett", screen_name: "BrettFromDJ" } })));
  expect(await extractUrl(url)).toMatchObject({ description: "Hello", authorHandle: "BrettFromDJ" });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][0]).toContain("cdn.syndication.twimg.com/tweet-result");
});

it.each([new Response("{}"), new Response("broken", { status: 503 }), new Response("not json")])("falls back to oEmbed for unusable syndication", async (response) => {
  fetch.mockResolvedValueOnce(response).mockResolvedValueOnce(new Response(JSON.stringify({ author_name: "Brett", html: "<blockquote><p>Hello<br>World</p></blockquote>" })));
  expect(await extractUrl(url)).toMatchObject({ author: "Brett", description: "Hello\nWorld", unreachable: false });
  expect(fetch.mock.calls[1][0]).toContain("publish.twitter.com/oembed");
});

it("keeps unreachable posts retryable if both sources fail", async () => {
  fetch.mockRejectedValue(new Error("network"));
  expect(await extractUrl(url)).toMatchObject({ unreachable: true, imageUrls: [] });
});

it.each([
  ["https://example.com/Spring%20flowers.mp4", "video/mp4", "Spring flowers"],
  ["https://example.com/clip", "video/webm", "clip"],
])("extracts inline video sources with a video content type: %s", async (url, contentType, title) => {
  fetch.mockResolvedValue(new Response(null, { headers: { "content-type": contentType } }));
  expect(await extractUrl(url)).toMatchObject({ kind: "video", title, videoUrl: url, videoType: "video", unreachable: false });
});

it("extracts the page preview when an mp4 URL serves HTML", async () => {
  fetch.mockResolvedValue(new Response('<title>A preview page</title><meta property="og:type" content="article"><meta property="og:image" content="https://example.com/preview.jpg">', { headers: { "content-type": "text/html" } }));
  expect(await extractUrl("https://example.com/preview.mp4")).toMatchObject({ kind: "article", title: "A preview page", imageUrl: "https://example.com/preview.jpg", videoUrl: null, videoType: null, unreachable: false });
});

it.each(["application/octet-stream", ""])("does not assume a video from its extension without a video content type: %s", async (contentType) => {
  fetch.mockResolvedValue(new Response(null, { headers: { "content-type": contentType } }));
  expect(await extractUrl("https://example.com/clip.mp4")).toMatchObject({ kind: "link", videoUrl: null, unreachable: false });
});

it("does not keep an unverified video source after a failed fetch", async () => {
  fetch.mockRejectedValue(new Error("network"));
  expect(await extractUrl("https://example.com/clip.mp4")).toMatchObject({ kind: "link", videoUrl: null, unreachable: true });
});

it("stores the stable requested video URL instead of an expiring redirect target", async () => {
  const url = "https://example.com/video";
  const response = new Response(null, { headers: { "content-type": "video/mp4" } });
  Object.defineProperty(response, "url", { value: "https://cdn.example.com/clip.mp4?expires=123" });
  fetch.mockResolvedValue(response);
  expect(await extractUrl(url)).toMatchObject({ kind: "video", videoUrl: url, unreachable: false });
});

it("allows video bodies to stream past eight seconds after headers arrive", async () => {
  vi.useFakeTimers();
  try {
    let signal: AbortSignal | undefined;
    let body: ReadableStreamDefaultController<Uint8Array> | undefined;
    fetch.mockImplementationOnce(async (_url, init) => {
      signal = init.signal;
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          body = controller;
          signal?.addEventListener("abort", () => controller.error(new Error("aborted")));
        },
      }));
    });
    const response = await fetchWithTimeout("https://video.twimg.com/video.mp4", { headersOnlyTimeout: true });
    const text = response.text();
    await vi.advanceTimersByTimeAsync(9000);
    expect(signal?.aborted).toBe(false);
    body?.enqueue(new TextEncoder().encode("complete video"));
    body?.close();
    expect(await text).toBe("complete video");
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

it("still times out a video request that has not received headers", async () => {
  vi.useFakeTimers();
  try {
    fetch.mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("headers timed out")));
    }));
    const response = expect(fetchWithTimeout("https://video.twimg.com/video.mp4", { headersOnlyTimeout: true })).rejects.toThrow("headers timed out");
    await vi.advanceTimersByTimeAsync(8000);
    await response;
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
