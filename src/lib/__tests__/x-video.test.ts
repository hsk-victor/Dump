import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getDump, fetchWithTimeout } = vi.hoisted(() => ({ getDump: vi.fn(), fetchWithTimeout: vi.fn() }));
vi.mock("../db", () => ({ getDump }));
vi.mock("../extract", () => ({ fetchWithTimeout }));
const { GET } = await import("../../app/api/dumps/[id]/video/route");
const ctx = { params: Promise.resolve({ id: "post" }) };
const request = () => new NextRequest("http://localhost:3000/api/dumps/post/video", { headers: { range: "bytes=0-3" } });

beforeEach(() => {
  getDump.mockReset().mockReturnValue({ videoUrl: "https://video.twimg.com/video.mp4" });
  fetchWithTimeout.mockReset();
});

it("streams stored X video with range headers without forwarding the browser referrer", async () => {
  fetchWithTimeout.mockResolvedValue(new Response("data", { status: 206, headers: { "content-range": "bytes 0-3/10", "accept-ranges": "bytes" } }));
  const response = await GET(request(), ctx);
  expect(response.status).toBe(206);
  expect(response.headers.get("content-range")).toBe("bytes 0-3/10");
  expect(await response.text()).toBe("data");
  expect(fetchWithTimeout).toHaveBeenCalledWith("https://video.twimg.com/video.mp4", { headers: { range: "bytes=0-3" }, headersOnlyTimeout: true });
});

it("returns 404 for missing video", async () => {
  getDump.mockReturnValue(null);
  expect((await GET(request(), ctx)).status).toBe(404);
  expect(fetchWithTimeout).not.toHaveBeenCalled();
});

it("rejects non-X media hosts", async () => {
  getDump.mockReturnValue({ videoUrl: "https://example.com/video.mp4" });
  expect((await GET(request(), ctx)).status).toBe(400);
  expect(fetchWithTimeout).not.toHaveBeenCalled();
});

it("handles upstream failures", async () => {
  fetchWithTimeout.mockRejectedValue(new Error("network"));
  expect((await GET(request(), ctx)).status).toBe(502);
});

it("keeps unsatisfiable ranges distinct from unavailable video", async () => {
  fetchWithTimeout.mockResolvedValue(new Response(null, { status: 416 }));
  expect((await GET(request(), ctx)).status).toBe(416);
});
