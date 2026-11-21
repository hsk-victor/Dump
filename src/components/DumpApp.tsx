"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Toaster, toast as sonnerToast } from "sonner";
import { Menu } from "@base-ui/react/menu";
import type { Dump } from "@/lib/db";
import { feedColumns, packFeed, PHONE_QUERY, type Rect } from "@/lib/feed-layout";
import { KINDS, kindMeta, topicMeta, TOPICS, type TopicMeta } from "@/lib/taxonomy";
import { DENSITY_KEY, MODE_KEY } from "@/lib/theme";
import Composer from "./Composer";
import DumpCard from "./DumpCard";
import Logo from "./Logo";
import SectionNav, { type Counts } from "./SectionNav";
import CategoryManager from "./CategoryManager";
import { PhoneMenu, PhoneMenuRoot } from "./PhoneMenu";

const PAGE_SIZE = 60;
/** Matches the server's per-request cap on /api/dumps. */
const LIMIT_CAP = 500;
/** Card height guess before its first measurement, plus the 6px --gap between cards. */
const ESTIMATE_H = 260;
const GAP_EST = 6;
/** Pointer must travel this far before a press on the grip becomes a drag. */
const DRAG_THRESHOLD = 6;
/** Hold a card this long without moving to lift it into a drag (iOS-style). */
const HOLD_MS = 240;
/** Targets inside a card that never arm a hold-drag — buttons, inputs, media. */
const HOLD_EXCLUDE = "button, input, textarea, select, summary, video, audio, iframe, [contenteditable], [role='menu'], [role='dialog'], [role='listbox'], .d-actions, .d-menu";
/** Viewport margin that starts auto-scrolling while a card is held. */
const EDGE_PX = 72;
/** How far past the grid the pointer may go before the drop is cancelled. */
const SLOT_SLOP = 48;
/** Re-aiming the landing slot needs the pointer to move this far — damps flip-flop. */
const SLOT_HYSTERESIS = 8;
/** Attached non-passively while a touch drag is live: blocks the scroll steal. */
const blockTouchMove = (e: TouchEvent) => e.preventDefault();

function subscribePhone(notify: () => void) {
  const media = window.matchMedia(PHONE_QUERY);
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
}

interface PendingDrag {
  id: string;
  pointerId: number;
  /** Pointerdown position — threshold anchor. */
  x: number;
  y: number;
  /** Latest pointer position — the drag lifts from here. */
  lx: number;
  ly: number;
  timer: number;
  /** Element the pointer gets captured to (grip, or the card's .d-item). */
  cap: HTMLElement;
  /** Hold mode arms by timer (card body); move mode arms by slop (grip). */
  hold: boolean;
}

interface DragState {
  id: string;
  pointerId: number;
  /** The .d-item element tracking the pointer. */
  el: HTMLElement;
  /** Grab offset inside the card, so it stays under the pointer 1:1. */
  grabX: number;
  grabY: number;
  /** Card size at grab time; reserves its landing slot while it flies. */
  w: number;
  h: number;
  /** Landing index in the dragged-card-removed order; null = drop cancels. */
  j: number | null;
  /** Pointer coords where j last changed (hysteresis anchor). */
  jx: number;
  jy: number;
  /** Latest pointer client coords. */
  px: number;
  py: number;
  raf: number;
}

/** One card in the feed; the grid positions it absolutely via transform. */
function FeedItem({
  dump,
  fresh,
  removing,
  sortable,
  dragging,
  onGripDown,
  onItemDown,
  onItemClickCapture,
  onNudge,
  ...handlers
}: {
  dump: Dump;
  phone: boolean;
  fresh: boolean;
  removing: boolean;
  sortable: boolean;
  dragging: boolean;
  onGripDown: (e: ReactPointerEvent<HTMLButtonElement>, id: string) => void;
  onItemDown: (e: ReactPointerEvent<HTMLDivElement>, id: string) => void;
  onItemClickCapture: (e: ReactMouseEvent<HTMLDivElement>) => void;
  onNudge: (id: string, delta: -1 | 1) => void;
  onTopic: (id: string, topic: string) => void;
  onDelete: (id: string) => void;
  onRetry: (id: string) => void;
  onPin: (id: string, pinned: boolean) => void;
  onSaveNote: (id: string, content: string) => Promise<boolean>;
  topics: TopicMeta[];
}) {
  return (
    <div
      className="d-item"
      data-did={dump.id}
      data-dragging={dragging ? "" : undefined}
      onPointerDown={sortable ? (e) => onItemDown(e, dump.id) : undefined}
      onClickCapture={onItemClickCapture}
    >
      <DumpCard
        dump={dump}
        fresh={fresh}
        removing={removing}
        drag={sortable ? { onPointerDown: (e) => onGripDown(e, dump.id) } : undefined}
        reorder={sortable ? { earlier: () => onNudge(dump.id, -1), later: () => onNudge(dump.id, 1) } : undefined}
        {...handlers}
      />
    </div>
  );
}

export default function DumpApp() {
  const phone = useSyncExternalStore(subscribePhone, () => window.matchMedia(PHONE_QUERY).matches, () => false);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const q = params.get("q") ?? "";
  const kind = params.get("kind");
  const topic = params.get("topic");

  const [items, setItems] = useState<Dump[]>([]);
  const [counts, setCounts] = useState<Counts>({ total: 0, kinds: {}, topics: {} });
  const [topics, setTopics] = useState<TopicMeta[]>(() => [...TOPICS]);
  const [catsOpen, setCatsOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState(q);
  const [hasMore, setHasMore] = useState(false);
  const [freshId, setFreshId] = useState<string | null>(null);
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());
  const lastSyncedQ = useRef(q);
  const [aiOn, setAiOn] = useState(false);
  const [resorting, setResorting] = useState(false);
  const pendingToasts = useRef(new Set<string>());
  const searchRef = useRef<HTMLInputElement>(null);
  const bookmarklet = useRef<HTMLAnchorElement>(null);
  const [density, setDensity] = useState(260);
  const [dark, setDark] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const cardHeights = useRef(new Map<string, number>());
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const topicsRef = useRef(topics);
  topicsRef.current = topics;
  const dragRef = useRef<DragState | null>(null);
  const pendingRef = useRef<PendingDrag | null>(null);
  /** Set by the click that trails a real drag — eats it so it can't edit/navigate. */
  const suppressClickRef = useRef(false);
  /** Latest packed slot per card (grid coords), plus the phantom slot while dragging. */
  const slotRects = useRef(new Map<string, Rect>());
  const ghostRect = useRef<Rect | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  // Manual order only makes sense under position sort — a search ranks by relevance instead.
  const sortable = !q;

  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(DENSITY_KEY));
      if (saved) setDensity(saved);
    } catch {}
    setDark(document.documentElement.dataset.mode === "dark");
    // React refuses javascript: hrefs in JSX, so set it directly. Sends the page's og:description
    // and og:image too — a logged-in Instagram/TikTok tab sees a caption and thumbnail the server can't fetch.
    const setBookmarklet = (key: string | null) => {
      const code = `javascript:(()=>{const m=n=>{const e=document.querySelector('meta[property="'+n+'"],meta[name="'+n+'"]');return e?e.content:''};const u=v=>{try{return v?new URL(v,location.href).href:''}catch(x){return''}};window.open('${window.location.origin}/dump?${key ? `k=${key}&` : ""}url='+encodeURIComponent(location.href)+'&title='+encodeURIComponent(document.title)+'&desc='+encodeURIComponent(m('og:description')||m('twitter:description')||m('description'))+'&img='+encodeURIComponent(u(m('og:image')||m('twitter:image'))),'dump','width=360,height=220')})()`;
      bookmarklet.current?.setAttribute("href", code);
    };
    // The desktop app needs a key in the bookmarklet (src/lib/desktop-token.ts); elsewhere it's null.
    fetch("/api/bookmarklet")
      .then((r) => (r.ok ? r.json() : { key: null }))
      .then((d: { key: string | null }) => setBookmarklet(d.key))
      .catch(() => setBookmarklet(null));
  }, []);

  useEffect(() => {
    if (!settingsOpen) return;
    const close = (e: MouseEvent) => {
      if (!settingsRef.current?.contains(e.target as Node)) setSettingsOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSettingsOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [settingsOpen]);

  function toggleDark() {
    const mode = dark ? "light" : "dark";
    setDark(!dark);
    document.documentElement.dataset.mode = mode;
    try {
      localStorage.setItem(MODE_KEY, mode);
    } catch {}
  }

  function changeDensity(px: number) {
    setDensity(px);
    try {
      localStorage.setItem(DENSITY_KEY, String(px));
    } catch {}
    document.documentElement.style.setProperty("--col-w", `${px}px`);
  }

  const toast = useCallback((text: string, tone: "info" | "error" = "info") => {
    if (tone === "error") sonnerToast.error(text);
    else sonnerToast(text);
  }, []);

  const setFilter = useCallback(
    (next: { q?: string | null; kind?: string | null; topic?: string | null }) => {
      const sp = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(next)) {
        if (v === undefined) continue;
        if (v) sp.set(k, v);
        else sp.delete(k);
      }
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  const load = useCallback(async () => {
    const page = (offset: number, limit: number) => {
      const sp = new URLSearchParams();
      if (q) sp.set("q", q);
      if (kind) sp.set("kind", kind);
      if (topic) sp.set("topic", topic);
      sp.set("offset", String(offset));
      sp.set("limit", String(limit));
      return fetch(`/api/dumps?${sp}`, { cache: "no-store" });
    };
    // Revalidate the whole loaded window in cap-sized pages — a merge past the cap
    // can't tell a displaced card from a deleted one, so every loaded position is
    // refetched and the list replaced outright.
    const want = Math.max(itemsRef.current.length, PAGE_SIZE);
    const rows: Dump[] = [];
    let resp: { items: Dump[]; hasMore: boolean; counts?: Counts; topics?: TopicMeta[]; ai: boolean } | undefined;
    let newCounts: Counts | undefined; // only the offset=0 page carries counts
    let newTopics: TopicMeta[] | undefined;
    for (let offset = 0; offset < want; offset += LIMIT_CAP) {
      const res = await page(offset, Math.min(want - offset, LIMIT_CAP));
      if (!res.ok) return;
      resp = (await res.json()) as { items: Dump[]; hasMore: boolean; counts?: Counts; topics?: TopicMeta[]; ai: boolean };
      rows.push(...resp.items);
      newCounts ??= resp.counts;
      newTopics ??= resp.topics;
      if (!resp.hasMore) break;
    }
    const seen = new Set<string>();
    setItems(rows.filter((d) => !seen.has(d.id) && !!seen.add(d.id)));
    setAiOn(resp!.ai);
    setHasMore(resp!.hasMore);
    if (newCounts) setCounts(newCounts);
    if (newTopics) setTopics(newTopics);
    setLoaded(true);

    for (const d of rows) {
      if (pendingToasts.current.has(d.id) && d.status !== "processing") {
        pendingToasts.current.delete(d.id);
        if (d.status === "failed")
          toast("Couldn't fetch that link. Saved it anyway.", "error");
        else toast(`Filed under ${topicMeta(d.topic, topicsRef.current).label} · ${kindMeta(d.kind).singular}`);
      }
    }
  }, [q, kind, topic, toast]);

  // "Load more" fetches just the next page after what's shown and appends it —
  // growing `limit` and refetching the window from offset 0 scaled badly.
  const loadMore = useCallback(async () => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (kind) sp.set("kind", kind);
    if (topic) sp.set("topic", topic);
    sp.set("offset", String(itemsRef.current.length));
    sp.set("limit", String(PAGE_SIZE));
    const res = await fetch(`/api/dumps?${sp}`, { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { items: Dump[]; hasMore: boolean };
    setItems((prev) => {
      const seen = new Set(prev.map((d) => d.id));
      return [...prev, ...data.items.filter((d) => !seen.has(d.id))];
    });
    setHasMore(data.hasMore);
  }, [q, kind, topic]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    const refresh = () => { void load(); };
    window.addEventListener("dump-updated", refresh);
    return () => window.removeEventListener("dump-updated", refresh);
  }, [load]);

  // If the URL's search changes from outside (Back/Forward, a link), show it in the box.
  useEffect(() => {
    if (q === lastSyncedQ.current) return;
    lastSyncedQ.current = q;
    setSearch(q);
  }, [q]);

  // Debounced search-as-you-type, kept in the URL so searches are shareable/bookmarkable.
  useEffect(() => {
    const next = search.trim();
    if (next === q) return;
    const t = setTimeout(() => {
      lastSyncedQ.current = next;
      setFilter({ q: next || null });
    }, 200);
    return () => clearTimeout(t);
  }, [search, q, setFilter]);

  // Poll while anything is still being sorted in the background. Pause mid-drag so the
  // list doesn't re-render under the pointer.
  const anyProcessing = items.some((d) => d.status === "processing" || d.videoCopy?.state === "pending") || pendingToasts.current.size > 0;
  useEffect(() => {
    if (!anyProcessing || dragId) return;
    const t = setInterval(load, 1200);
    return () => clearInterval(t);
  }, [anyProcessing, dragId, load]);

  // Greedily packs the flat order into columns by measured height and writes each
  // card's slot as a transform — positions are layout data, so React never re-renders
  // to move a card. While dragging, a phantom of the grabbed card's size reserves
  // its landing slot and siblings FLIP around it via their transform transition.
  const applyLayout = useCallback(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const cs = getComputedStyle(grid);
    const gap = parseFloat(cs.columnGap) || GAP_EST;
    const width = grid.clientWidth;
    const minWidth = parseFloat(cs.columnWidth) || 260;
    const columns = feedColumns(window.matchMedia(PHONE_QUERY).matches, width, minWidth, gap);
    const fullWidthNotes = cs.getPropertyValue("--full-width-notes").trim() === "1";
    const d = dragRef.current;
    const { slots, ghost, height } = packFeed(
      itemsRef.current, cardHeights.current, { width, gap, columns, fullWidthNotes, estimate: ESTIMATE_H }, d,
    );
    slotRects.current = slots;
    ghostRect.current = ghost;
    grid.style.height = `${height}px`;
    for (const node of grid.querySelectorAll<HTMLElement>(".d-item")) {
      const id = node.dataset.did!;
      if (d && id === d.id) continue;
      const r = slots.get(id);
      if (!r) continue;
      node.style.width = `${r.w}px`;
      node.style.transform = `translate3d(${r.x}px, ${r.y}px, 0)`;
    }
  }, []);

  // Re-pack on every commit (new items, reorder, drag begin/end) before paint.
  useLayoutEffect(() => {
    applyLayout();
  }, [items, dragId, applyLayout]);

  const hasItems = items.length > 0;
  // Re-pack when the container width, narrow layout, or card-size preference changes.
  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    let previous = "";
    const compute = () => {
      const cs = getComputedStyle(el);
      const key = `${el.clientWidth}|${cs.columnWidth}|${cs.columnGap}|${cs.getPropertyValue("--full-width-notes")}`;
      if (key === previous) return;
      previous = key;
      applyLayout();
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [density, loaded, hasItems, phone, applyLayout]);

  // Measure each rendered card once so the greedy column split can balance heights.
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      let changed = false;
      for (const e of entries) {
        const id = (e.target as HTMLElement).dataset.did;
        if (!id) continue;
        const h = e.borderBoxSize?.[0]?.blockSize ?? e.contentRect.height;
        if (cardHeights.current.get(id) !== h) {
          cardHeights.current.set(id, h);
          changed = true;
        }
      }
      if (changed) applyLayout();
    });
    el.querySelectorAll(".d-item").forEach((n) => ro.observe(n));
    return () => ro.disconnect();
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !el.closest("input, textarea, select"))) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function handleDump({ text, file }: { text: string; file: File | null }) {
    let res: Response;
    try {
      if (file) {
        const form = new FormData();
        form.set("file", file);
        form.set("text", text);
        res = await fetch("/api/dumps", { method: "POST", body: form });
      } else {
        res = await fetch("/api/dumps", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
      }
    } catch {
      toast("Couldn't reach Dump. Your draft is still here.", "error");
      return false;
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast(err.error ?? "Couldn't dump that", "error");
      return false;
    }
    const dump = (await res.json()) as Dump & { duplicate?: boolean };
    if (dump.duplicate) toast(`Already in your dump (${topicMeta(dump.topic, topics).label}). Moved it to the top`);
    else pendingToasts.current.add(dump.id);
    setFreshId(dump.id);
    setTimeout(() => setFreshId(null), 2500);
    // Show it immediately; clear filters so the new dump is visible.
    if (q || kind || topic) {
      setSearch("");
      setFilter({ q: null, kind: null, topic: null });
    } else {
      setItems((prev) => [dump, ...prev.filter((d) => d.id !== dump.id)]);
    }
    return true;
  }

  async function handleTopic(id: string, newTopic: string) {
    setItems((prev) => prev.map((d) => (d.id === id ? { ...d, topic: newTopic as Dump["topic"], classifiedBy: "you" } : d)));
    await fetch(`/api/dumps/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ topic: newTopic }) });
    toast(`Moved to ${topicMeta(newTopic, topics).label}`);
    load();
  }

  async function handleDelete(id: string) {
    setRemovingIds((prev) => new Set(prev).add(id));
    setTimeout(async () => {
      setItems((prev) => prev.filter((d) => d.id !== id));
      setRemovingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      await fetch(`/api/dumps/${id}`, { method: "DELETE" });
      load();
    }, 180);
  }

  async function handlePin(id: string, pinned: boolean) {
    setItems((prev) => prev.map((d) => (d.id === id ? { ...d, pinned } : d)));
    const res = await fetch(`/api/dumps/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ pinned }) });
    if (!res.ok) {
      toast("Couldn't pin that", "error");
      load();
      return;
    }
    toast(pinned ? "Pinned to the top" : "Unpinned");
    load();
  }

  // ── Drag to reorder ──
  // The grabbed card's wrapper (.d-item) follows the pointer via a direct transform
  // write every animation frame; siblings reflow around a phantom slot through their
  // own transform transitions. React state only changes on drag start and settle.

  /** Where the card would land: index into the order with the dragged card removed. */
  function computeSlot(d: DragState, grid: HTMLElement): number | null {
    const r = grid.getBoundingClientRect();
    const px = d.px - r.left;
    const py = d.py - r.top;
    // Cancel when the CARD's box leaves the grid, not when the pointer does —
    // a tall card grabbed near its top needs the pointer well above the grid
    // to aim at slot 0.
    const cx = px - d.grabX + d.w / 2;
    const cy = py - d.grabY + d.h / 2;
    if (px + d.w - d.grabX < -SLOT_SLOP || px - d.grabX > grid.clientWidth + SLOT_SLOP || cy + d.h / 2 < -SLOT_SLOP * 2 || cy - d.h / 2 > grid.clientHeight + SLOT_SLOP * 2)
      return null;
    const g = ghostRect.current;
    if (g && cx >= g.x && cx <= g.x + g.w && cy >= g.y && cy <= g.y + g.h) return d.j;
    const rest = itemsRef.current.filter((x) => x.id !== d.id);
    for (let i = 0; i < rest.length; i++) {
      const rr = slotRects.current.get(rest[i].id);
      if (rr && cx >= rr.x && cx <= rr.x + rr.w && cy >= rr.y && cy <= rr.y + rr.h)
        return cy < rr.y + rr.h / 2 ? i : i + 1;
    }
    // Between columns or below a column's last card: land next to the nearest card.
    let best = -1;
    let bd = Infinity;
    for (let i = 0; i < rest.length; i++) {
      const rr = slotRects.current.get(rest[i].id);
      if (!rr) continue;
      const dx = Math.max(rr.x - cx, 0, cx - (rr.x + rr.w));
      const dy = Math.max(rr.y - cy, 0, cy - (rr.y + rr.h));
      const dd = dx * dx + dy * dy;
      if (dd < bd) {
        bd = dd;
        best = i;
      }
    }
    if (best < 0) return rest.length ? rest.length : 0;
    const rr = slotRects.current.get(rest[best].id)!;
    return cy < rr.y + rr.h / 2 ? best : best + 1;
  }

  function dragTick() {
    const d = dragRef.current;
    const grid = gridRef.current;
    if (!d || !grid) return;
    d.raf = 0;
    // Drift the page while the pointer hugs a viewport edge.
    let scroll = 0;
    if (d.py < EDGE_PX) scroll = -Math.ceil((EDGE_PX - d.py) / 4);
    else if (d.py > window.innerHeight - EDGE_PX) scroll = Math.ceil((d.py - (window.innerHeight - EDGE_PX)) / 4);
    if (scroll) window.scrollBy(0, scroll);
    const r = grid.getBoundingClientRect();
    d.el.style.transform = `translate3d(${d.px - r.left - d.grabX}px, ${d.py - r.top - d.grabY}px, 0)`;
    const j = computeSlot(d, grid);
    // While auto-scrolling the pointer is static but the grid moves under it —
    // re-aim every tick; the hysteresis (a pointer-distance guard) doesn't apply.
    if (j !== d.j && (scroll !== 0 || Math.hypot(d.px - d.jx, d.py - d.jy) >= SLOT_HYSTERESIS)) {
      d.j = j;
      d.jx = d.px;
      d.jy = d.py;
      applyLayout();
    }
    if (scroll && dragRef.current) d.raf = requestAnimationFrame(dragTick);
  }

  function beginDrag(id: string, pointerId: number, x: number, y: number, cap: HTMLElement) {
    const grid = gridRef.current;
    if (!grid) return;
    const el = grid.querySelector<HTMLElement>(`[data-did="${id}"]`);
    if (!el) return;
    const box = el.getBoundingClientRect();
    try {
      cap.setPointerCapture(pointerId);
    } catch {}
    const idx = itemsRef.current.findIndex((it) => it.id === id);
    dragRef.current = {
      id,
      pointerId,
      el,
      grabX: x - box.left,
      grabY: y - box.top,
      w: box.width,
      h: box.height,
      j: idx,
      jx: x,
      jy: y,
      px: x,
      py: y,
      raf: 0,
    };
    // Once the drag owns a touch gesture, stop the page stealing it as a scroll.
    window.addEventListener("touchmove", blockTouchMove, { passive: false });
    document.body.classList.add("d-dragging");
    setDragId(id);
    applyLayout(); // open the phantom slot at the card's own seat
  }

  function finishDrag(cancelled: boolean) {
    const d = dragRef.current;
    if (!d) return;
    if (d.raf) cancelAnimationFrame(d.raf);
    dragRef.current = null;
    suppressClickRef.current = true; // the click that trails pointerup isn't a click
    window.removeEventListener("touchmove", blockTouchMove);
    document.body.classList.remove("d-dragging");
    setDragId(null); // restores transitions; the card eases into its slot
    const j = cancelled ? null : d.j;
    if (j !== null) moveTo(d.id, j);
  }

  /** Menu reorder (touch/narrow): one step earlier or later, never across the pinned boundary. */
  function nudge(id: string, delta: -1 | 1) {
    const all = itemsRef.current;
    const i = all.findIndex((x) => x.id === id);
    const neighbour = all[i + delta];
    if (i < 0 || !neighbour || neighbour.pinned !== all[i].pinned) return;
    moveTo(id, i + delta);
  }

  /** Lands a card at index `j` of the order with it removed, and saves the new position. */
  function moveTo(id: string, j: number) {
    const all = itemsRef.current;
    const dragged = all.find((x) => x.id === id);
    if (!dragged || j === all.indexOf(dragged)) return;
    const list = all.filter((x) => x.id !== id);
    // Crossing the pinned boundary flips the flag: dragging below every pinned card
    // unpins, dragging an unpinned card into the pinned block pins it.
    const pinnedCount = list.filter((x) => x.pinned).length;
    const pinned = dragged.pinned ? j <= pinnedCount : j < pinnedCount;
    // Each group sorts by position independently, so the slot must be priced
    // against same-group neighbours — a midpoint across the boundary can rank
    // the card above the very card it was dropped below.
    const beforeJ = list.slice(0, j).filter((x) => x.pinned === pinned).length;
    const same = list.filter((x) => x.pinned === pinned);
    const prev = same[beforeJ - 1];
    const next = same[beforeJ];
    const position = prev && next ? (prev.position + next.position) / 2 : prev ? prev.position - 1 : next ? next.position + 1 : 1;
    const moved = { ...dragged, pinned, position };
    setItems([...list.slice(0, j), moved, ...list.slice(j)]);
    fetch(`/api/dumps/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(pinned === dragged.pinned ? { position } : { pinned, position }),
    }).then((res) => {
      if (!res.ok) {
        toast("Couldn't move that card", "error");
        load();
      }
    });
  }

  // Shared arming for both entry points: the grip activates on a 6px move,
  // the card body activates by holding still for HOLD_MS. After activation the
  // same pointer-tracked flight applies either way.
  function armDrag(e: ReactPointerEvent<HTMLElement>, id: string, cap: HTMLElement, hold: boolean) {
    // Second fingers and non-primary buttons never join or restart a drag.
    if (!e.isPrimary || (e.pointerType === "mouse" && e.button !== 0) || pendingRef.current || dragRef.current) return;
    suppressClickRef.current = false;
    const pending: PendingDrag = { id, pointerId: e.pointerId, x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, timer: 0, cap, hold };
    pendingRef.current = pending;

    const activate = () => {
      if (pendingRef.current !== pending) return;
      pending.timer = 0;
      delete cap.dataset.arming;
      delete cap.dataset.noSelect;
      beginDrag(pending.id, pending.pointerId, pending.lx, pending.ly, cap);
    };
    if (hold) {
      pending.timer = window.setTimeout(activate, HOLD_MS);
      cap.dataset.arming = "";
      // Suppressing selection is only needed where a long-press natively
      // selects (touch callout). On a mouse it would kill text selection and
      // double-click word-select during the hold window.
      if (e.pointerType !== "mouse") cap.dataset.noSelect = "";
    }

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pending.pointerId) return;
      pending.lx = ev.clientX;
      pending.ly = ev.clientY;
      const d = dragRef.current;
      if (!d) {
        if (Math.hypot(ev.clientX - pending.x, ev.clientY - pending.y) < DRAG_THRESHOLD) return;
        // Moving past slop before the hold fired means a click/scroll intent.
        if (pending.hold) {
          teardown();
          return;
        }
        activate();
        return;
      }
      d.px = ev.clientX;
      d.py = ev.clientY;
      if (!d.raf) d.raf = requestAnimationFrame(dragTick);
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pending.pointerId) return;
      teardown();
      finishDrag(false);
    };
    const onCancel = (ev: PointerEvent) => {
      if (ev.pointerId !== pending.pointerId) return;
      teardown();
      finishDrag(true);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      teardown();
      finishDrag(true);
    };
    // While armed or flying, kill the touch long-press context menu and any
    // native link/image drag that would fight our own.
    const onCtx = (ev: Event) => ev.preventDefault();
    const onNativeDrag = (ev: Event) => ev.preventDefault();
    const teardown = () => {
      pendingRef.current = null;
      clearTimeout(pending.timer);
      delete cap.dataset.arming;
      delete cap.dataset.noSelect;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("contextmenu", onCtx, true);
      document.removeEventListener("dragstart", onNativeDrag, true);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey);
    document.addEventListener("contextmenu", onCtx, true);
    document.addEventListener("dragstart", onNativeDrag, true);
  }

  function onGripDown(e: ReactPointerEvent<HTMLButtonElement>, id: string) {
    armDrag(e, id, e.currentTarget, false);
  }

  /** Press-and-hold anywhere on the card (except interactive targets) lifts it. */
  function onItemDown(e: ReactPointerEvent<HTMLDivElement>, id: string) {
    if (phone || e.pointerType !== "mouse" || window.matchMedia("(pointer: coarse)").matches) return;
    if ((e.target as HTMLElement).closest(HOLD_EXCLUDE)) return;
    armDrag(e, id, e.currentTarget, true);
  }

  /** The click that trails a real drag must not edit a note or open a link. */
  function onItemClickCapture(e: ReactMouseEvent<HTMLDivElement>) {
    if (!suppressClickRef.current) return;
    suppressClickRef.current = false;
    e.preventDefault();
    e.stopPropagation();
  }

  /** Saves a note's edited body. Returns whether the save landed so the card can leave edit mode. */
  async function handleSaveNote(id: string, content: string): Promise<boolean> {
    const res = await fetch(`/api/dumps/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ content }) });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast(err.error ?? "Couldn't save that note", "error");
      return false;
    }
    const updated = (await res.json()) as Dump;
    setItems((prev) => prev.map((d) => (d.id === id ? updated : d)));
    toast("Note saved");
    return true;
  }

  async function handleRetry(id: string) {
    pendingToasts.current.add(id);
    await fetch(`/api/dumps/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ reprocess: true }) });
    load();
  }

  async function handleResort() {
    setResorting(true);
    try {
      const res = await fetch("/api/dumps/resort", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) toast(data.error ?? "Couldn't re-sort right now", "error");
      else if (data.sorted === 0 && data.failed > 0) toast("Couldn't reach the AI. Nothing was moved.", "error");
      else
        toast(
          `Re-sorted ${data.sorted} ${data.sorted === 1 ? "dump" : "dumps"}: ${data.moved} moved${data.failed ? `, ${data.failed} skipped` : ""}`,
          data.failed ? "error" : "info",
        );
      load();
    } finally {
      setResorting(false);
    }
  }

  const activeLabel = topic ? topicMeta(topic, topics).label : kind ? kindMeta(kind).label : null;
  const typeOptions = (
    <>
      <option value="">All types</option>
      {KINDS.filter((k) => counts.kinds[k.id] || k.id === kind).map((k) => (
        <option key={k.id} value={k.id}>{k.label} ({counts.kinds[k.id] ?? 0})</option>
      ))}
    </>
  );

  return (
    <div className="d-page">
      <header className="d-header">
        <div className="d-header-row">
          <button className="d-brand" onClick={() => setFilter({ q: null, kind: null, topic: null })} aria-label="Dump home">
            <span className="d-wordmark">dump</span>
            <span className="d-count">{counts.total}</span>
          </button>
          <SectionNav
            phone={phone}
            counts={counts}
            topics={topics}
            topic={topic}
            onSelect={setFilter}
            onChange={(t) => {
              setTopics(t);
              // Deletes move dumps, so the counts (and cards under the old topic) refresh too.
              void load();
            }}
            toast={toast}
          />

          {phone && (
            <div className="d-type-filter">
              <PhoneMenuRoot>
                <Menu.Trigger className="d-phone-type" aria-label={kind ? `Type: ${kindMeta(kind).label}` : "Type: All types"}>
                  <span>{kind ? kindMeta(kind).label : "Type"}</span>
                  <svg viewBox="0 0 10 6" className="d-move-caret" aria-hidden>
                    <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                  </svg>
                </Menu.Trigger>
                <PhoneMenu>
                  <Menu.RadioGroup value={kind ?? ""} onValueChange={(value) => setFilter({ kind: String(value) || null })}>
                    <Menu.RadioItem className="d-menu-item" value="">All types</Menu.RadioItem>
                    {KINDS.filter((k) => counts.kinds[k.id] || k.id === kind).map((k) => (
                      <Menu.RadioItem className="d-menu-item" key={k.id} value={k.id}>{k.label} ({counts.kinds[k.id] ?? 0})</Menu.RadioItem>
                    ))}
                  </Menu.RadioGroup>
                </PhoneMenu>
              </PhoneMenuRoot>
            </div>
          )}

          <label className="d-search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              ref={searchRef}
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search everything you've dumped"
              aria-label="Search"
            />
            {(activeLabel || q) && (
              <span className="d-results">
                {items.length} {items.length === 1 ? "result" : "results"}
              </span>
            )}
            <kbd>⌘K</kbd>
          </label>

          <div className="d-header-tools">
            <div className="d-settings" ref={settingsRef}>
              <button
                className="d-icon-btn"
                onClick={() => setSettingsOpen((o) => !o)}
                aria-label="Settings"
                title="Settings"
                aria-expanded={settingsOpen}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
                  <circle cx="16" cy="7" r="2.2" />
                  <circle cx="10" cy="17" r="2.2" />
                </svg>
              </button>
              {(settingsOpen || phone) && (
                <div className="d-settings-pop" hidden={!settingsOpen}>
                  <div className="d-settings-row d-desktop-setting">
                    <span className="d-settings-label">Type</span>
                    <select
                      className="d-kind-select"
                      value={kind ?? ""}
                      onChange={(e) => setFilter({ kind: e.target.value || null })}
                      aria-label="Type"
                    >
                      {typeOptions}
                    </select>
                  </div>
                  {aiOn && (
                    <div className="d-settings-row">
                      <span className="d-settings-label">Topics</span>
                      <button className="d-ghost-btn" onClick={handleResort} disabled={resorting}>
                        {resorting ? "Re-sorting…" : "Re-sort with AI"}
                      </button>
                    </div>
                  )}
                  <div className="d-settings-row">
                    <span className="d-settings-label">Categories</span>
                    <button className="d-ghost-btn" onClick={() => setCatsOpen(true)}>
                      Manage…
                    </button>
                  </div>
                  <div className="d-settings-row">
                    <span className="d-settings-label">Theme</span>
                    <div className="d-seg">
                      <button className="d-seg-btn" aria-pressed={!dark} onClick={() => !dark || toggleDark()}>
                        Light
                      </button>
                      <button className="d-seg-btn" aria-pressed={dark} onClick={() => dark || toggleDark()}>
                        Dark
                      </button>
                    </div>
                  </div>
                  <div className="d-settings-row d-desktop-setting">
                    <span className="d-settings-label">Card size</span>
                    <span className="d-density-wrap">
                      <span className="d-density-icon small" aria-hidden />
                      <input
                        type="range"
                        min={200}
                        max={440}
                        step={20}
                        value={density}
                        onChange={(e) => changeDensity(Number(e.target.value))}
                        aria-label="Card size"
                        className="d-density"
                      />
                      <span className="d-density-icon" aria-hidden />
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="d-main">
        {loaded && items.length === 0 ? (
          <div className="d-empty" key="empty">
            {q || kind || topic ? (
              <>
                <p>Nothing matches that. Try a different word.</p>
                <button className="d-ghost-btn d-phone-clear" onClick={() => {
                  setSearch("");
                  setFilter({ q: null, kind: null, topic: null });
                }}>Clear filters</button>
              </>
            ) : (
              <>
                <div className="d-empty-art" aria-hidden>
                  <span className="d-empty-card a">
                    <span className="d-empty-img" />
                  </span>
                  <span className="d-empty-card b">
                    <span className="d-empty-avatar" />
                    <span className="d-empty-lines">
                      <i />
                      <i />
                      <i />
                    </span>
                  </span>
                  <span className="d-empty-card c">
                    <span className="d-empty-img alt" />
                    <span className="d-empty-lines">
                      <i />
                      <i />
                    </span>
                  </span>
                  <span className="d-empty-drop" aria-hidden>
                    <i className="d1" />
                    <i className="d2" />
                    <i className="d3" />
                  </span>
                  <span className="d-empty-bin">
                    <Logo size={88} />
                  </span>
                </div>
                <p className="d-empty-title">Nothing dumped yet</p>
                <p>Paste a link, an X post, a YouTube video, an image or a quick note below. Dump files it for you.</p>
              </>
            )}
          </div>
        ) : (
          <div className="d-grid" key="grid" ref={gridRef} data-dragging={dragId ? "" : undefined}>
            {items.map((d) => (
              <FeedItem
                key={d.id}
                dump={d}
                phone={phone}
                fresh={d.id === freshId}
                removing={removingIds.has(d.id)}
                sortable={sortable}
                dragging={d.id === dragId}
                onGripDown={onGripDown}
                onItemDown={onItemDown}
                onItemClickCapture={onItemClickCapture}
                onNudge={nudge}
                onTopic={handleTopic}
                onDelete={handleDelete}
                onRetry={handleRetry}
                onPin={handlePin}
                onSaveNote={handleSaveNote}
                topics={topics}
              />
            ))}
          </div>
        )}
        {hasMore && (
          <div className="mt-6 flex justify-center">
            <button type="button" onClick={loadMore} className="d-ghost-btn">
              Load more
            </button>
          </div>
        )}

        <footer className="d-footer">
          Dump from any page: drag{" "}
          <a ref={bookmarklet} onClick={(e) => e.preventDefault()} className="d-bookmarklet">
            + Dump it
          </a>{" "}
          to your bookmarks bar.
        </footer>
      </main>

      <Composer onDump={handleDump} phone={phone} />
      {phone && <div className="d-phone-popup-boundary" aria-hidden />}

      <CategoryManager
        open={catsOpen}
        onClose={() => setCatsOpen(false)}
        topics={topics}
        counts={counts.topics}
        onChange={(t) => {
          setTopics(t);
          // Deletes move dumps, so the counts (and cards under the old topic) refresh too.
          void load();
        }}
        toast={toast}
      />

      <Toaster
        position="bottom-center"
        theme={dark ? "dark" : "light"}
        offset="5.5rem"
        mobileOffset="5.5rem"
        toastOptions={{ style: { borderRadius: "999px" } }}
      />
    </div>
  );
}
