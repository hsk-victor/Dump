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
