import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import sharp from "sharp";

vi.mock("@xeet/core/node", () => ({
  loadXeet: async () => ({
    resolve: async () => ({ post: {} }),
    render: (_post: unknown, { theme }: { theme: string }) => ({ png: Buffer.from(theme) }),
  }),
}));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dump-storage-"));
process.env.DUMP_DATA_DIR = path.join(dir, "data");

const { fileStorage, storedFileName } = await import("../storage");
const { createFromFile } = await import("../create");
const { classifyWithAi } = await import("../llm");
const { renderXPostImage } = await import("../x-render");
const { GET } = await import("@/app/api/files/[name]/route");
const { DELETE } = await import("@/app/api/dumps/[id]/route");

const req = new NextRequest("http://localhost");
const getFile = (name: string) => GET(req, { params: Promise.resolve({ name }) });

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("saved file storage", () => {
  it("writes, reads, and removes bytes at a stable URL", async () => {
    const bytes = new Uint8Array([0, 1, 255]);
    const url = await fileStorage.put("preview.jpg", bytes);
    expect(url).toBe("/api/files/preview.jpg");
    expect(storedFileName(url)).toBe("preview.jpg");
    expect(await fileStorage.read("preview.jpg")).toEqual(Buffer.from(bytes));
    await fileStorage.remove("preview.jpg");
    await expect(fileStorage.read("preview.jpg")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fileStorage.remove("preview.jpg")).resolves.toBeUndefined();
  });

  it("only accepts flat, portable file names and distinguishes remote thumbnails", async () => {
    for (const name of ["", ".", "nested/photo.png", "nested\\photo.png", "NUL.png", "photo.png."]) {
      expect(storedFileName(`/api/files/${name}`)).toBeNull();
      await expect(fileStorage.put(name, new Uint8Array())).rejects.toThrow("Invalid stored file name");
      await expect(fileStorage.read(name)).rejects.toThrow("Invalid stored file name");
      await expect(fileStorage.remove(name)).rejects.toThrow("Invalid stored file name");
    }
    expect(storedFileName("https://example.com/api/files/preview.jpg")).toBeNull();
    expect((await getFile("nested/photo.png")).status).toBe(404);
    expect((await getFile("unsupported.txt")).status).toBe(404);
  });

  it("serves uploaded bytes with the existing headers and removes them when the dump is deleted", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const dump = await createFromFile(new File([bytes], "my-photo.png", { type: "image/png" }));
    const name = `${dump.id}.png`;
    expect(dump).toMatchObject({ imageUrl: `/api/files/${name}`, title: "my photo" });
    const response = await getFile(name);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect((await DELETE(req, { params: Promise.resolve({ id: dump.id }) })).status).toBe(204);
    expect((await getFile(name)).status).toBe(404);
  });

  it("serves both cached X render variants", async () => {
    const rendered = await renderXPostImage("https://x.com/test/status/123");
    expect(rendered).toEqual({
      light: expect.stringMatching(/^\/api\/files\/xeet-123-light-[a-f0-9]{8}\.png$/),
      dark: expect.stringMatching(/^\/api\/files\/xeet-123-dark-[a-f0-9]{8}\.png$/),
    });
    for (const theme of ["light", "dark"] as const) {
      const response = await getFile(storedFileName(rendered?.[theme])!);
      expect(response.status).toBe(200);
      expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from(theme));
    }
  });

  it("supplies a stored thumbnail to the LLM and falls back to text when it is missing", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({ answers: { topic: { type: "choice", choice: "food" } } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const bytes = await sharp({ create: { width: 100, height: 100, channels: 3, background: "#fff" } }).png().toBuffer();
    const imageUrl = await fileStorage.put("thumbnail.png", bytes);
    const input = { kind: "image", imageUrl, useImage: true };
    await expect(classifyWithAi(input)).resolves.toMatchObject({ topic: "food" });
    const payload = () => JSON.parse(fetchMock.mock.lastCall![1]?.body as string);
    expect(payload().state.image.image_url.url).toMatch(/^data:image\/jpeg;base64,/);
    await fileStorage.remove("thumbnail.png");
    await expect(classifyWithAi(input)).resolves.toMatchObject({ topic: "food" });
    expect(payload().state).not.toHaveProperty("image");
  });
});
