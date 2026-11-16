import { afterAll, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dump-migrate-"));
process.env.DUMP_DATA_DIR = dir;

// A pre-migration database: only the v1 columns — nothing added later by ALTER
// (provider, image_urls, author_handle/avatar, video_*, subject, pinned, position).
// Index DDL referencing pinned/position must run after those ALTERs or db() throws.
const conn = new Database(path.join(dir, "dump.db"));
conn.exec(`CREATE TABLE dumps (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  topic TEXT NOT NULL DEFAULT 'other',
  status TEXT NOT NULL DEFAULT 'processing',
  url TEXT,
  domain TEXT,
  title TEXT,
  description TEXT,
  content TEXT,
  note TEXT,
  image_url TEXT,
  site_name TEXT,
  author TEXT,
  summary TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  classified_by TEXT,
  topic_locked INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)`);
conn.close();

const db = await import("../db");

describe("pre-migration database", () => {
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("opens a database without pinned/position and migrates it", () => {
    const d = db.createDump({ kind: "note", title: "hi", content: "body" });
    expect(d.id).toBeTruthy();
    expect(db.counts().total).toBe(1);
    expect(db.listDumps({ q: "body" })).toHaveLength(1);
  });
});
