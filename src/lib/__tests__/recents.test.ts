import { describe, expect, it } from "vitest";
import { recentLabel, type RecentSource } from "../recents";

const item: RecentSource = { id: "1", kind: "link", title: null, filename: null, domain: null };

describe("recent labels", () => {
  it("uses title, filename, then domain, without menu mnemonics or controls", () => {
    expect(recentLabel({ ...item, title: "  R&D\t\nGuide\u202e  " })).toBe("RDGuide");
    expect(recentLabel({ ...item, title: "&\n", filename: "report.pdf", domain: "example.com" })).toBe("report.pdf");
    expect(recentLabel({ ...item, domain: "example.com" })).toBe("example.com");
  });
  it("never exposes a note's generated title or body, and falls back safely", () => {
    expect(recentLabel({ ...item, kind: "note", title: "Private first line" })).toBe("Note");
    expect(recentLabel({ ...item, kind: "image" })).toBe("Image");
    expect(recentLabel({ ...item, kind: "file" })).toBe("File");
    expect(recentLabel(item)).toBe("File");
  });
  it("bounds Unicode labels to 48 characters without splitting a surrogate pair", () => {
    expect(Array.from(recentLabel({ ...item, title: "🎉".repeat(60) }))).toHaveLength(48);
    expect(recentLabel({ ...item, title: "a".repeat(48) })).toHaveLength(48);
  });
});
