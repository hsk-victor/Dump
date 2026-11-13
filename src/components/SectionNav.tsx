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
  onSelect: (topic: string | null) => void;
}

/** Topics as newspaper-style sections across the top. */
export default function SectionNav({ counts, topic, onSelect }: Props) {
  const topics = TOPICS.filter((t) => counts.topics[t.id]).sort(
    (a, b) => Number(a.id === "other") - Number(b.id === "other") || (counts.topics[b.id] ?? 0) - (counts.topics[a.id] ?? 0),
  );

  return (
    <nav className="d-sections" aria-label="Topics">
      <button className="d-section" aria-pressed={!topic} onClick={() => onSelect(null)}>
        Everything <sup>{counts.total}</sup>
      </button>
      {topics.map((t) => (
        <button
          key={t.id}
          className="d-section"
          aria-pressed={topic === t.id}
          style={{ "--topic": t.color } as React.CSSProperties}
          onClick={() => onSelect(topic === t.id ? null : t.id)}
        >
          {t.label} <sup>{counts.topics[t.id]}</sup>
        </button>
      ))}
    </nav>
  );
}
