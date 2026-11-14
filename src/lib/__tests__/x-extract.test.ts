import { beforeEach, expect, it, vi } from "vitest";

const fetch = vi.hoisted(() => vi.fn());
vi.mock("undici", async (original) => ({ ...await original<typeof import("undici")>(), fetch }));
const { extractUrl } = await import("../extract");
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
