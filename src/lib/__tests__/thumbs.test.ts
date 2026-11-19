import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dump-thumbs-"));
process.env.DUMP_DATA_DIR = dir;

const fetchImage = vi.fn();
vi.mock("../extract", () => ({ fetchImage: (url: string) => fetchImage(url) }));

const { UPLOAD_DIR } = await import("../db");
const { isExpiringUrl, storeRemoteImage } = await import("../thumbs");

const image = (format: "jpeg" | "png" | "tiff") => sharp({ create: { width: 4, height: 6, channels: 3, background: "#f80" } }).toFormat(format).toBuffer();

describe("isExpiringUrl", () => {
  it.each([
    "https://p19-common-sign.tiktokcdn-us.com/a~tplv-tiktokx-origin.image?dr=9636&x-expires=1795240800&x-signature=gHw4",
    "https://scontent.cdninstagram.com/v/t51/1.jpg?stp=dst&oh=00_AY&oe=6744F1A2",
    "https://bucket.s3.amazonaws.com/a.jpg?X-Amz-Expires=3600&X-Amz-Signature=abc",
    "https://d111.cloudfront.net/a.jpg?Expires=1&Signature=abc&Key-Pair-Id=K",
  ])("flags %s", (url) => expect(isExpiringUrl(url)).toBe(true));

  it.each([null, "", "/api/files/a.jpg", "https://i.ytimg.com/vi/x/hqdefault.jpg", "https://example.com/a.jpg?oe=1", "not a url"])("leaves %s alone", (url) =>
    expect(isExpiringUrl(url)).toBe(false),
  );
});

describe("storeRemoteImage", () => {
  beforeEach(() => fetchImage.mockReset());
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("keeps a local copy named by dump id and content", async () => {
    const jpeg = await image("jpeg");
    fetchImage.mockResolvedValue(jpeg);
    const stored = await storeRemoteImage("dump-1", "https://cdn.example/a.jpg?x-expires=1&x-signature=s");
    expect(stored).toMatch(/^\/api\/files\/dump-1-thumb-[0-9a-f]{12}\.jpg$/);
    expect(fs.readFileSync(path.join(UPLOAD_DIR, path.basename(stored!)))).toEqual(jpeg);
    // Same bytes again (a re-fetch with a freshly signed URL) reuse the same file.
    expect(await storeRemoteImage("dump-1", "https://cdn.example/a.jpg?x-expires=2&x-signature=t")).toBe(stored);
  });

  it("converts formats the file route can't serve to WebP", async () => {
    fetchImage.mockResolvedValue(await image("tiff"));
    const stored = await storeRemoteImage("dump-2", "https://cdn.example/a.tiff");
    expect(stored).toMatch(/\.webp$/);
    expect((await sharp(path.join(UPLOAD_DIR, path.basename(stored!))).metadata()).format).toBe("webp");
  });

  it("returns null when the image can't be fetched or decoded", async () => {
    fetchImage.mockResolvedValue(null);
    expect(await storeRemoteImage("dump-3", "https://cdn.example/gone.jpg")).toBeNull();
    fetchImage.mockResolvedValue(Buffer.from("<html>not an image</html>"));
    expect(await storeRemoteImage("dump-3", "https://cdn.example/html.jpg")).toBeNull();
  });
});
