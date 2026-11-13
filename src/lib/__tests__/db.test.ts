import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dump-test-"));
process.env.DUMP_DATA_DIR = dir;

const db = await import("../db");

describe("db + search", () => {
  beforeAll(() => {
    db.createDump({ kind: "article", topic: "food", title: "Creamy garlic pasta", description: "Weeknight dinner", tags: ["pasta"] });
    db.createDump({ kind: "post", topic: "tech", title: "Next.js tips", content: "Server actions are neat", domain: "x.com" });
    db.createDump({ kind: "note", topic: "personal", title: "Call mom", content: "Call mom about dinner" });
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("searches by prefix across fields", () => {
    expect(db.listDumps({ q: "past" }).map((d) => d.title)).toEqual(["Creamy garlic pasta"]);
    expect(db.listDumps({ q: "dinner" })).toHaveLength(2);
    expect(db.listDumps({ q: "server action" })[0].title).toBe("Next.js tips");
  });

  it("filters by topic and kind", () => {
    expect(db.listDumps({ topic: "food" })).toHaveLength(1);
    expect(db.listDumps({ kind: "note", q: "dinner" })).toHaveLength(1);
  });

  it("keeps search in sync on update and delete", () => {
    const [note] = db.listDumps({ kind: "note" });
    db.updateDump(note.id, { content: "Book flights to Tokyo" });
    expect(db.listDumps({ q: "tokyo" })).toHaveLength(1);
    db.deleteDump(note.id);
    expect(db.listDumps({ q: "tokyo" })).toHaveLength(0);
    expect(db.counts().total).toBe(2);
  });

  it("ignores FTS syntax characters in queries", () => {
    expect(() => db.listDumps({ q: '"unbalanced AND (' })).not.toThrow();
  });

  it("pages through results with limit and offset", () => {
    const all = db.listDumps();
    const pages = [...db.listDumps({ limit: 2 }), ...db.listDumps({ limit: 2, offset: 2 })];
    expect(pages.map((d) => d.id)).toEqual(all.map((d) => d.id));
  });
});
