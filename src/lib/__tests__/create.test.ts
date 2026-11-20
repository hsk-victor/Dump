import { afterAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";

vi.mock("next/server", async (original) => ({ ...await original<typeof import("next/server")>(), after: vi.fn() }));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dump-create-"));
process.env.DUMP_DATA_DIR = dir;

const { createFromFile, createFromText, InputError } = await import("../create");
const { counts, createDump, listDumps } = await import("../db");
const { fileStorage, storedFileName } = await import("../storage");
const { GET: downloadFile } = await import("@/app/api/files/[name]/route");
const { POST: saveDump } = await import("@/app/api/dumps/route");
const { MAX_UPLOAD_BYTES } = await import("../upload");

afterAll(() => {
  (globalThis as { __dumpDb?: { close(): void } }).__dumpDb?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("createFromText", () => {

  it("saves notes with a title from the first line", () => {
    const d = createFromText("Groceries\n- eggs\n- milk");
    expect(d).toMatchObject({ kind: "note", title: "Groceries", status: "processing" });
  });

  it("saves links with a URL-based kind straight away", () => {
    const d = createFromText("https://www.youtube.com/watch?v=abc");
    expect(d).toMatchObject({ kind: "video", domain: "youtube.com", url: "https://www.youtube.com/watch?v=abc" });
  });

  it("doesn't duplicate a link dumped twice, but keeps the new note", () => {
    const first = createFromText("https://example.com/a");
    const again = createFromText("https://example.com/a?utm_source=x so good");
    expect(again.id).toBe(first.id);
    expect(again.duplicate).toBe(true);
    expect(again.note).toBe("so good");
    expect(counts().total).toBe(3);
  });

  it("rejects empty input", () => {
    expect(() => createFromText("   ")).toThrow(InputError);
  });

  it.each(["blob:https://x.com/3f2a", "  BLOB:https://youtube.com/uuid  ", "watch this blob:https://instagram.com/uuid"])("rejects browser-local video addresses without saving anything: %s", (text) => {
    const before = counts().total;
    expect(() => createFromText(text)).toThrow("That's a temporary in-browser video address — copy the post's link instead.");
    expect(counts().total).toBe(before);
  });

  it("backfills bookmarklet metadata on a duplicate and flags it for re-enrichment", () => {
    const first = createFromText("https://example.com/clip");
    const again = createFromText("https://example.com/clip", {
      title: "A reel",
      description: "mark and helly in the elevator scene",
      imageUrl: "https://cdn.example.com/t.jpg",
    });
    expect(again.id).toBe(first.id);
    expect(again).toMatchObject({ duplicate: true, resync: true, title: "A reel", description: "mark and helly in the elevator scene", imageUrl: "https://cdn.example.com/t.jpg" });
  });

  it("keeps existing metadata on a duplicate and drops unsafe image URLs", () => {
    const first = createFromText("https://example.com/vid", { title: "Kept", description: "old desc" });
    const again = createFromText("https://example.com/vid", { title: "New", description: "new desc", imageUrl: "javascript:alert(1)" });
    expect(again).toMatchObject({ duplicate: true, resync: false, title: "Kept", description: "old desc", imageUrl: null });
    expect(first.imageUrl).toBeNull();
  });

  it("leaves direct video filename titles as display-only fallbacks", () => {
    expect(createFromText("https://example.com/Spring%20flowers.mp4")).toMatchObject({ kind: "video", title: null, videoUrl: "https://example.com/Spring%20flowers.mp4" });
  });

  it("deduplicates the three NASA URLs and moves the original dump to the top", () => {
    const before = counts().total;
    const original = "https://twitter.com/NASAWebb/status/1546621080298835970";
    const first = createFromText(original);
    for (const url of [
      "https://x.com/NASAWebb/status/1546621080298835970?s=20",
      "https://x.com/NASAWebb/status/1546621080298835970",
    ]) {
      const newer = createFromText("An intervening note");
      expect(listDumps()[0].id).toBe(newer.id);
      const again = createFromText(url);
      expect(again).toMatchObject({ id: first.id, duplicate: true, url: original });
      expect(again.position).toBeGreaterThan(newer.position);
      expect(listDumps()[0].id).toBe(first.id);
    }
    expect(counts().total).toBe(before + 3);
    expect(listDumps().filter((dump) => dump.id === first.id)).toHaveLength(1);
  });

  it("matches pre-existing rows without rewriting their URLs", () => {
    const url = "https://mobile.twitter.com/old/status/987654321?utm_source=legacy#photo";
    const legacy = createDump({ kind: "post", url, title: "Legacy post" });
    const before = counts().total;
    expect(createFromText("https://x.com/i/web/status/987654321"))
      .toMatchObject({ id: legacy.id, duplicate: true, url, title: "Legacy post" });
    expect(counts().total).toBe(before);
  });

  it("saves meaningful query variants as separate dumps", () => {
    const first = createFromText("https://example.com/search?q=one");
    const second = createFromText("https://example.com/search?q=two");
    expect(second.id).not.toBe(first.id);
    expect(second.duplicate).toBeUndefined();
  });
});

describe("createFromFile", () => {
  it("stores an independent file copy and serves it only as an attachment", async () => {
    const dump = await createFromFile(new File(["<h1>Notes</h1>"], "café.html", { type: "text/html" }), " reference ");
    expect(dump).toMatchObject({
      kind: "file", title: "café.html", url: null, note: "reference",
      attachment: { name: "café.html", type: "text/html", size: 14 },
    });
    expect(listDumps({ kind: "file" })[0].attachment).toEqual(dump.attachment);
    const name = storedFileName(dump.attachment!.url)!;
    expect((await fileStorage.read(name)).toString()).toBe("<h1>Notes</h1>");
    const response = await downloadFile(new Request("http://localhost"), { params: Promise.resolve({ name }) });
    expect(response.headers.get("content-type")).toBe("application/octet-stream");
    expect(response.headers.get("content-disposition")).toBe("attachment; filename*=UTF-8''caf%C3%A9.html");
    await expect(response.text()).resolves.toBe("<h1>Notes</h1>");
  });

  it("keeps image uploads distinct from file records", async () => {
    const dump = await createFromFile(new File(["image"], "image.png", { type: "image/png" }), "Screenshot");
    expect(dump).toMatchObject({ kind: "image", attachment: null, title: "Screenshot", imageUrl: expect.stringMatching(/\.png$/) });
  });

  it("rejects oversized files before committing a record", async () => {
    const before = counts().total;
    const file = new File([new Uint8Array(MAX_UPLOAD_BYTES + 1)], "large.zip");
    await expect(createFromFile(file)).rejects.toThrow("File is larger than 15 MB");
    expect(counts().total).toBe(before);
  });
});

describe("multipart dump saves", () => {
  function saveFiles(...files: File[]) {
    const body = new FormData();
    body.set("text", "A note must not be saved when its attachment is rejected");
    for (const file of files) body.append("file", file);
    return saveDump(new NextRequest("http://localhost/api/dumps", { method: "POST", body }));
  }

  it("rejects multiple file parts without saving the first file or the note", async () => {
    const before = counts().total;
    const response = await saveFiles(new File(["one"], "one.txt"), new File(["two"], "two.txt"));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Dump one file at a time." });
    expect(counts().total).toBe(before);
  });

  it.each([
    ["documents/", ""],
    ["documents/report.txt", "text/plain"],
    ["documents\\report.txt", "text/plain"],
    ["documents", "inode/directory"],
    ["documents", "application/x-directory"],
  ])("rejects the folder upload %s (%s) without saving the note", async (name, type) => {
    const before = counts().total;
    const response = await saveFiles(new File([], name, { type }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Folders can’t be dumped. Choose a file instead." });
    expect(counts().total).toBe(before);
  });

  it("still saves an empty regular file", async () => {
    const response = await saveFiles(new File([], "empty.txt", { type: "text/plain" }));
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ kind: "file", attachment: { name: "empty.txt", size: 0 } });
  });
});
