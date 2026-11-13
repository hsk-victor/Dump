import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dump-enrich-"));
process.env.DUMP_DATA_DIR = dir;

const extractUrl = vi.fn();
vi.mock("../extract", () => ({ extractUrl: (url: string) => extractUrl(url) }));
vi.mock("../llm", () => ({ classifyWithAi: async () => null }));

const db = await import("../db");
const { enrichDump } = await import("../enrich");

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

describe("enrichDump", () => {
  beforeEach(() => extractUrl.mockReset());
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
});
