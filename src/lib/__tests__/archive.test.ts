import { afterAll, beforeEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import sharp from "sharp";
import { NextRequest } from "next/server";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dump-archive-test-"));
process.env.DUMP_DATA_DIR = dir;
const mocks = vi.hoisted(() => ({ image: vi.fn(), video: vi.fn() }));
vi.mock("../extract", () => ({ fetchImage: mocks.image, fetchWithTimeout: mocks.video }));
vi.mock("next/server", async (original) => ({ ...await original<typeof import("next/server")>(), after: vi.fn() }));
const db = await import("../db");
const { archiveDump, backfillArchive, posterKey, downloadVideo, isArchiving } = await import("../archive");
const { fileStorage, storedFileName } = await import("../storage");
const { mediaSources, videoPoster } = await import("../media");
const { hasLocalVideo } = await import("../card-state");
const { GET } = await import("@/app/api/files/[name]/route");
const { DELETE, PATCH, GET: getDumpResponse } = await import("@/app/api/dumps/[id]/route");
const image = await sharp({ create: { width: 2400, height: 1800, channels: 3, background: "red" } }).png().toBuffer();
beforeEach(() => {
  for (const dump of db.listDumps({ limit: -1 })) db.deleteDump(dump.id);
  mocks.image.mockReset().mockResolvedValue(image);
  mocks.video.mockReset().mockImplementation(async () => new Response(new Uint8Array([1, 2, 3])));
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
const create = (extra = {}) => db.createDump({ kind: "image", imageUrl: "https://example.com/a.png", ...extra });
const bytes = async (url: string) => fileStorage.read(storedFileName(url)!);

it.each([true, false])("reports keep-video archival as pending until it settles (saved: %s)", async (success) => {
  const videoUrl = "https://example.com/delayed.mp4";
  const poster = "https://example.com/poster.png";
  const d = create({ kind: "video", imageUrl: null, videoUrl, videoPosterUrl: poster, mediaArchive: { [poster]: "/api/files/poster.webp" } });
  let finish!: (response: Response) => void;
  mocks.video.mockReturnValueOnce(new Promise<Response>((resolve) => { finish = resolve; }));
  const ctx = { params: Promise.resolve({ id: d.id }) };
  const request = new NextRequest("http://localhost", { method: "PATCH", body: JSON.stringify({ keepVideo: true }) });
  const response = await PATCH(request, ctx);
  expect(await response.json()).toMatchObject({ keepVideo: true, archivePending: true });
  expect(await (await getDumpResponse(request, ctx)).json()).toMatchObject({ archivePending: true, mediaArchive: { [poster]: "/api/files/poster.webp" } });
  finish(success ? new Response(new Uint8Array([1, 2, 3])) : new Response(null, { status: 404 }));
  await expect.poll(() => isArchiving(d.id)).toBe(false);
  const completed = await (await getDumpResponse(request, ctx)).json();
  expect(completed.archivePending).toBe(false);
  expect(!!completed.mediaArchive[videoUrl]).toBe(success);
  db.deleteDump(d.id);
  expect((await getDumpResponse(request, ctx)).status).toBe(404);
});

it("archives real images as bounded WebP, preserving links and idempotency", async () => {
  const d = create({ imageUrls: ["https://example.com/a.png", "https://example.com/b.png"] });
  await archiveDump(d.id);
  const saved = db.getDump(d.id)!;
  expect(saved.imageUrl).toBe(d.imageUrl);
  expect(saved.imageUrls).toEqual(d.imageUrls);
  expect(Object.keys(saved.mediaArchive)).toHaveLength(2);
  const url = saved.mediaArchive[d.imageUrl!];
  expect(url).toMatch(new RegExp(`${d.id}-a-[a-f0-9]{12}\\.webp$`));
  expect(await sharp(await bytes(url)).metadata()).toMatchObject({ format: "webp", width: 1600, height: 1200 });
  await archiveDump(d.id);
  expect(mocks.image).toHaveBeenCalledTimes(2);
});

it.each([
  { orientation: undefined, quadrants: [0, 1, 2, 3] },
  { orientation: 1, quadrants: [0, 1, 2, 3] },
  { orientation: 2, quadrants: [1, 0, 3, 2] },
  { orientation: 3, quadrants: [3, 2, 1, 0] },
  { orientation: 4, quadrants: [2, 3, 0, 1] },
  { orientation: 5, quadrants: [0, 2, 1, 3] },
  { orientation: 6, quadrants: [1, 3, 0, 2] },
  { orientation: 7, quadrants: [3, 1, 2, 0] },
  { orientation: 8, quadrants: [2, 0, 3, 1] },
])("preserves upright image and poster pixels with EXIF orientation $orientation", async ({ orientation, quadrants }) => {
  const colors = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0]];
  const sideways = orientation !== undefined && orientation >= 5;
  const width = sideways ? 80 : 120;
  const height = sideways ? 120 : 80;
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const quadrant = (y < height / 2 ? 0 : 2) + (x < width / 2 ? 0 : 1);
      pixels.set(colors[quadrants[quadrant]], (y * width + x) * 3);
    }
  }
  const source = sharp(pixels, { raw: { width, height, channels: 3 } });
  const input = orientation === undefined
    ? await source.png().toBuffer()
    : await source.withMetadata({ orientation }).jpeg({ quality: 100, chromaSubsampling: "4:4:4" }).toBuffer();
  expect((await sharp(input).metadata()).orientation).toBe(orientation);
  mocks.image.mockResolvedValue(input);
  const poster = "https://example.com/oriented-poster.jpg";
  const d = create({ videoUrl: "https://example.com/clip.mp4", videoPosterUrl: poster });
  await archiveDump(d.id);
  const saved = db.getDump(d.id)!;
  for (const url of [d.imageUrl!, poster]) {
    const output = await bytes(saved.mediaArchive[url]);
    expect((await sharp(output).metadata()).orientation).toBeUndefined();
    const { data, info } = await sharp(output).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(info).toMatchObject({ width: 120, height: 80, channels: 3 });
    for (const [quadrant, [x, y]] of [[30, 20], [90, 20], [30, 60], [90, 60]].entries()) {
      const actual = data.subarray((y * info.width + x) * 3, (y * info.width + x) * 3 + 3);
      for (let channel = 0; channel < 3; channel++) {
        expect(Math.abs(actual[channel] - colors[quadrant][channel])).toBeLessThan(15);
      }
    }
  }
  expect(mocks.video).not.toHaveBeenCalled();
});

it("handles empty/local sources and independent image failures", async () => {
  const empty = create({ imageUrl: "/api/files/upload.png" });
  await archiveDump(empty.id);
  expect(mocks.image).not.toHaveBeenCalled();
  const d = create({ imageUrls: ["https://example.com/bad", "https://example.com/good"] });
  mocks.image.mockImplementation(async (url) => { if (url.endsWith("bad")) throw new Error("gone"); return image; });
  await archiveDump(d.id);
  expect(db.getDump(d.id)!.mediaArchive["https://example.com/good"]).toBeTruthy();
  expect(db.getDump(d.id)!.mediaArchive["https://example.com/bad"]).toBeUndefined();
});

it("archives posters and only retains full video with opt-in; removal and delete clean files", async () => {
  const videoUrl = "https://example.com/movie.mp4";
  const poster = "https://example.com/poster.png";
  const d = create({ kind: "video", imageUrl: null, videoUrl, videoPosterUrl: poster });
  await archiveDump(d.id);
  expect(mocks.video).not.toHaveBeenCalled();
  expect(videoPoster(db.getDump(d.id)!)).toBe(poster);
  db.updateDump(d.id, { keepVideo: true });
  await archiveDump(d.id);
  const saved = db.getDump(d.id)!;
  expect(hasLocalVideo(saved)).toBe(true);
  expect(await bytes(saved.mediaArchive[videoUrl])).toEqual(Buffer.from([1, 2, 3]));
  expect(mocks.video).toHaveBeenLastCalledWith(videoUrl, { timeoutMs: 300_000 });
  const off = new NextRequest("http://localhost", { method: "PATCH", body: JSON.stringify({ keepVideo: false }) });
  await PATCH(off, { params: Promise.resolve({ id: d.id }) });
  await expect(bytes(saved.mediaArchive[videoUrl])).rejects.toThrow();
  expect(db.getDump(d.id)!.mediaArchive[videoUrl]).toBeUndefined();
  await DELETE(new NextRequest("http://localhost"), { params: Promise.resolve({ id: d.id }) });
  await expect(bytes(saved.mediaArchive[poster])).rejects.toThrow();
});

it("cleans newly written files when deleted while fetching and merges a fresh map", async () => {
  const d = create();
  mocks.image.mockImplementationOnce(async () => { db.deleteDump(d.id); return image; });
  const before = fs.existsSync(path.join(dir, "uploads")) ? fs.readdirSync(path.join(dir, "uploads")) : [];
  await archiveDump(d.id);
  expect(fs.readdirSync(path.join(dir, "uploads"))).toEqual(before);
  const next = create();
  mocks.image.mockImplementationOnce(async () => { db.updateDump(next.id, { mediaArchive: { other: "/api/files/other.webp" } }); return image; });
  await archiveDump(next.id);
  expect(db.getDump(next.id)!.mediaArchive.other).toBe("/api/files/other.webp");
});

it("backfills missing entries with a limit and skips gone images", async () => {
  create(); create({ imageUrl: "https://example.com/b.png" });
  expect(await backfillArchive({ limit: 1 })).toBe(1);
  expect(await backfillArchive()).toBe(1);
  expect(await backfillArchive()).toBe(0);
  create({ imageUrl: "https://example.com/gone" });
  mocks.image.mockResolvedValue(null);
  expect(await backfillArchive()).toBe(1);
});

it("rejects failed and oversized video responses without retaining bytes", async () => {
  mocks.video.mockResolvedValueOnce(new Response(null, { status: 404 }));
  await expect(downloadVideo("https://example.com/gone.mp4")).rejects.toThrow("Video download failed");
  mocks.video.mockResolvedValueOnce(new Response(new Uint8Array([1]), { headers: { "content-length": String(301 * 1024 * 1024) } }));
  await expect(downloadVideo("https://example.com/large.mp4")).rejects.toThrow("Video too large");
});

it("caps poster-only downloads at 64 MB but permits that size for opted-in video", async () => {
  mocks.video.mockImplementation(async () => new Response(new Uint8Array([1]), { headers: { "content-length": String(65 * 1024 * 1024) } }));
  const d = create({ kind: "video", imageUrl: null, videoUrl: "https://example.com/large.mp4" });
  await archiveDump(d.id);
  expect(db.getDump(d.id)!.mediaArchive).toEqual({});
  db.updateDump(d.id, { keepVideo: true });
  await archiveDump(d.id);
  expect(db.getDump(d.id)!.mediaArchive[d.videoUrl!]).toBeTruthy();
});

it("does not retain video when the user opts out during download", async () => {
  const videoUrl = "https://example.com/race.mp4";
  const d = create({ kind: "video", imageUrl: null, videoPosterUrl: "https://example.com/poster.png", videoUrl, keepVideo: true });
  mocks.video.mockImplementationOnce(async () => {
    db.updateDump(d.id, { keepVideo: false });
    return new Response(new Uint8Array([1, 2, 3]));
  });
  await archiveDump(d.id);
  expect(db.getDump(d.id)!.mediaArchive[videoUrl]).toBeUndefined();
  expect(fs.readdirSync(path.join(dir, "uploads")).filter((name) => name.startsWith(d.id))).toHaveLength(1);
});

it("orders fallback sources and recognizes archived videos", () => {
  const d = create({ videoUrl: "https://example.com/a.mp4", mediaArchive: { "https://example.com/a.png": "/api/files/a.webp", "https://example.com/a.mp4": "/api/files/a.mp4" } });
  expect(mediaSources(d, d.imageUrl!)).toEqual([d.imageUrl, "/api/files/a.webp"]);
  expect(mediaSources({ ...d, sourceState: "unavailable" }, d.imageUrl!)).toEqual(["/api/files/a.webp", d.imageUrl]);
  expect(hasLocalVideo(d)).toBe(true);
  expect(hasLocalVideo({ videoUrl: null })).toBe(false);
});

it("serves complete, bounded, suffix and invalid video ranges", async () => {
  await fileStorage.put("range.mp4", new Uint8Array([0, 1, 2, 3, 4]));
  for (const [range, status, expected] of [["bytes=1-3", 206, [1, 2, 3]], ["bytes=-2", 206, [3, 4]], ["bytes=2-", 206, [2, 3, 4]], ["bytes=9-", 416, []], ["bad", 416, []]] as const) {
    const response = await GET(new Request("http://localhost", { headers: { range } }), { params: Promise.resolve({ name: "range.mp4" }) });
    expect(response.status).toBe(status);
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual(expected);
  }
  const full = await GET(new Request("http://localhost"), { params: Promise.resolve({ name: "range.mp4" }) });
  expect(full.status).toBe(200);
  expect(full.headers.get("content-type")).toBe("video/mp4");
});

it.skipIf(spawnSync("ffmpeg", ["-version"]).error)("extracts a frame from a guarded video download", async () => {
  const clip = spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=64x48:d=2", "-c:v", "libvpx", "-f", "webm", "pipe:1"]);
  expect(clip.status).toBe(0);
  mocks.video.mockImplementation(async () => new Response(new Uint8Array(clip.stdout)));
  const d = create({ kind: "video", imageUrl: null, videoUrl: "https://example.com/clip.webm" });
  await archiveDump(d.id);
  const saved = db.getDump(d.id)!;
  expect(await sharp(await bytes(saved.mediaArchive[posterKey(d.videoUrl!)])).metadata()).toMatchObject({ format: "webp", width: 64, height: 48 });
  expect(saved.mediaArchive[d.videoUrl!]).toBeUndefined();
  expect(mocks.video).toHaveBeenLastCalledWith(d.videoUrl, { timeoutMs: 60_000 });
});
