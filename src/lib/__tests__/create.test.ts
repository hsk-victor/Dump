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
});
