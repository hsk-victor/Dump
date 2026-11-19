import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setVideoCopy } from "../video-copy";

const videoUrl = "https://example.com/clip.mp4";
const pending = { keepVideo: true, videoUrl, mediaArchive: {}, archivePending: true };
const fetchMock = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", fetchMock.mockReset());
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("refreshes again once a delayed video archive appears", async () => {
  const complete = { ...pending, mediaArchive: { [videoUrl]: "/api/files/clip.mp4" } };
  fetchMock.mockResolvedValueOnce(Response.json(pending))
    .mockResolvedValueOnce(Response.json(pending))
    .mockResolvedValueOnce(Response.json(complete));
  const refresh = vi.fn();
  const job = setVideoCopy("clip", true, refresh);
  await vi.advanceTimersByTimeAsync(0);
  expect(refresh).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1000);
  expect(refresh).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1000);
  await job;
  expect(refresh).toHaveBeenCalledTimes(2);
  expect(fetchMock).toHaveBeenLastCalledWith("/api/dumps/clip", { cache: "no-store" });
  expect(vi.getTimerCount()).toBe(0);
});

it.each([false, true])("refreshes and stops when archival ends without a video (opted out: %s)", async (optedOut) => {
  fetchMock.mockResolvedValueOnce(Response.json(pending))
    .mockResolvedValueOnce(Response.json({ ...pending, keepVideo: !optedOut, archivePending: !optedOut ? false : true }));
  const refresh = vi.fn();
  const job = setVideoCopy("clip", true, refresh);
  await vi.runAllTimersAsync();
  await job;
  expect(refresh).toHaveBeenCalledTimes(2);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("does not poll after removing a saved video", async () => {
  fetchMock.mockResolvedValueOnce(Response.json({ ...pending, keepVideo: false }));
  const refresh = vi.fn();
  await setVideoCopy("clip", false, refresh);
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/dumps/clip", expect.objectContaining({ body: '{"keepVideo":false}' }));
  expect(vi.getTimerCount()).toBe(0);
});

it.each(["patch", "deleted", "network"])("stops safely on %s errors", async (failure) => {
  if (failure === "patch") fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
  else {
    fetchMock.mockResolvedValueOnce(Response.json(pending));
    if (failure === "deleted") fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    else fetchMock.mockRejectedValueOnce(new Error("Offline"));
  }
  const refresh = vi.fn();
  const job = setVideoCopy("clip", true, refresh);
  await vi.runAllTimersAsync();
  await expect(job).resolves.toBeUndefined();
  expect(refresh).toHaveBeenCalledTimes(failure === "patch" ? 0 : 1);
  expect(vi.getTimerCount()).toBe(0);
});

it("bounds polling if a job never settles", async () => {
  fetchMock.mockImplementation(async () => Response.json(pending));
  const job = setVideoCopy("clip", true, vi.fn());
  await vi.runAllTimersAsync();
  await job;
  expect(fetchMock).toHaveBeenCalledTimes(601);
  expect(vi.getTimerCount()).toBe(0);
});
