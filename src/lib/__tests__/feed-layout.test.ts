import { expect, it } from "vitest";
import { feedColumns, packFeed } from "../feed-layout";

const items = [
  { id: "link-a", kind: "link" },
  { id: "image", kind: "image" },
  { id: "note", kind: "note" },
  { id: "link-b", kind: "link" },
  { id: "video", kind: "video" },
] as const;
const heights = new Map([["link-a", 80], ["image", 100], ["note", 140]]);
const metrics = { width: 366, gap: 6, columns: 2, estimate: 50, fullWidthNotes: true };

it("puts narrow notes below every preceding column, then resumes two-column packing", () => {
  const { slots, height } = packFeed(items, heights, metrics, null);

  expect([...slots.values()]).toEqual([
    { x: 0, y: 0, w: 180, h: 80 },
    { x: 186, y: 0, w: 180, h: 100 },
    { x: 0, y: 106, w: 366, h: 140 },
    { x: 0, y: 252, w: 180, h: 50 },
    { x: 186, y: 252, w: 180, h: 50 },
  ]);
  expect(height).toBe(302);
});

it("keeps notes in a single masonry column outside the narrow layout", () => {
  const { slots } = packFeed(items, heights, { ...metrics, fullWidthNotes: false }, null);

  expect(slots.get("note")).toEqual({ x: 0, y: 86, w: 180, h: 140 });
  expect(slots.get("link-b")).toEqual({ x: 186, y: 106, w: 180, h: 50 });
});

it("reserves a full-width landing slot for a dragged narrow note", () => {
  const { slots, ghost } = packFeed(items, heights, metrics, { id: "note", j: 1, h: 140 });

  expect(ghost).toEqual({ x: 0, y: 86, w: 366, h: 140 });
  expect(slots.has("note")).toBe(false);
  expect(slots.get("image")).toEqual({ x: 0, y: 232, w: 180, h: 100 });
});

it.each([200, 260, 440])("packs a single 358px lane at saved density %i", (density) => {
  const phone = { ...metrics, width: 358, gap: 12, columns: feedColumns(true, 358, density, 12) };
  const { slots, ghost } = packFeed(items, heights, phone, { id: "note", j: 2, h: 140 });

  expect([...slots.values()].every(({ x, w }) => x === 0 && w === 358)).toBe(true);
  expect(ghost).toEqual({ x: 0, y: 204, w: 358, h: 140 });
  expect(slots.get("link-b")?.y).toBe(356);
});

it("keeps the desktop density calculation above the phone breakpoint", () => {
  expect(feedColumns(false, 1145, 260, 6)).toBe(4);
  expect(feedColumns(false, 1145, 440, 6)).toBe(2);
});
