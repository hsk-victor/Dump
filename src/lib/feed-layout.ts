import type { Dump } from "./db";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type FeedItem = Pick<Dump, "id" | "kind">;
type FeedMetrics = { width: number; gap: number; columns: number; fullWidthNotes: boolean; estimate: number };
type FeedDrag = { id: string; j: number | null; h: number };

export function packFeed(
  items: readonly FeedItem[],
  heights: ReadonlyMap<string, number>,
  { width, gap, columns, fullWidthNotes, estimate }: FeedMetrics,
  drag: FeedDrag | null,
) {
  const columnWidth = (width - gap * (columns - 1)) / columns;
  const columnEnds = new Array<number>(columns).fill(0);
  const slots = new Map<string, Rect>();
  let ghost: Rect | null = null;

  const place = (kind: FeedItem["kind"] | undefined, h: number): Rect => {
    if (fullWidthNotes && kind === "note") {
      const y = Math.max(...columnEnds);
      columnEnds.fill(y + h + gap);
      return { x: 0, y, w: width, h };
    }
    let column = 0;
    for (let i = 1; i < columns; i++) if (columnEnds[i] < columnEnds[column]) column = i;
    const y = columnEnds[column];
    columnEnds[column] = y + h + gap;
    return { x: column * (columnWidth + gap), y, w: columnWidth, h };
  };

  const list = drag ? items.filter(({ id }) => id !== drag.id) : items;
  for (let i = 0; i <= list.length; i++) {
    if (drag?.j === i) ghost = place(items.find(({ id }) => id === drag.id)?.kind, drag.h);
    if (i < list.length) {
      const { id, kind } = list[i];
      slots.set(id, place(kind, heights.get(id) ?? estimate));
    }
  }
  return { slots, ghost, height: Math.max(0, Math.max(...columnEnds) - gap) };
}
