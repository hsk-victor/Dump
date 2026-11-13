"use client";

import { KINDS, TOPICS } from "@/lib/taxonomy";

export interface Counts {
  total: number;
  kinds: Record<string, number>;
  topics: Record<string, number>;
}

interface Props {
  counts: Counts;
  topic: string | null;
  kind: string | null;
  onSelect: (filter: { topic?: string | null; kind?: string | null }) => void;
}

/** Topic tabs plus a type picker, under the header. */
export default function SectionNav({ counts, topic, kind, onSelect }: Props) {
  const topics = TOPICS.filter((t) => counts.topics[t.id]).sort(
    (a, b) => Number(a.id === "other") - Number(b.id === "other") || (counts.topics[b.id] ?? 0) - (counts.topics[a.id] ?? 0),
  );
  const kinds = KINDS.filter((k) => counts.kinds[k.id]);

  return (
    <div className="d-subnav">
      <nav className="d-topics" aria-label="Topics">
        <button className="d-topic" aria-pressed={!topic} onClick={() => onSelect({ topic: null })}>
          All
        </button>
        {topics.map((t) => (
          <button
            key={t.id}
            className="d-topic"
            aria-pressed={topic === t.id}
            style={{ "--topic": t.color } as React.CSSProperties}
            onClick={() => onSelect({ topic: topic === t.id ? null : t.id })}
          >
            <span className="d-dot" />
            {t.label}
          </button>
        ))}
      </nav>
      <select className="d-kind-select" value={kind ?? ""} onChange={(e) => onSelect({ kind: e.target.value || null })} aria-label="Type">
        <option value="">All types</option>
        {kinds.map((k) => (
          <option key={k.id} value={k.id}>
            {k.label} ({counts.kinds[k.id]})
          </option>
        ))}
      </select>
    </div>
  );
}
