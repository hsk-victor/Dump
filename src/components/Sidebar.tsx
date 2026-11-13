"use client";

import { useEffect, useRef } from "react";
import { KINDS, TOPICS } from "@/lib/taxonomy";

export interface Counts {
  total: number;
  kinds: Record<string, number>;
  topics: Record<string, number>;
}

interface Props {
  counts: Counts;
  kind: string | null;
  topic: string | null;
  onSelect: (filter: { kind?: string | null; topic?: string | null }) => void;
}

function Row({ label, count, active, color, onClick }: { label: string; count: number; active: boolean; color?: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm transition ${
        active ? "bg-stone-900 text-white" : "text-stone-700 hover:bg-stone-200/60"
      }`}
    >
      {color && <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />}
      <span className="truncate">{label}</span>
      <span className={`ml-auto text-xs tabular-nums ${active ? "text-stone-300" : "text-stone-400"}`}>{count}</span>
    </button>
  );
}

export default function Sidebar({ counts, kind, topic, onSelect }: Props) {
  const bookmarklet = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    // React refuses javascript: hrefs in JSX, so set it directly.
    const code = `javascript:(()=>{window.open('${window.location.origin}/dump?url='+encodeURIComponent(location.href)+'&title='+encodeURIComponent(document.title),'dump','width=360,height=220')})()`;
    bookmarklet.current?.setAttribute("href", code);
  }, []);

  const kinds = KINDS.filter((k) => counts.kinds[k.id]);
  const topics = TOPICS.filter((t) => counts.topics[t.id]).sort((a, b) => Number(a.id === "other") - Number(b.id === "other") || (counts.topics[b.id] ?? 0) - (counts.topics[a.id] ?? 0));

  return (
    <nav className="space-y-6">
      <div>
        <Row label="Everything" count={counts.total} active={!kind && !topic} onClick={() => onSelect({ kind: null, topic: null })} />
      </div>

      {topics.length > 0 && (
        <div>
          <h4 className="mb-1.5 px-2.5 text-[11px] font-semibold tracking-wider text-stone-400 uppercase">Topics</h4>
          <div className="space-y-0.5">
            {topics.map((t) => (
              <Row
                key={t.id}
                label={t.label}
                color={t.color}
                count={counts.topics[t.id] ?? 0}
                active={topic === t.id}
                onClick={() => onSelect({ topic: topic === t.id ? null : t.id })}
              />
            ))}
          </div>
        </div>
      )}

      {kinds.length > 0 && (
        <div>
          <h4 className="mb-1.5 px-2.5 text-[11px] font-semibold tracking-wider text-stone-400 uppercase">Types</h4>
          <div className="space-y-0.5">
            {kinds.map((k) => (
              <Row key={k.id} label={k.label} count={counts.kinds[k.id] ?? 0} active={kind === k.id} onClick={() => onSelect({ kind: kind === k.id ? null : k.id })} />
            ))}
          </div>
        </div>
      )}

      <div className="rounded-xl border border-dashed border-stone-300 p-3 text-xs text-stone-500">
        <p className="mb-2">Dump from any page: drag this to your bookmarks bar.</p>
        <a
          ref={bookmarklet}
          onClick={(e) => e.preventDefault()}
          className="inline-block cursor-grab rounded-lg bg-stone-900 px-3 py-1.5 font-medium text-white"
        >
          + Dump it
        </a>
      </div>
    </nav>
  );
}
