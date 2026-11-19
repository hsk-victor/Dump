import { afterEach, expect, it, vi } from "vitest";
import { fetch as undiciFetch } from "undici";
import { fetchWithTimeout } from "../extract";

vi.mock("undici", async (original) => ({ ...await original<typeof import("undici")>(), fetch: vi.fn() }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.mocked(undiciFetch).mockReset();
});

it.each([undefined, 60_000, 300_000])("keeps the %s timeout signal attached to the guarded response body", async (timeoutMs) => {
  const timeout = vi.spyOn(AbortSignal, "timeout");
  const response = new Response("video");
  vi.mocked(undiciFetch).mockResolvedValue(response as never);
  expect(await (await fetchWithTimeout("https://example.com/clip.mp4", { timeoutMs })).text()).toBe("video");
  expect(timeout).toHaveBeenCalledWith(timeoutMs ?? 8000);
  expect(undiciFetch).toHaveBeenCalledWith("https://example.com/clip.mp4", expect.objectContaining({
    redirect: "manual", dispatcher: expect.anything(), signal: timeout.mock.results[0].value,
  }));
});

it("retains private-address and redirect guarding with a longer timeout", async () => {
  vi.stubEnv("DUMP_ALLOW_PRIVATE_URLS", "0");
  await expect(fetchWithTimeout("http://127.0.0.1/video.mp4", { timeoutMs: 300_000 })).rejects.toThrow("private network");
  expect(undiciFetch).not.toHaveBeenCalled();
  vi.mocked(undiciFetch).mockResolvedValue(new Response(null, { status: 302, headers: { location: "http://127.0.0.1/video.mp4" } }) as never);
  await expect(fetchWithTimeout("https://example.com/clip.mp4", { timeoutMs: 300_000 })).rejects.toThrow("private network");
  expect(undiciFetch).toHaveBeenCalledTimes(1);
});
