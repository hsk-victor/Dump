import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Kind, Provider, Subject, Topic, TopicMeta } from "./taxonomy";
import { TOPICS, TOPIC_CRITERIA } from "./taxonomy";
import { providerFromUrl } from "./detect";
import { canonicalUrl } from "./canonical-url";

export type Status = "processing" | "ready" | "failed";

/** xeet-rendered post PNGs, one per theme — /api/files/ paths into uploads. JSON in the DB. */
export interface XRender {
  light: string;
  dark?: string;
}

export interface Dump {
  id: string;
  kind: Kind;
  topic: Topic;
  status: Status;
  url: string | null;
  domain: string | null;
  /** The service the URL came from (github, youtube, x…). Picks the card variant; null for notes/other sites. */
  provider: Provider | null;
  title: string | null;
  description: string | null;
  content: string | null;
  note: string | null;
  imageUrl: string | null;
  /** Every image the page advertised, first == imageUrl (falls back to [imageUrl] for old rows). JSON in the DB. */
  imageUrls: string[];
  siteName: string | null;
  author: string | null;
  authorHandle: string | null;
  authorAvatarUrl: string | null;
  videoUrl: string | null;
  videoPosterUrl: string | null;
  videoType: "video" | "animated_gif" | null;
  /** The post rendered as it looks on x.com (X dumps only). Null = fall back to the built card. */
  xRender: XRender | null;
  summary: string | null;
  /** Identified subject for clips/images, e.g. {"type":"show","name":"Severance"}. JSON in the DB. */
  subject: Subject | null;
  tags: string[];
  classifiedBy: "rules" | "ai" | "you" | null;
  topicLocked: boolean;
  pinned: boolean;
  /** Manual sort key — the feed orders pinned first, then position DESC (newest = max+1). Drags slot it between neighbours. */
  position: number;
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
  provider: string | null;
  title: string | null;
  description: string | null;
  content: string | null;
  note: string | null;
  image_url: string | null;
  image_urls: string | null;
  site_name: string | null;
  author: string | null;
  author_handle: string | null;
  author_avatar_url: string | null;
  video_url: string | null;
  video_poster_url: string | null;
  video_type: string | null;
  x_render: string | null;
  summary: string | null;
  subject: string | null;
  tags: string;
  classified_by: string | null;
  topic_locked: number;
  pinned: number;
  position: number;
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
  provider TEXT,
  title TEXT,
  description TEXT,
  content TEXT,
  note TEXT,
  image_url TEXT,
  image_urls TEXT,
  site_name TEXT,
  author TEXT,
  author_handle TEXT,
  author_avatar_url TEXT,
  video_url TEXT,
  video_poster_url TEXT,
  video_type TEXT,
  x_render TEXT,
  summary TEXT,
  subject TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  classified_by TEXT,
  topic_locked INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0,
  position REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS topics (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  color TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  position REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
`;

// Indexes/triggers that depend on post-v1 columns (pinned, position) must run after the
// ALTER migrations below — databases created before those columns existed would fail
// to open if the index DDL ran first.
const SCHEMA_MIGRATED = `
CREATE INDEX IF NOT EXISTS dumps_created ON dumps(created_at DESC);
CREATE INDEX IF NOT EXISTS dumps_url ON dumps(url);
-- The feed's ORDER BY — without a covering index every /api/dumps is a full scan + temp sort.
-- The kind/topic-prefixed variants serve the same ordering under those filters.
CREATE INDEX IF NOT EXISTS dumps_feed ON dumps(pinned DESC, position DESC, created_at DESC, id);
CREATE INDEX IF NOT EXISTS dumps_feed_kind ON dumps(kind, pinned DESC, position DESC, created_at DESC, id);
CREATE INDEX IF NOT EXISTS dumps_feed_topic ON dumps(topic, pinned DESC, position DESC, created_at DESC, id);
-- MAX(position) for top-position inserts/re-dumps; the pinned-leading composite can't serve it.
CREATE INDEX IF NOT EXISTS dumps_position ON dumps(position);
-- Fully covered by the feed_* prefixes above.
DROP INDEX IF EXISTS dumps_kind;
DROP INDEX IF EXISTS dumps_topic;

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
-- Only FTS-indexed columns trigger a row rewrite: position/pin/status updates
-- would otherwise delete and reinsert the whole FTS row on every reorder.
DROP TRIGGER IF EXISTS dumps_au;
CREATE TRIGGER dumps_au AFTER UPDATE OF title, description, content, note, summary, tags, domain, author, site_name ON dumps BEGIN
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
    if (!cols.some((c) => c.name === "provider")) conn.exec("ALTER TABLE dumps ADD COLUMN provider TEXT");
    if (!cols.some((c) => c.name === "image_urls")) conn.exec("ALTER TABLE dumps ADD COLUMN image_urls TEXT");
    for (const name of ["author_handle", "author_avatar_url", "video_url", "video_poster_url", "video_type", "x_render"]) {
      if (!cols.some((c) => c.name === name)) conn.exec(`ALTER TABLE dumps ADD COLUMN ${name} TEXT`);
    }
    if (!cols.some((c) => c.name === "pinned")) conn.exec("ALTER TABLE dumps ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0");
    if (!cols.some((c) => c.name === "position")) {
      conn.exec("ALTER TABLE dumps ADD COLUMN position REAL NOT NULL DEFAULT 0");
      // Backfill by created_at rank (not rowid): re-dumped links bumped created_at,
      // and their place at the top of the feed must survive under position DESC.
      conn.exec(`UPDATE dumps SET position = (
        SELECT COUNT(*) FROM dumps d2
        WHERE d2.created_at < dumps.created_at
           OR (d2.created_at = dumps.created_at AND d2.rowid <= dumps.rowid)
      )`);
    }
    conn.exec(SCHEMA_MIGRATED);
    seedTopics(conn);
    globalForDb.__dumpDb = conn;
  }
  return globalForDb.__dumpDb;
}

/** First-run seed: the built-in taxonomy, its colors and the AI's filing criteria.
 *  Skipped once any row exists — deletions must stick across restarts. */
function seedTopics(conn: Database.Database) {
  const { n } = conn.prepare("SELECT COUNT(*) AS n FROM topics").get() as { n: number };
  if (n > 0) return;
  const insert = conn.prepare(
    "INSERT OR IGNORE INTO topics (id, label, color, description, position, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const now = Date.now();
  for (const [i, t] of TOPICS.entries()) {
    insert.run(t.id, t.label, t.color, TOPIC_CRITERIA[t.id] ?? "", i, now);
  }
}

function toDump(r: Row): Dump {
  return {
    id: r.id,
    kind: r.kind as Kind,
    topic: r.topic as Topic,
    status: r.status as Status,
    url: r.url,
    domain: r.domain,
    // Rows saved before the column existed still get a provider: it's a pure function of the URL.
    provider: (r.provider as Provider | null) ?? (r.url ? providerFromUrl(r.url) : null),
    title: r.title,
    description: r.description,
    content: r.content,
    note: r.note,
    imageUrl: r.image_url,
    imageUrls: imageUrls(r.image_urls, r.image_url),
    siteName: r.site_name,
    author: r.author,
    authorHandle: r.author_handle,
    authorAvatarUrl: r.author_avatar_url,
    videoUrl: r.video_url,
    videoPosterUrl: r.video_poster_url,
    videoType: r.video_type as Dump["videoType"],
    xRender: safeJsonObject(r.x_render) as XRender | null,
    summary: r.summary,
    subject: safeJsonObject(r.subject),
    tags: safeJsonArray(r.tags),
    classifiedBy: r.classified_by as Dump["classifiedBy"],
    topicLocked: r.topic_locked === 1,
    pinned: r.pinned === 1,
    position: r.position,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function imageUrls(json: string | null, single: string | null): string[] {
  const urls = json ? safeJsonArray(json) : [];
  if (urls.length) return urls;
  return single ? [single] : [];
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
  provider: "provider",
  title: "title",
  description: "description",
  content: "content",
  note: "note",
  imageUrl: "image_url",
  imageUrls: "image_urls",
  siteName: "site_name",
  author: "author",
  authorHandle: "author_handle",
  authorAvatarUrl: "author_avatar_url",
  videoUrl: "video_url",
  videoPosterUrl: "video_poster_url",
  videoType: "video_type",
  xRender: "x_render",
  summary: "summary",
  subject: "subject",
  tags: "tags",
  classifiedBy: "classified_by",
  topicLocked: "topic_locked",
  pinned: "pinned",
  position: "position",
};

type Patch = Partial<Omit<Dump, "id" | "createdAt" | "updatedAt">>;

function toColumns(patch: Patch): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    const col = COLUMN[key];
    if (!col || value === undefined) continue;
    if (key === "tags") out[col] = JSON.stringify(value);
    else if (key === "imageUrls") out[col] = (value as string[] | null)?.length ? JSON.stringify(value) : null;
    else if (key === "subject" || key === "xRender") out[col] = value ? JSON.stringify(value) : null;
    else if (key === "topicLocked" || key === "pinned") out[col] = value ? 1 : 0;
    else out[col] = value;
  }
  return out;
}

/** Next slot at the top of the feed: ordering is position DESC, so new/reshuffled cards take max+1. */
export function topPosition(): number {
  return (db().prepare("SELECT COALESCE(MAX(position), 0) + 1 AS p FROM dumps").get() as { p: number }).p;
}

export function createDump(fields: Patch & { kind: Kind }, id: string = randomUUID()): Dump {
  const now = Date.now();
  const cols = {
    ...toColumns({ topic: "other", status: "processing", tags: [], position: topPosition(), ...fields }),
    id,
    created_at: now,
    updated_at: now,
  };
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
  const key = canonicalUrl(url);
  const rows = db().prepare("SELECT id, url FROM dumps WHERE url IS NOT NULL ORDER BY created_at DESC").iterate() as Iterable<{ id: string; url: string }>;
  for (const row of rows) {
    if (canonicalUrl(row.url) === key) return getDump(row.id);
  }
  return null;
}

/** Moves an existing dump back to the top of the feed, folding any patch into the same write. */
export function bumpDump(id: string, patch: Patch = {}): Dump | null {
  const cols = toColumns(patch);
  const names = Object.keys(cols);
  const assigns = names.length ? `${names.map((n) => `${n} = @${n}`).join(", ")}, ` : "";
  db()
    .prepare(
      `UPDATE dumps SET ${assigns}created_at = @now, updated_at = @now, position = (SELECT COALESCE(MAX(position), 0) + 1 FROM dumps) WHERE id = @id`,
    )
    .run({ ...cols, now: Date.now(), id });
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

// Feed rows name their columns instead of SELECT *: `content` holds up to 50KB of
// extracted article text per row, but only note cards ever render it.
const FEED_COLS = `d.id, d.kind, d.topic, d.status, d.url, d.domain, d.provider, d.title, d.description,
  CASE WHEN d.kind = 'note' THEN d.content END AS content,
  d.note, d.image_url, d.image_urls, d.site_name, d.author, d.author_handle, d.author_avatar_url,
  d.video_url, d.video_poster_url, d.video_type, d.x_render, d.summary, d.subject, d.tags,
  d.classified_by, d.topic_locked, d.pinned, d.position, d.created_at, d.updated_at`;

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
    sql = `SELECT ${FEED_COLS} FROM dumps_fts f JOIN dumps d ON d.rowid = f.rowid
           WHERE dumps_fts MATCH @fts ${where.length ? `AND ${where.join(" AND ")}` : ""}
           ORDER BY d.pinned DESC, bm25(dumps_fts, 10.0, 4.0, 1.0, 4.0, 3.0, 6.0, 2.0, 2.0, 2.0), d.created_at DESC, d.id
           LIMIT @limit OFFSET @offset`;
  } else {
    sql = `SELECT ${FEED_COLS} FROM dumps d ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
           ORDER BY d.pinned DESC, d.position DESC, d.created_at DESC, d.id LIMIT @limit OFFSET @offset`;
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

/* ── Topics (categories) ─────────────────────────────────────────────────── */

interface TopicRow {
  id: string;
  label: string;
  color: string;
  description: string;
  position: number;
  created_at: number;
}

const toTopicMeta = (r: TopicRow): TopicMeta => ({ id: r.id, label: r.label, color: r.color, description: r.description || undefined });

export function listTopics(): TopicMeta[] {
  return (db().prepare("SELECT * FROM topics ORDER BY position, created_at").all() as TopicRow[]).map(toTopicMeta);
}

export function topicExists(id: unknown): id is Topic {
  return typeof id === "string" && !!db().prepare("SELECT 1 FROM topics WHERE id = ?").get(id);
}

export function getTopic(id: string): TopicMeta | null {
  const row = db().prepare("SELECT * FROM topics WHERE id = ?").get(id) as TopicRow | undefined;
  return row ? toTopicMeta(row) : null;
}

/** Label -> slug ("Design & Art" -> "design-art"), deduplicated with -2, -3… */
function topicSlug(label: string): string {
  const base = label.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "") || "topic";
  let id = base;
  for (let n = 2; db().prepare("SELECT 1 FROM topics WHERE id = ?").get(id); n++) id = `${base}-${n}`;
  return id;
}

const PALETTE = ["#3b82f6", "#8b5cf6", "#ec4899", "#10b981", "#06b6d4", "#f97316", "#14b8a6", "#22c55e", "#a855f7", "#ef4444", "#b45309", "#6366f1", "#0ea5e9", "#eab308", "#84cc16", "#f43f5e", "#facc15", "#78716c", "#64748b", "#a1a1aa"];

/** Pick a palette color the existing topics use least, so a new category reads distinctly. */
function defaultColor(): string {
  const used = new Map<string, number>();
  for (const r of db().prepare("SELECT color FROM topics").all() as { color: string }[]) used.set(r.color, (used.get(r.color) ?? 0) + 1);
  let best = PALETTE[0];
  let bestN = Infinity;
  for (const c of PALETTE) {
    const n = used.get(c) ?? 0;
    if (n < bestN) {
      best = c;
      bestN = n;
    }
  }
  return best;
}

export class TopicError extends Error {}

export function createTopic({ label, color, description }: { label: string; color?: string; description?: string }): TopicMeta {
  const clean = label.trim().slice(0, 60);
  if (!clean) throw new TopicError("Categories need a name");
  const id = topicSlug(clean);
  const position = (db().prepare("SELECT COALESCE(MAX(position), 0) + 1 AS p FROM topics").get() as { p: number }).p;
  db()
    .prepare("INSERT INTO topics (id, label, color, description, position, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, clean, color ?? defaultColor(), (description ?? "").trim().slice(0, 300), position, Date.now());
  return getTopic(id)!;
}

export function updateTopic(id: string, patch: { label?: string; color?: string; description?: string }): TopicMeta | null {
  if (!getTopic(id)) return null;
  const cols: Record<string, string> = {};
  if (patch.label !== undefined) {
    const clean = patch.label.trim().slice(0, 60);
    if (!clean) throw new TopicError("Categories need a name");
    cols.label = clean;
  }
  if (patch.color !== undefined) cols.color = /^#[0-9a-fA-F]{3,8}$/.test(patch.color) ? patch.color : (getTopic(id)!.color);
  if (patch.description !== undefined) cols.description = patch.description.trim().slice(0, 300);
  const names = Object.keys(cols);
  if (names.length) {
    db()
      .prepare(`UPDATE topics SET ${names.map((n) => `${n} = @${n}`).join(", ")} WHERE id = @id`)
      .run({ ...cols, id });
  }
  return getTopic(id);
}

/**
 * Removes a topic and re-files its dumps under 'other', unlocking them so a re-sort can
 * file them again — a manual filing pointed at a category that no longer exists.
 * The 'other' catch-all itself can't be deleted.
 */
export function deleteTopic(id: string): { id: string; moved: number } | null {
  if (id === "other") throw new TopicError("The catch-all category can't be deleted");
  if (!getTopic(id)) return null;
  const moved = db().transaction(() => {
    const r = db().prepare("UPDATE dumps SET topic = 'other', topic_locked = 0, updated_at = ? WHERE topic = ?").run(Date.now(), id);
    db().prepare("DELETE FROM topics WHERE id = ?").run(id);
    return r.changes;
  })();
  return { id, moved };
}

/**
 * Ids of X dumps whose render predates the current output (missing, or a
 * pre-hash filename) — re-enriched once per process on feed load so older
 * saves pick up the current render shape without a manual reprocess.
 * Matches on the URL as well as the provider column: saves predating that
 * column carry NULL there even though they're X posts.
 */
export function staleXRenderIds(): { id: string; status: Status }[] {
  return db()
    // Rows mid-enrich are skipped on purpose: the running enrich produces the
    // current render shape, and parking them would restore 'processing' after
    // it finishes — a row stuck in processing keeps the feed polling.
    .prepare(`SELECT id, status FROM dumps WHERE url IS NOT NULL AND status != 'processing'
              AND (provider = 'x' OR url LIKE '%x.com/%' OR url LIKE '%twitter.com/%')
              AND (x_render IS NULL OR x_render NOT LIKE '%-light-________.png%')
              -- Media posts show the media itself and get no render by design.
              AND image_urls IS NULL AND image_url IS NULL AND video_url IS NULL`)
    .all() as { id: string; status: Status }[];
}
