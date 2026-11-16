"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { TOPIC_COLORS, type TopicMeta } from "@/lib/taxonomy";

export interface Counts {
  total: number;
  kinds: Record<string, number>;
  topics: Record<string, number>;
}

interface Props {
  counts: Counts;
  topics: TopicMeta[];
  topic: string | null;
  onSelect: (filter: { topic?: string | null }) => void;
  /** Called with the server's fresh topic list after every mutation. */
  onChange: (topics: TopicMeta[]) => void;
  toast: (text: string, tone?: "info" | "error") => void;
}

interface Pop {
  /** topic the popover edits */
  id: string;
  /** viewport coords of the anchor's bottom edge */
  left: number;
  top: number;
  /** px from the popover's left edge to the anchor's center — the transform origin */
  ox: number;
}

async function read(res: Response): Promise<{ topic?: TopicMeta; topics?: TopicMeta[]; error?: string }> {
  return res.json().catch(() => ({}));
}

/** Topic tabs, left side of the header. Double-click a pill to rename it in place;
 *  the dot (click or long-press) opens an anchored color popover with delete. */
export default function SectionNav({ counts, topics: all, topic, onSelect, onChange, toast }: Props) {
  const topics = all.filter((t) => counts.topics[t.id]).sort(
    (a, b) => Number(a.id === "other") - Number(b.id === "other") || (counts.topics[b.id] ?? 0) - (counts.topics[a.id] ?? 0),
  );

  const [renaming, setRenaming] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [pop, setPop] = useState<Pop | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const navRef = useRef<HTMLElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The `topic` filter just before the current click burst — lets a double-click
   *  restore it exactly (the prop is still stale when the dblclick handler runs). */
  const preClickTopic = useRef<string | null>(null);

  const popTopic = pop ? all.find((t) => t.id === pop.id) : null;

  function closePop() {
    setPop(null);
    setConfirmDel(null);
  }

  function anchorPop(t: TopicMeta, el: HTMLElement) {
    popAt(t, el.getBoundingClientRect());
  }

  function popAt(t: TopicMeta, r: DOMRect) {
    const left = Math.min(Math.max(8, r.left), window.innerWidth - 208 - 8);
    setPop({ id: t.id, left, top: r.bottom + 7, ox: Math.max(14, r.left + r.width / 2 - left) });
    setConfirmDel(null);
  }

  // Outside click / Escape / any scroll closes the popover.
  useEffect(() => {
    if (!pop) return;
    const onDown = (e: PointerEvent) => {
      if (!popRef.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest(".d-dot-btn")) closePop();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closePop();
    const onScroll = () => closePop();
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [pop]);

  async function patch(id: string, body: Record<string, string>) {
    const res = await fetch(`/api/topics/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await read(res);
    if (!res.ok) {
      toast(data.error ?? "Couldn't save that", "error");
      return null;
    }
    onChange(data.topics!);
    return data;
  }

  /** Commits an in-strip rename. Returns the saved label, or null to revert. */
  async function commitRename(t: TopicMeta, label: string): Promise<string | null> {
    const clean = label.trim();
    if (clean === t.label) return t.label;
    if (!clean) {
      toast("Categories need a name", "error");
      return null;
    }
    const data = await patch(t.id, { label: clean });
    if (!data) return null;
    const saved = data.topics!.find((x) => x.id === t.id)?.label ?? clean;
    toast(`Renamed to ${saved}`);
    return saved;
  }

  async function recolor(t: TopicMeta, color: string) {
    if (color !== t.color) await patch(t.id, { color });
  }

  async function remove(t: TopicMeta) {
    const n = counts.topics[t.id] ?? 0;
    if (n > 0 && confirmDel !== t.id) {
      setConfirmDel(t.id);
      return;
    }
    const res = await fetch(`/api/topics/${t.id}`, { method: "DELETE" });
    const data = await read(res);
    if (!res.ok) return toast(data.error ?? "Couldn't delete that", "error");
    closePop();
    onChange(data.topics!);
    toast(n ? `${t.label} deleted — ${n} ${n === 1 ? "dump" : "dumps"} moved to Everything else` : `${t.label} deleted`);
  }

  async function create(label: string, anchor: HTMLElement) {
    const clean = label.trim();
    // The anchor pill unmounts the moment `adding` flips back — grab its rect first.
    const anchorRect = anchor.getBoundingClientRect();
    setAdding(false);
    if (!clean) return;
    const res = await fetch("/api/topics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: clean }),
    });
    const data = await read(res);
    if (!res.ok) return toast(data.error ?? "Couldn't add that", "error");
    onChange(data.topics!);
    toast(`${clean} added — the sorter will use it from now on`);
    // The new category has no dumps yet so it won't show in the strip; anchor the
    // color popover where the "+ New" pill was so it can be colored right away.
    if (data.topic) popAt(data.topic, anchorRect);
  }

  function startHold(t: TopicMeta, el: HTMLElement, e: React.PointerEvent) {
    if (e.pointerType !== "touch") return;
    holdTimer.current = setTimeout(() => anchorPop(t, el), 450);
  }
  function endHold() {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
  }

  return (
    <div className="d-subnav">
      <nav className="d-topics" aria-label="Topics" ref={navRef}>
        <button className="d-topic" aria-pressed={!topic} onClick={() => onSelect({ topic: null })}>
          All
        </button>
        {topics.map((t) =>
          renaming === t.id ? (
            // Editing inside the pill itself: dot stays, label becomes the input.
            <div className="d-topic d-topic-edit" key={t.id} style={{ "--topic": t.color } as CSSProperties}>
              <button
                className="d-dot d-dot-btn"
                aria-label={`Color for ${t.label}`}
                aria-expanded={pop?.id === t.id}
                // Pointerdown (not click) so the rename input keeps focus: preventing
                // the default here means no blur, no commit, and no lost click.
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (pop?.id === t.id) closePop();
                  else anchorPop(t, e.currentTarget.closest(".d-topic") as HTMLElement);
                }}
                // Keyboard only — pointer clicks already ran on pointerdown.
                onClick={(e) => {
                  if (e.detail !== 0) return;
                  if (pop?.id === t.id) closePop();
                  else anchorPop(t, e.currentTarget.closest(".d-topic") as HTMLElement);
                }}
              />
              <input
                className="d-topic-rn"
                defaultValue={t.label}
                aria-label={`Name for ${t.label}`}
                maxLength={60}
                autoFocus
                onFocus={(e) => e.currentTarget.select()}
                onBlur={(e) => {
                  const el = e.currentTarget;
                  void commitRename(t, el.value).then((saved) => {
                    if (saved !== null) setRenaming(null);
                    else el.focus();
                  });
                }}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") e.currentTarget.blur();
                  if (e.key === "Escape") {
                    e.currentTarget.value = t.label;
                    setRenaming(null);
                  }
                }}
              />
            </div>
          ) : (
            <button
              key={t.id}
              className="d-topic"
              data-open={pop?.id === t.id || undefined}
              aria-pressed={topic === t.id}
              style={{ "--topic": t.color } as CSSProperties}
              onClick={(e) => {
                if (e.detail > 1) return; // second click of a double-click
                preClickTopic.current = topic;
                onSelect({ topic: topic === t.id ? null : t.id });
              }}
              onDoubleClick={(e) => {
                e.preventDefault();
                // The first click already toggled the filter — restore it.
                onSelect({ topic: preClickTopic.current });
                setRenaming(t.id);
              }}
              onPointerDown={(e) => startHold(t, e.currentTarget, e)}
              onPointerUp={endHold}
              onPointerCancel={endHold}
              onPointerLeave={endHold}
            >
              <span
                className="d-dot d-dot-btn"
                role="button"
                tabIndex={0}
                aria-label={`Color for ${t.label}`}
                aria-expanded={pop?.id === t.id}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  if (pop?.id === t.id) closePop();
                  else anchorPop(t, e.currentTarget.closest(".d-topic") as HTMLElement);
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (e.detail !== 0) return; // pointer already ran on pointerdown
                  if (pop?.id === t.id) closePop();
                  else anchorPop(t, e.currentTarget.closest(".d-topic") as HTMLElement);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    if (pop?.id === t.id) closePop();
                    else anchorPop(t, e.currentTarget.closest(".d-topic") as HTMLElement);
                  }
                }}
              />
              {t.label}
            </button>
          ),
        )}
        {adding ? (
          <div className="d-topic d-topic-edit d-topic-add">
            <input
              className="d-topic-rn"
              placeholder="New category…"
              aria-label="New category name"
              maxLength={60}
              autoFocus
              onBlur={(e) => {
                const anchor = e.currentTarget.closest(".d-topic") as HTMLElement;
                void create(e.currentTarget.value, anchor);
              }}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") setAdding(false);
              }}
            />
          </div>
        ) : (
          <button className="d-topic d-topic-add" onClick={() => setAdding(true)} aria-label="Add a category" title="Add a category">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        )}
      </nav>
      {popTopic &&
        createPortal(
          <div
            className="d-tpop"
            ref={popRef}
            role="dialog"
            aria-label={`Edit ${popTopic.label}`}
            style={{ left: pop!.left, top: pop!.top, "--ox": `${pop!.ox}px`, "--c": popTopic.color } as CSSProperties}
          >
            <div className="d-cat-swatches d-tpop-sw">
              {TOPIC_COLORS.map((c, i) => (
                <button
                  key={c}
                  className="d-cat-swatch"
                  style={{ background: c, animationDelay: `${i * 11}ms` } as CSSProperties}
                  aria-pressed={c === popTopic.color}
                  aria-label={c}
                  onClick={() => recolor(popTopic, c)}
                />
              ))}
            </div>
            <div className="d-tpop-foot">
              <span className="d-tpop-count">
                {counts.topics[popTopic.id] ?? 0} {(counts.topics[popTopic.id] ?? 0) === 1 ? "dump" : "dumps"}
              </span>
              {popTopic.id !== "other" &&
                (confirmDel === popTopic.id ? (
                  <button className="d-tpop-armed" onClick={() => remove(popTopic)} autoFocus>
                    Move {counts.topics[popTopic.id] ?? 0} →
                  </button>
                ) : (
                  <button className="d-tpop-del" onClick={() => remove(popTopic)} aria-label={`Delete ${popTopic.label}`}>
                    Delete
                  </button>
                ))}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
