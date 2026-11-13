import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dump-enrich-"));
process.env.DUMP_DATA_DIR = dir;

const extractUrl = vi.fn();
vi.mock("../extract", () => ({ extractUrl: (url: string) => extractUrl(url) }));
const classifyWithAi = vi.fn();
const identifySubject = vi.fn();
vi.mock("../llm", () => ({
  classifyWithAi: (input: unknown) => classifyWithAi(input),
  identifySubject: (input: unknown) => identifySubject(input),
}));

const db = await import("../db");
const { enrichDump, resortAll } = await import("../enrich");

const page = (over: Record<string, unknown> = {}) => ({
  kind: "article",
  title: "Easy weeknight pasta recipe",
  description: "Dinner in 20 minutes with garlic and parmesan",
  content: null,
  imageUrl: null,
  siteName: "Example",
  author: null,
  unreachable: false,
  ...over,
});

const severance = (over: Record<string, unknown> = {}) => ({
  type: "show",
  name: "Severance",
  year: 2022,
  creator: "Dan Erickson",
  genre: "sci-fi thriller",
  description: "A clip of Mark and Helly in the elevator scene from the Apple TV+ series.",
  confidence: 0.99,
  model: "openai/gpt-6-luna-x",
  ...over,
});

describe("enrichDump", () => {
  beforeEach(() => {
    extractUrl.mockReset();
    classifyWithAi.mockReset().mockResolvedValue(null);
    identifySubject.mockReset().mockResolvedValue(null);
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("keeps a topic the user picked while enrichment was running", async () => {
    const d = db.createDump({ kind: "link", url: "https://example.com/pasta", domain: "example.com" });
    extractUrl.mockImplementation(async () => {
      db.updateDump(d.id, { topic: "travel", topicLocked: true, classifiedBy: "you" });
      return page();
    });
    const out = await enrichDump(d.id);
    expect(out).toMatchObject({ topic: "travel", classifiedBy: "you", status: "ready", title: "Easy weeknight pasta recipe" });
  });

  it("marks unreachable links failed (retryable) but still files them", async () => {
    const d = db.createDump({ kind: "link", url: "https://example.com/spinach-and-feta-pasta-recipe", domain: "example.com" });
    extractUrl.mockResolvedValue(page({ title: null, description: null, siteName: "example.com", unreachable: true }));
    const out = await enrichDump(d.id);
    expect(out).toMatchObject({ status: "failed", topic: "food", title: null });
  });

  it("replaces the fallback title once a retry reaches the site", async () => {
    const d = db.createDump({ kind: "link", url: "https://example.com/easy-weeknight-pasta", domain: "example.com" });
    extractUrl.mockResolvedValueOnce(page({ title: null, unreachable: true }));
    expect(await enrichDump(d.id)).toMatchObject({ status: "failed", title: null });
    extractUrl.mockResolvedValueOnce(page({ title: "The Best Weeknight Pasta" }));
    expect(await enrichDump(d.id)).toMatchObject({ status: "ready", title: "The Best Weeknight Pasta" });
  });

  it("keeps a title the user supplied, even one matching the URL slug", async () => {
    const d = db.createDump({ kind: "link", url: "https://example.com/easy-pasta", domain: "example.com", title: "Easy pasta" });
    extractUrl.mockResolvedValueOnce(page());
    expect(await enrichDump(d.id)).toMatchObject({ title: "Easy pasta" });
  });

  it("keeps a title the user supplied", async () => {
    const d = db.createDump({ kind: "link", url: "https://example.com/p/123", domain: "example.com", title: "My pasta bookmark" });
    extractUrl.mockResolvedValueOnce(page());
    expect(await enrichDump(d.id)).toMatchObject({ title: "My pasta bookmark" });
  });

  it("lets a reprocess pick up a page title when the first fetch had none", async () => {
    const d = db.createDump({ kind: "link", url: "https://example.com/quick-garlic-noodles", domain: "example.com" });
    extractUrl.mockResolvedValueOnce(page({ title: null, description: null }));
    expect(await enrichDump(d.id)).toMatchObject({ status: "ready", title: null, content: "Quick garlic noodles" });
    expect(db.listDumps({ q: "garlic noodles" }).map((x) => x.id)).toContain(d.id);
    extractUrl.mockResolvedValueOnce(page({ title: "Garlic Noodles in 10 Minutes" }));
    expect(await enrichDump(d.id)).toMatchObject({ title: "Garlic Noodles in 10 Minutes" });
  });

  it("keeps URL-derived title words searchable when the page has text but no title", async () => {
    const d = db.createDump({ kind: "link", url: "https://example.com/smoky-chipotle-tacos", domain: "example.com" });
    extractUrl.mockResolvedValueOnce(page({ title: null, content: "Some body text about dinner ideas for the week" }));
    await enrichDump(d.id);
    expect(db.listDumps({ q: "chipotle tacos" }).map((x) => x.id)).toContain(d.id);
    expect(db.listDumps({ q: "dinner ideas" }).map((x) => x.id)).toContain(d.id);
  });

  it("takes the topic from the AI and the tags from the rules", async () => {
    const d = db.createDump({ kind: "link", url: "https://example.com/p", domain: "example.com" });
    extractUrl.mockResolvedValueOnce(page());
    classifyWithAi.mockResolvedValueOnce({ topic: "health", confidence: 0.9, model: "jev" });
    const out = await enrichDump(d.id);
    expect(out).toMatchObject({ topic: "health", classifiedBy: "ai", status: "ready" });
    expect(out?.tags.length).toBeGreaterThan(0);
  });

  it("names a confident clip's subject, keeps it searchable, and feeds it to the AI", async () => {
    const d = db.createDump({ kind: "video", url: "https://www.tiktok.com/@fan/video/1", domain: "tiktok.com" });
    extractUrl.mockResolvedValueOnce(
      page({
        kind: "video",
        title: null,
        description: "mark and helly in the elevator scene still haunts me #lumon #appletv",
        content: null,
        siteName: "TikTok",
        unreachable: true,
      }),
    );
    identifySubject.mockResolvedValueOnce(severance());
    classifyWithAi.mockResolvedValueOnce({ topic: "film", confidence: 0.95, model: "jev" });

    const out = await enrichDump(d.id);
    expect(identifySubject).toHaveBeenCalledOnce();
    expect(out).toMatchObject({
      status: "failed",
      title: "Severance",
      summary: "A clip of Mark and Helly in the elevator scene from the Apple TV+ series.",
      subject: { type: "show", name: "Severance", year: 2022 },
      topic: "film",
    });
    // The subject goes into Jev's state, its description feeds the rules, and it's searchable.
    expect(classifyWithAi.mock.calls[0][0]).toMatchObject({
      subject: { name: "Severance" },
      description: expect.stringContaining("elevator scene"),
    });
    expect(db.listDumps({ q: "severance" }).map((x) => x.id)).toContain(d.id);
    expect(db.listDumps({ q: "elevator" }).map((x) => x.id)).toContain(d.id);
  });

  it("identifies Instagram posts too, and keeps an unsure subject off the card", async () => {
    const d = db.createDump({ kind: "post", url: "https://www.instagram.com/p/abc/", domain: "instagram.com" });
    extractUrl.mockResolvedValueOnce(page({ kind: "post", title: null, description: null, siteName: "Instagram", unreachable: true }));
    identifySubject.mockResolvedValueOnce(severance({ confidence: 0.3 }));

    const out = await enrichDump(d.id);
    expect(identifySubject).toHaveBeenCalledOnce();
    // Stored for later, but the card keeps today's look: no invented title or dek.
    expect(out).toMatchObject({ title: null, summary: null, subject: { name: "Severance", confidence: 0.3 } });
    expect(classifyWithAi.mock.calls[0][0]?.subject).toBeNull();
  });

  it("lets the subject's description give an image-only dump its topic and tags", async () => {
    const d = db.createDump({ kind: "image", title: "Image", imageUrl: "/api/files/x.jpg" });
    identifySubject.mockResolvedValueOnce(
      severance({ type: "food", name: "Miso ramen", year: null, creator: null, description: "A bowl of miso ramen with egg, scallions and noodles.", confidence: 0.9 }),
    );

    const out = await enrichDump(d.id);
    expect(out).toMatchObject({ kind: "image", title: "Miso ramen", topic: "food" });
    expect(out?.tags.length).toBeGreaterThan(0);
  });

  it("queues a second run instead of letting a stale snapshot overwrite new metadata", async () => {
    const d = db.createDump({ kind: "link", url: "https://example.com/clip", domain: "example.com" });
    let resolveFirst!: (v: unknown) => void;
    extractUrl.mockImplementationOnce(() => new Promise((r) => (resolveFirst = r)));
    extractUrl.mockResolvedValueOnce(page({ title: null, description: null, unreachable: true }));
    const first = enrichDump(d.id);
    // A duplicate lands mid-enrich, backfilling the metadata the first fetch never saw.
    db.updateDump(d.id, { title: "A reel", description: "client og caption", imageUrl: "https://cdn.example.com/t.jpg", status: "processing" });
    const second = enrichDump(d.id);
    await new Promise((r) => setTimeout(r, 0)); // let the first run reach its fetch
    resolveFirst(page({ title: null, description: null }));
    const [a, b] = await Promise.all([first, second]);
    expect(extractUrl).toHaveBeenCalledTimes(2);
    // The stale first run can't erase what the duplicate saved; the queued run re-reads and keeps it.
    expect(a).toMatchObject({ description: "client og caption" });
    expect(b).toMatchObject({ title: "A reel", description: "client og caption", imageUrl: "https://cdn.example.com/t.jpg" });
    expect(db.getDump(d.id)).toMatchObject({ title: "A reel", description: "client og caption", imageUrl: "https://cdn.example.com/t.jpg" });
  });

  it("doesn't identify plain articles or notes", async () => {
    const d = db.createDump({ kind: "link", url: "https://example.com/p", domain: "example.com" });
    extractUrl.mockResolvedValueOnce(page());
    await enrichDump(d.id);
    expect(identifySubject).not.toHaveBeenCalled();

    const n = db.createDump({ kind: "note", content: "remember the milk" });
    await enrichDump(n.id);
    expect(identifySubject).not.toHaveBeenCalled();
  });
});

describe("resortAll", () => {
  beforeEach(() => classifyWithAi.mockReset());

  it("re-files dumps with the AI, leaving hand-filed ones alone", async () => {
    for (const d of db.listDumps({ limit: 1000 })) db.deleteDump(d.id);
    const auto = db.createDump({ kind: "note", content: "watched a great film last night" });
    db.updateDump(auto.id, { status: "ready", topic: "other", classifiedBy: "rules" });
    const mine = db.createDump({ kind: "note", content: "pasta" });
    db.updateDump(mine.id, { status: "ready", topic: "travel", topicLocked: true, classifiedBy: "you" });
    classifyWithAi.mockResolvedValue({ topic: "film", confidence: 1, model: "jev" });

    expect(await resortAll()).toEqual({ sorted: 1, moved: 1, failed: 0 });
    expect(db.getDump(auto.id)).toMatchObject({ topic: "film", classifiedBy: "ai" });
    expect(db.getDump(mine.id)).toMatchObject({ topic: "travel", classifiedBy: "you" });
  });

  it("keeps the current topic when the AI can't answer", async () => {
    for (const d of db.listDumps({ limit: 1000 })) db.deleteDump(d.id);
    const d = db.createDump({ kind: "note", content: "hello" });
    db.updateDump(d.id, { status: "ready", topic: "fun", classifiedBy: "rules" });
    classifyWithAi.mockResolvedValue(null);
    expect(await resortAll()).toEqual({ sorted: 0, moved: 0, failed: 1 });
    expect(db.getDump(d.id)).toMatchObject({ topic: "fun", classifiedBy: "rules" });
  });
});
