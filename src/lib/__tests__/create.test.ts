import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dump-create-"));
process.env.DUMP_DATA_DIR = dir;

const { createFromText, InputError } = await import("../create");
const { counts } = await import("../db");

describe("createFromText", () => {
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

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
});
