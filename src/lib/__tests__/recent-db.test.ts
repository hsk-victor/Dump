import { afterAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dump-recent-"));
process.env.DUMP_DATA_DIR = dir;
const db = await import("../db");
const { GET } = await import("@/app/api/dumps/recent/route");

afterAll(() => {
  vi.useRealTimers();
  (globalThis as { __dumpDb?: { close(): void } }).__dumpDb?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("recent saves", () => {
  it("returns an empty list before the first save", async () => {
    expect(await (await GET()).json()).toEqual({ items: [] });
  });
  it("orders by capture time, ignores pins/manual order and updates, and re-dumps without duplicates", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const old = db.createDump({ kind: "link", url: "https://example.com", title: "R&D" });
    vi.setSystemTime(2000);
    db.createDump({ kind: "note", title: "Private note title", content: "Private note body" });
    vi.setSystemTime(3000);
    const third = db.createDump({ kind: "file", attachment: { name: "report.pdf", url: "/file", type: "application/pdf", size: 1 } });
    vi.setSystemTime(4000);
    const fourth = db.createDump({ kind: "image" });
    db.updateDump(old.id, { pinned: true, position: 10000 });
    const response = await (await GET()).json();
    expect(response.items.map((x: { label: string }) => x.label)).toEqual(["Image", "report.pdf", "Note"]);
    expect(JSON.stringify(response)).not.toContain("Private");
    vi.setSystemTime(5000);
    db.bumpDump(old.id);
    expect((await (await GET()).json()).items).toEqual([{ id: old.id, label: "RD" }, { id: fourth.id, label: "Image" }, { id: third.id, label: "report.pdf" }]);
  });
});
