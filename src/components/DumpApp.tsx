"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Toaster, toast as sonnerToast } from "sonner";
import type { Dump } from "@/lib/db";
import { KINDS, kindMeta, topicMeta } from "@/lib/taxonomy";
import { DENSITY_KEY, MODE_KEY } from "@/lib/theme";
import Composer from "./Composer";
import DumpCard from "./DumpCard";
import Logo from "./Logo";
import SectionNav, { type Counts } from "./SectionNav";

const PAGE_SIZE = 60;

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
          <div className="d-grid">
            {items.map((d) => (
              <DumpCard
                key={d.id}
                dump={d}
                fresh={d.id === freshId}
                removing={removingIds.has(d.id)}
                onTopic={handleTopic}
                onDelete={handleDelete}
                onRetry={handleRetry}
              />
            ))}
          </div>
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
