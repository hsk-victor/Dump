"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Dump } from "@/lib/db";
import { KINDS, kindMeta, topicMeta } from "@/lib/taxonomy";
import { DENSITY_KEY } from "@/lib/theme";
import Composer from "./Composer";
import DumpCard from "./DumpCard";
import Masthead from "./Masthead";
import SectionNav, { type Counts } from "./SectionNav";
import ThemeSwitcher from "./ThemeSwitcher";

const PAGE_SIZE = 60;

interface Toast {
  id: number;
  text: string;
  tone: "info" | "error";
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
  // How many items to show; resets to one page whenever the filters change.
  const filterKey = `${q}|${kind}|${topic}`;
  const [page, setPage] = useState({ key: filterKey, limit: PAGE_SIZE });
  const limit = page.key === filterKey ? page.limit : PAGE_SIZE;
  const lastSyncedQ = useRef(q);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const pendingToasts = useRef(new Set<string>());
  const searchRef = useRef<HTMLInputElement>(null);
  const bookmarklet = useRef<HTMLAnchorElement>(null);
  const [density, setDensity] = useState(280);

  useEffect(() => {
    const saved = Number(localStorage.getItem(DENSITY_KEY));
    if (saved) setDensity(saved);
    // React refuses javascript: hrefs in JSX, so set it directly.
    const code = `javascript:(()=>{window.open('${window.location.origin}/dump?url='+encodeURIComponent(location.href)+'&title='+encodeURIComponent(document.title),'dump','width=360,height=220')})()`;
    bookmarklet.current?.setAttribute("href", code);
  }, []);

  function changeDensity(px: number) {
    setDensity(px);
    localStorage.setItem(DENSITY_KEY, String(px));
    document.documentElement.style.setProperty("--col-w", `${px}px`);
  }

  const toast = useCallback((text: string, tone: Toast["tone"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
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
    const data = (await res.json()) as { items: Dump[]; hasMore: boolean; counts: Counts };
    setItems(data.items);
    setHasMore(data.hasMore);
    setCounts(data.counts);
    setLoaded(true);

    for (const d of data.items) {
      if (pendingToasts.current.has(d.id) && d.status !== "processing") {
        pendingToasts.current.delete(d.id);
        toast(`Filed under ${topicMeta(d.topic).label} · ${kindMeta(d.kind).singular}`);
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

  // Poll while anything is still being sorted in the background.
  const anyProcessing = items.some((d) => d.status === "processing") || pendingToasts.current.size > 0;
  useEffect(() => {
    if (!anyProcessing) return;
    const t = setInterval(load, 1200);
    return () => clearInterval(t);
  }, [anyProcessing, load]);

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
    setItems((prev) => prev.filter((d) => d.id !== id));
    await fetch(`/api/dumps/${id}`, { method: "DELETE" });
    load();
  }

  async function handleRetry(id: string) {
    pendingToasts.current.add(id);
    await fetch(`/api/dumps/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ reprocess: true }) });
    load();
  }

  const activeLabel = topic ? topicMeta(topic).label : kind ? kindMeta(kind).label : null;
  const kinds = KINDS.filter((k) => counts.kinds[k.id]);

  return (
    <div className="d-page">
      <Masthead total={counts.total} />
      <SectionNav counts={counts} topic={topic} onSelect={(t) => setFilter({ topic: t })} />

      <main className="d-main">
        <Composer onDump={handleDump} />

        <div className="d-toolbar">
          <div className="d-tabs" role="tablist" aria-label="Type">
            <button role="tab" aria-selected={!kind} onClick={() => setFilter({ kind: null })}>
              All
            </button>
            {kinds.map((k) => (
              <button key={k.id} role="tab" aria-selected={kind === k.id} onClick={() => setFilter({ kind: kind === k.id ? null : k.id })}>
                {k.label}
              </button>
            ))}
          </div>
          <div className="d-tools">
            {(activeLabel || q) && (
              <span className="d-results">
                {items.length} {items.length === 1 ? "result" : "results"}
              </span>
            )}
            <label className="d-search">
              <input
                ref={searchRef}
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search"
                aria-label="Search"
              />
              <kbd>⌘K</kbd>
            </label>
            <input
              type="range"
              min={200}
              max={440}
              step={20}
              value={density}
              onChange={(e) => changeDensity(Number(e.target.value))}
              aria-label="Card density"
              title="Card density"
              className="d-density"
            />
          </div>
        </div>

        {loaded && items.length === 0 ? (
          <div className="d-empty">
            {q || kind || topic ? (
              <p>Nothing matches that. Try a different word.</p>
            ) : (
              <>
                <p className="d-empty-title">Your dump is empty.</p>
                <p>Paste a link, an X post, a YouTube video, an image or a quick note above. Dump will file it for you.</p>
              </>
            )}
          </div>
        ) : (
          <div className="d-grid">
            {items.map((d) => (
              <DumpCard
                key={d.id}
                dump={d}
                onTopic={handleTopic}
                onDelete={handleDelete}
                onRetry={handleRetry}
                onTag={(t) => setSearch(t)}
              />
            ))}
          </div>
        )}
        {hasMore && (
          <div className="mt-8 flex justify-center">
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

      <ThemeSwitcher />

      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex flex-col items-center gap-2">
        {toasts.map((t) => (
          <div key={t.id} className="d-toast" data-tone={t.tone}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}
