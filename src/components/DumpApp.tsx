"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Dump } from "@/lib/db";
import { kindMeta, topicMeta } from "@/lib/taxonomy";
import Composer from "./Composer";
import DumpCard from "./DumpCard";
import Sidebar, { type Counts } from "./Sidebar";

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
      if (e.key === "/" && !el.closest("input, textarea, select")) {
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

  return (
    <div className="mx-auto flex min-h-screen max-w-7xl gap-8 px-4 py-6 sm:px-6">
      <aside className="sticky top-6 hidden h-[calc(100vh-3rem)] w-56 shrink-0 overflow-y-auto md:block">
        <div className="mb-6 flex items-baseline gap-2 px-2.5">
          <h1 className="text-2xl font-black tracking-tight">Dump</h1>
          <span className="text-xs text-stone-400">save anything</span>
        </div>
        <Sidebar counts={counts} kind={kind} topic={topic} onSelect={setFilter} />
      </aside>

      <main className="min-w-0 flex-1">
        <h1 className="mb-4 text-2xl font-black tracking-tight md:hidden">Dump</h1>
        <Composer onDump={handleDump} />

        <div className="mt-6 mb-4 flex flex-wrap items-center gap-3">
          <div className="relative min-w-60 flex-1">
            <input
              ref={searchRef}
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search everything you've dumped…  ( / )"
              aria-label="Search"
              className="w-full rounded-xl border border-stone-200 bg-white px-4 py-2 text-sm outline-none focus:border-stone-400"
            />
          </div>
          {(activeLabel || q) && (
            <div className="flex items-center gap-2 text-sm text-stone-500">
              {items.length} {items.length === 1 ? "result" : "results"}
              {activeLabel && (
                <button onClick={() => setFilter({ kind: null, topic: null })} className="rounded-full bg-stone-900 px-2.5 py-0.5 text-xs text-white">
                  {activeLabel} ×
                </button>
              )}
            </div>
          )}
        </div>

        <div className="mb-4 flex gap-1.5 overflow-x-auto md:hidden">
          <select
            value={topic ?? ""}
            onChange={(e) => setFilter({ topic: e.target.value || null })}
            className="rounded-lg border border-stone-200 bg-white px-2 py-1 text-sm"
            aria-label="Topic"
          >
            <option value="">All topics</option>
            {Object.keys(counts.topics).map((t) => (
              <option key={t} value={t}>
                {topicMeta(t).label} ({counts.topics[t]})
              </option>
            ))}
          </select>
          <select
            value={kind ?? ""}
            onChange={(e) => setFilter({ kind: e.target.value || null })}
            className="rounded-lg border border-stone-200 bg-white px-2 py-1 text-sm"
            aria-label="Type"
          >
            <option value="">All types</option>
            {Object.keys(counts.kinds).map((k) => (
              <option key={k} value={k}>
                {kindMeta(k).label} ({counts.kinds[k]})
              </option>
            ))}
          </select>
        </div>

        {loaded && items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-stone-300 px-6 py-16 text-center text-stone-500">
            {q || kind || topic ? (
              <p>Nothing matches that. Try a different word.</p>
            ) : (
              <>
                <p className="text-lg font-medium text-stone-700">Your dump is empty.</p>
                <p className="mt-1 text-sm">Paste a link, an X post, a YouTube video, an image or a quick note above. Dump will file it for you.</p>
              </>
            )}
          </div>
        ) : (
          <div className="columns-1 gap-4 sm:columns-2 xl:columns-3">
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
          <div className="mt-6 flex justify-center">
            <button
              type="button"
              onClick={() => setPage({ key: filterKey, limit: limit + PAGE_SIZE })}
              className="rounded-xl border border-stone-200 bg-white px-5 py-2 text-sm font-medium text-stone-700 shadow-sm hover:bg-stone-50"
            >
              Load more
            </button>
          </div>
        )}
      </main>

      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex flex-col items-center gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`rounded-full px-4 py-2 text-sm shadow-lg ${t.tone === "error" ? "bg-red-600 text-white" : "bg-stone-900 text-white"}`}
          >
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}
