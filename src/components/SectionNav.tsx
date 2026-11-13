"use client";

import { TOPICS } from "@/lib/taxonomy";

export interface Counts {
  total: number;
  kinds: Record<string, number>;
  topics: Record<string, number>;
}

interface Props {
  counts: Counts;
  topic: string | null;
  onSelect: (filter: { topic?: string | null }) => void;
}

/** Topic tabs, left side of the header. */
export default function SectionNav({ counts, topic, onSelect }: Props) {
  const topics = TOPICS.filter((t) => counts.topics[t.id]).sort(
    (a, b) => Number(a.id === "other") - Number(b.id === "other") || (counts.topics[b.id] ?? 0) - (counts.topics[a.id] ?? 0),
  );

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
    </div>
  );
}
