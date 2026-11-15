"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Toaster, toast as sonnerToast } from "sonner";
import type { Dump } from "@/lib/db";
import { KINDS, kindMeta, topicMeta } from "@/lib/taxonomy";
import { DENSITY_KEY, MODE_KEY } from "@/lib/theme";
import Composer from "./Composer";
import DumpCard, { type DragHandle } from "./DumpCard";
import Logo from "./Logo";
import SectionNav, { type Counts } from "./SectionNav";
import UpdateButton from "./UpdateButton";

const PAGE_SIZE = 60;
/** Card height guess before its first measurement, plus the 6px --gap between cards. */
const ESTIMATE_H = 260;
const GAP_EST = 6;

type Cell = Dump | "marker";

/** One card in the feed: droppable so other cards can land on it, draggable via its grip. */
function FeedItem({
  dump,
  fresh,
  removing,
  sortable,
  ...handlers
}: {
  dump: Dump;
  fresh: boolean;
  removing: boolean;
  sortable: boolean;
  onTopic: (id: string, topic: string) => void;
  onDelete: (id: string) => void;
  onRetry: (id: string) => void;
  onPin: (id: string, pinned: boolean) => void;
  onSaveNote: (id: string, content: string) => Promise<boolean>;
}) {
  const drag = useDraggable({ id: dump.id, disabled: !sortable });
  const drop = useDroppable({ id: dump.id, disabled: !sortable });
  return (
    <div
      ref={(n) => {
        drag.setNodeRef(n);
        drop.setNodeRef(n);
      }}
      className="d-item"
      data-did={dump.id}
      data-dragging={drag.isDragging || undefined}
    >
      <DumpCard
        dump={dump}
        fresh={fresh}
        removing={removing}
        drag={sortable ? { activatorRef: drag.setActivatorNodeRef, listeners: drag.listeners, attributes: drag.attributes } : undefined}
        {...handlers}
      />
    </div>
  );
}

/** A masonry column; droppable itself so a card can be dropped past its last card. */
function FeedColumn({ id, children }: { id: string; children: React.ReactNode }) {
  const { setNodeRef } = useDroppable({ id });
  return (
    <div className="d-col" ref={setNodeRef}>
      {children}
    </div>
  );
}

export default function DumpApp() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const q = params.get("q") ?? "";
  const kind = params.get("kind");
  const topic = params.get("topic");

  const [items, setItems] = useState<Dump[]>([]);
  const [counts, setCounts] = useState<Counts>({ total: 0, kinds: {}, topics: {} });
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState(q);
  const [hasMore, setHasMore] = useState(false);
  const [freshId, setFreshId] = useState<string | null>(null);
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());
  // How many items to show; resets to one page whenever the filters change.
  const filterKey = `${q}|${kind}|${topic}`;
  const [page, setPage] = useState({ key: filterKey, limit: PAGE_SIZE });
  const limit = page.key === filterKey ? page.limit : PAGE_SIZE;
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
  const [colCount, setColCount] = useState(1);
  const [measureTick, setMeasureTick] = useState(0);
  const cardHeights = useRef(new Map<string, number>());
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [dragWidth, setDragWidth] = useState(0);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
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
    const code = `javascript:(()=>{const m=n=>{const e=document.querySelector('meta[property="'+n+'"],meta[name="'+n+'"]');return e?e.content:''};const u=v=>{try{return v?new URL(v,location.href).href:''}catch(x){return''}};window.open('${window.location.origin}/dump?url='+encodeURIComponent(location.href)+'&title='+encodeURIComponent(document.title)+'&desc='+encodeURIComponent(m('og:description')||m('twitter:description')||m('description'))+'&img='+encodeURIComponent(u(m('og:image')||m('twitter:image'))),'dump','width=360,height=220')})()`;
    bookmarklet.current?.setAttribute("href", code);
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
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (kind) sp.set("kind", kind);
    if (topic) sp.set("topic", topic);
    sp.set("limit", String(limit));
    const res = await fetch(`/api/dumps?${sp}`, { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { items: Dump[]; hasMore: boolean; counts: Counts; ai: boolean };
    setItems(data.items);
    setAiOn(data.ai);
    setHasMore(data.hasMore);
    setCounts(data.counts);
    setLoaded(true);

    for (const d of data.items) {
      if (pendingToasts.current.has(d.id) && d.status !== "processing") {
        pendingToasts.current.delete(d.id);
        if (d.status === "failed")
          toast("Couldn't fetch that link. Saved it anyway.", "error");
        else toast(`Filed under ${topicMeta(d.topic).label} · ${kindMeta(d.kind).singular}`);
      }
    }
  }, [q, kind, topic, limit, toast]);

  useEffect(() => {
    load();
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
  const anyProcessing = items.some((d) => d.status === "processing") || pendingToasts.current.size > 0;
  useEffect(() => {
    if (!anyProcessing || dragId) return;
    const t = setInterval(load, 1200);
    return () => clearInterval(t);
  }, [anyProcessing, dragId, load]);

  // Column count follows the container width and the card-size preference; the CSS
  // column-width on .d-grid is kept purely so this can read the resolved pixel width.
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const compute = () => {
      const cs = getComputedStyle(el);
      const gap = parseFloat(cs.columnGap) || GAP_EST;
      const w = parseFloat(cs.columnWidth) || 260;
      setColCount(Math.max(1, Math.floor((el.clientWidth + gap) / (w + gap))));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [density, loaded, items.length > 0]);

  // Measure each rendered card once so the greedy column split can balance heights.
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      let changed = false;
      for (const e of entries) {
        const id = (e.target as HTMLElement).dataset.did;
        if (!id) continue;
        const h = Math.round(e.borderBoxSize?.[0]?.blockSize ?? e.contentRect.height);
        if (Math.abs((cardHeights.current.get(id) ?? -1) - h) > 4) {
          cardHeights.current.set(id, h);
          changed = true;
        }
      }
      if (changed) setMeasureTick((t) => t + 1);
    });
    el.querySelectorAll(".d-item").forEach((n) => ro.observe(n));
    return () => ro.disconnect();
  });

  // Split the flat order into columns: every item (plus the drop marker while dragging)
  // goes into whichever column is currently shortest.
  const rest = dragId ? items.filter((d) => d.id !== dragId) : items;
  const columns = useMemo(() => {
    const seq: Cell[] =
      dropIndex === null ? rest : [...rest.slice(0, dropIndex), "marker" as const, ...rest.slice(dropIndex)];
    const out: Cell[][] = Array.from({ length: Math.max(1, colCount) }, () => []);
    const heights = new Array<number>(out.length).fill(0);
    for (const it of seq) {
      let c = 0;
      for (let i = 1; i < heights.length; i++) if (heights[i] < heights[c]) c = i;
      if (it === "marker") {
        out[c].push(it);
        heights[c] += 14;
      } else {
        out[c].push(it);
        heights[c] += (cardHeights.current.get(it.id) ?? ESTIMATE_H) + GAP_EST;
      }
    }
    return out;
  }, [rest, dropIndex, colCount, measureTick]);

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
    if (file) {
      const form = new FormData();
      form.set("file", file);
      form.set("text", text);
      res = await fetch("/api/dumps", { method: "POST", body: form });
    } else {
      res = await fetch("/api/dumps", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast(err.error ?? "Couldn't dump that", "error");
      return false;
    }
    const dump = (await res.json()) as Dump & { duplicate?: boolean };
    if (dump.duplicate) toast(`Already in your dump (${topicMeta(dump.topic).label}). Moved it to the top`);
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
    toast(`Moved to ${topicMeta(newTopic).label}`);
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

  function onDragStart(e: DragStartEvent) {
    setDragId(String(e.active.id));
    setDragWidth(e.active.rect.current.initial?.width ?? 0);
    setDropIndex(null);
  }

  // The marker's flat index (in the dragged-card-removed list) where it would land.
  function onDragMove(e: DragMoveEvent) {
    const { active, over } = e;
    // Clear the marker when the pointer leaves every droppable, so releasing
    // outside the grid can't commit a stale slot.
    if (!over) {
      setDropIndex(null);
      return;
    }
    const list = items.filter((d) => d.id !== active.id);
    const oid = String(over.id);
    if (oid.startsWith("col-")) {
      const col = columns[Number(oid.slice(4))]?.filter((c): c is Dump => c !== "marker") ?? [];
      const last = col[col.length - 1];
      setDropIndex(last ? list.findIndex((d) => d.id === last.id) + 1 : list.length);
      return;
    }
    const i = list.findIndex((d) => d.id === oid);
    if (i < 0) return;
    // The pointer's own position inside the target decides before/after — the
    // dragged card's center mispredicts it whenever the two cards differ in height.
    const activator = e.activatorEvent;
    const before =
      activator instanceof MouseEvent
        ? activator.clientY + e.delta.y < over.rect.top + over.rect.height / 2
        : true;
    setDropIndex(before ? i : i + 1);
  }

  async function onDragEnd(e: DragEndEvent) {
    const id = String(e.active.id);
    const j = dropIndex;
    setDragId(null);
    setDropIndex(null);
    if (j === null) return;
    const dragged = items.find((d) => d.id === id);
    if (!dragged || j === items.indexOf(dragged)) return;
    const list = items.filter((d) => d.id !== id);
    // Crossing the pinned boundary flips the flag: dragging below every pinned card
    // unpins, dragging an unpinned card into the pinned block pins it.
    const pinnedCount = list.filter((d) => d.pinned).length;
    const pinned = dragged.pinned ? j <= pinnedCount : j < pinnedCount;
    // Each group sorts by position independently, so the slot must be priced
    // against same-group neighbours — a midpoint across the boundary can rank
    // the card above the very card it was dropped below.
    const beforeJ = list.slice(0, j).filter((d) => d.pinned === pinned).length;
    const same = list.filter((d) => d.pinned === pinned);
    const prev = same[beforeJ - 1];
    const next = same[beforeJ];
    const position = prev && next ? (prev.position + next.position) / 2 : prev ? prev.position - 1 : next ? next.position + 1 : 1;
    const moved = { ...dragged, pinned, position };
    setItems([...list.slice(0, j), moved, ...list.slice(j)]);
    const res = await fetch(`/api/dumps/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(pinned === dragged.pinned ? { position } : { pinned, position }),
    });
    if (!res.ok) {
      toast("Couldn't move that card", "error");
      load();
    }
  }

  const dragDump = items.find((d) => d.id === dragId) ?? null;

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

  const activeLabel = topic ? topicMeta(topic).label : kind ? kindMeta(kind).label : null;

  return (
    <div className="d-page">
      <header className="d-header">
        <div className="d-header-row">
          <button className="d-brand" onClick={() => setFilter({ q: null, kind: null, topic: null })} aria-label="Dump home">
            <span className="d-wordmark">dump</span>
            <span className="d-count">{counts.total}</span>
          </button>
          <SectionNav counts={counts} topic={topic} onSelect={setFilter} />

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
            <UpdateButton />
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
              {settingsOpen && (
                <div className="d-settings-pop">
                  <div className="d-settings-row">
                    <span className="d-settings-label">Type</span>
                    <select
                      className="d-kind-select"
                      value={kind ?? ""}
                      onChange={(e) => setFilter({ kind: e.target.value || null })}
                      aria-label="Type"
                    >
                      <option value="">All types</option>
                      {KINDS.filter((k) => counts.kinds[k.id]).map((k) => (
                        <option key={k.id} value={k.id}>
                          {k.label} ({counts.kinds[k.id]})
                        </option>
                      ))}
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
                  <div className="d-settings-row">
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
          <div className="d-empty">
            {q || kind || topic ? (
              <p>Nothing matches that. Try a different word.</p>
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
                  <span className="d-empty-bin">
                    <Logo size={64} />
                  </span>
                </div>
                <p className="d-empty-title">Your dump is empty</p>
                <p>Paste a link, an X post, a YouTube video, an image or a quick note below. Dump files it for you.</p>
              </>
            )}
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={pointerWithin}
            onDragStart={onDragStart}
            onDragMove={onDragMove}
            onDragEnd={onDragEnd}
            onDragCancel={() => {
              setDragId(null);
              setDropIndex(null);
            }}
          >
            <div className="d-grid" ref={gridRef}>
              {columns.map((col, ci) => (
                <FeedColumn key={ci} id={`col-${ci}`}>
                  {col.map((cell) =>
                    cell === "marker" ? (
                      <div key="marker" className="d-dropmark" />
                    ) : (
                      <FeedItem
                        key={cell.id}
                        dump={cell}
                        fresh={cell.id === freshId}
                        removing={removingIds.has(cell.id)}
                        sortable={sortable}
                        onTopic={handleTopic}
                        onDelete={handleDelete}
                        onRetry={handleRetry}
                        onPin={handlePin}
                        onSaveNote={handleSaveNote}
                      />
                    ),
                  )}
                </FeedColumn>
              ))}
            </div>
            <DragOverlay dropAnimation={null}>
              {dragDump && (
                <div className="d-overlay" style={{ width: dragWidth }}>
                  <DumpCard
                    dump={dragDump}
                    fresh={false}
                    removing={false}
                    onTopic={() => {}}
                    onDelete={() => {}}
                    onRetry={() => {}}
                    onPin={() => {}}
                    onSaveNote={async () => false}
                  />
                </div>
              )}
            </DragOverlay>
          </DndContext>
        )}
        {hasMore && (
          <div className="mt-6 flex justify-center">
            <button type="button" onClick={() => setPage({ key: filterKey, limit: limit + PAGE_SIZE })} className="d-ghost-btn">
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

      <Composer onDump={handleDump} />

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
