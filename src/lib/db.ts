import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Kind, Subject, Topic } from "./taxonomy";

export type Status = "processing" | "ready" | "failed";

export interface Dump {
  id: string;
  kind: Kind;
  topic: Topic;
  status: Status;
  url: string | null;
  domain: string | null;
  title: string | null;
  description: string | null;
  content: string | null;
  note: string | null;
  imageUrl: string | null;
  siteName: string | null;
  author: string | null;
  summary: string | null;
  /** Identified subject for clips/images, e.g. {"type":"show","name":"Severance"}. JSON in the DB. */
  subject: Subject | null;
  tags: string[];
  classifiedBy: "rules" | "ai" | "you" | null;
  topicLocked: boolean;
  createdAt: number;
  updatedAt: number;
}

interface Row {
  id: string;
  kind: string;
  topic: string;
  status: string;
  url: string | null;
  domain: string | null;
  title: string | null;
  description: string | null;
  content: string | null;
  note: string | null;
  image_url: string | null;
  site_name: string | null;
  author: string | null;
  summary: string | null;
  subject: string | null;
  tags: string;
  classified_by: string | null;
  topic_locked: number;
  created_at: number;
  updated_at: number;
}

export const DATA_DIR = path.resolve(process.env.DUMP_DATA_DIR ?? path.join(process.cwd(), "data"));
export const UPLOAD_DIR = path.join(DATA_DIR, "uploads");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS dumps (
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
  subject TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  classified_by TEXT,
  topic_locked INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS dumps_created ON dumps(created_at DESC);
CREATE INDEX IF NOT EXISTS dumps_topic ON dumps(topic);
CREATE INDEX IF NOT EXISTS dumps_kind ON dumps(kind);
CREATE INDEX IF NOT EXISTS dumps_url ON dumps(url);

CREATE VIRTUAL TABLE IF NOT EXISTS dumps_fts USING fts5(
  title, description, content, note, summary, tags, domain, author, site_name,
  content='dumps', content_rowid='rowid', tokenize='porter unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS dumps_ai AFTER INSERT ON dumps BEGIN
  INSERT INTO dumps_fts(rowid, title, description, content, note, summary, tags, domain, author, site_name)
  VALUES (new.rowid, new.title, new.description, new.content, new.note, new.summary, new.tags, new.domain, new.author, new.site_name);
END;
CREATE TRIGGER IF NOT EXISTS dumps_ad AFTER DELETE ON dumps BEGIN
  INSERT INTO dumps_fts(dumps_fts, rowid, title, description, content, note, summary, tags, domain, author, site_name)
  VALUES ('delete', old.rowid, old.title, old.description, old.content, old.note, old.summary, old.tags, old.domain, old.author, old.site_name);
END;
CREATE TRIGGER IF NOT EXISTS dumps_au AFTER UPDATE ON dumps BEGIN
  INSERT INTO dumps_fts(dumps_fts, rowid, title, description, content, note, summary, tags, domain, author, site_name)
  VALUES ('delete', old.rowid, old.title, old.description, old.content, old.note, old.summary, old.tags, old.domain, old.author, old.site_name);
  INSERT INTO dumps_fts(rowid, title, description, content, note, summary, tags, domain, author, site_name)
  VALUES (new.rowid, new.title, new.description, new.content, new.note, new.summary, new.tags, new.domain, new.author, new.site_name);
END;
`;

const globalForDb = globalThis as unknown as { __dumpDb?: Database.Database };

export function db(): Database.Database {
  if (!globalForDb.__dumpDb) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const conn = new Database(path.join(DATA_DIR, "dump.db"));
    conn.pragma("journal_mode = WAL");
    conn.exec(SCHEMA);
    // Columns added after v1 land here for databases created before them.
    const cols = conn.prepare("PRAGMA table_info(dumps)").all() as { name: string }[];
    if (!cols.some((c) => c.name === "subject")) conn.exec("ALTER TABLE dumps ADD COLUMN subject TEXT");
    globalForDb.__dumpDb = conn;
  }
  return globalForDb.__dumpDb;
}

function toDump(r: Row): Dump {
  return {
    id: r.id,
    kind: r.kind as Kind,
    topic: r.topic as Topic,
    status: r.status as Status,
    url: r.url,
    domain: r.domain,
    title: r.title,
    description: r.description,
    content: r.content,
    note: r.note,
    imageUrl: r.image_url,
    siteName: r.site_name,
    author: r.author,
    summary: r.summary,
    subject: safeJsonObject(r.subject),
    tags: safeJsonArray(r.tags),
    classifiedBy: r.classified_by as Dump["classifiedBy"],
    topicLocked: r.topic_locked === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function safeJsonObject(s: string | null): Subject | null {
  if (!s) return null;
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" ? (v as Subject) : null;
  } catch {
    return null;
  }
}

function safeJsonArray(s: string): string[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

const COLUMN: Record<string, string> = {
  kind: "kind",
  topic: "topic",
  status: "status",
  url: "url",
  domain: "domain",
  title: "title",
  description: "description",
  content: "content",
  note: "note",
  imageUrl: "image_url",
  siteName: "site_name",
  author: "author",
  summary: "summary",
  subject: "subject",
  tags: "tags",
  classifiedBy: "classified_by",
  topicLocked: "topic_locked",
};

type Patch = Partial<Omit<Dump, "id" | "createdAt" | "updatedAt">>;

function toColumns(patch: Patch): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    const col = COLUMN[key];
    if (!col || value === undefined) continue;
    if (key === "tags") out[col] = JSON.stringify(value);
    else if (key === "subject") out[col] = value ? JSON.stringify(value) : null;
    else if (key === "topicLocked") out[col] = value ? 1 : 0;
    else out[col] = value;
  }
  return out;
}

export function createDump(fields: Patch & { kind: Kind }, id: string = randomUUID()): Dump {
  const now = Date.now();
  const cols = { ...toColumns({ topic: "other", status: "processing", tags: [], ...fields }), id, created_at: now, updated_at: now };
  const names = Object.keys(cols);
  db()
    .prepare(`INSERT INTO dumps (${names.join(", ")}) VALUES (${names.map((n) => `@${n}`).join(", ")})`)
    .run(cols);
  return getDump(id)!;
}

export function updateDump(id: string, patch: Patch): Dump | null {
  const cols = toColumns(patch);
  const names = Object.keys(cols);
  if (names.length) {
    db()
      .prepare(`UPDATE dumps SET ${names.map((n) => `${n} = @${n}`).join(", ")}, updated_at = @updated_at WHERE id = @id`)
      .run({ ...cols, updated_at: Date.now(), id });
  }
  return getDump(id);
}

export function getDump(id: string): Dump | null {
  const row = db().prepare("SELECT * FROM dumps WHERE id = ?").get(id) as Row | undefined;
  return row ? toDump(row) : null;
}

export function findByUrl(url: string): Dump | null {
  const row = db().prepare("SELECT * FROM dumps WHERE url = ? ORDER BY created_at DESC LIMIT 1").get(url) as Row | undefined;
  return row ? toDump(row) : null;
}

/** Moves an existing dump back to the top of the feed. */
export function bumpDump(id: string): Dump | null {
  db().prepare("UPDATE dumps SET created_at = @now, updated_at = @now WHERE id = @id").run({ now: Date.now(), id });
  return getDump(id);
}

export function deleteDump(id: string): Dump | null {
  const existing = getDump(id);
  if (existing) db().prepare("DELETE FROM dumps WHERE id = ?").run(id);
  return existing;
}

/** Turns free text into a safe FTS5 query: every word must match, as a prefix. */
export function toFtsQuery(q: string): string | null {
  const terms = q
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0)
    .slice(0, 12);
  if (!terms.length) return null;
  return terms.map((t) => `"${t}"*`).join(" ");
}

export interface ListOptions {
  q?: string | null;
  kind?: string | null;
  topic?: string | null;
  limit?: number;
  offset?: number;
}

export function listDumps({ q, kind, topic, limit = 200, offset = 0 }: ListOptions = {}): Dump[] {
  const where: string[] = [];
  const params: Record<string, unknown> = { limit, offset };
  if (kind) {
    where.push("d.kind = @kind");
    params.kind = kind;
  }
  if (topic) {
    where.push("d.topic = @topic");
    params.topic = topic;
  }

  const fts = q ? toFtsQuery(q) : null;
  let sql: string;
  if (fts) {
    params.fts = fts;
    sql = `SELECT d.* FROM dumps_fts f JOIN dumps d ON d.rowid = f.rowid
           WHERE dumps_fts MATCH @fts ${where.length ? `AND ${where.join(" AND ")}` : ""}
           ORDER BY bm25(dumps_fts, 10.0, 4.0, 1.0, 4.0, 3.0, 6.0, 2.0, 2.0, 2.0), d.created_at DESC, d.id
           LIMIT @limit OFFSET @offset`;
  } else {
    sql = `SELECT d.* FROM dumps d ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
           ORDER BY d.created_at DESC, d.id LIMIT @limit OFFSET @offset`;
  }
  return (db().prepare(sql).all(params) as Row[]).map(toDump);
}

/** Dumps whose topic can be re-decided: not filed by hand and not mid-enrichment. */
export function listResortable(): string[] {
  return (db().prepare("SELECT id FROM dumps WHERE topic_locked = 0 AND status != 'processing' ORDER BY created_at DESC").all() as { id: string }[]).map((r) => r.id);
}

export function counts(): { total: number; kinds: Record<string, number>; topics: Record<string, number> } {
  const conn = db();
  const total = (conn.prepare("SELECT COUNT(*) AS n FROM dumps").get() as { n: number }).n;
  const kinds = Object.fromEntries(
    (conn.prepare("SELECT kind, COUNT(*) AS n FROM dumps GROUP BY kind").all() as { kind: string; n: number }[]).map((r) => [r.kind, r.n]),
  );
  const topics = Object.fromEntries(
    (conn.prepare("SELECT topic, COUNT(*) AS n FROM dumps GROUP BY topic").all() as { topic: string; n: number }[]).map((r) => [r.topic, r.n]),
  );
  return { total, kinds, topics };
}
