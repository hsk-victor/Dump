"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { type TopicMeta } from "@/lib/taxonomy";

export interface Counts {
  total: number;
  kinds: Record<string, number>;
  topics: Record<string, number>;
}

interface Props {
  phone: boolean;
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

/** Topic tabs, left side of the header. Double-click a tab to rename it in
 *  place; clicking the active tab (or right-click / long-press on any tab)
 *  opens an anchored popover with the dump count and delete. */
export default function SectionNav({ phone, counts, topics: all, topic, onSelect, onChange, toast }: Props) {
  const topics = all.filter((t) => counts.topics[t.id]).sort(
    (a, b) => Number(a.id === "other") - Number(b.id === "other") || (counts.topics[b.id] ?? 0) - (counts.topics[a.id] ?? 0),
  );

  const [renaming, setRenaming] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [pop, setPop] = useState<Pop | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLElement>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A finished long-press still emits a click on release — flag it so the
  // tab's onClick doesn't toggle the filter after the popover opens.
  const heldRef = useRef(false);
  /** The `topic` to restore if a click burst's first click toggled the filter
   *  (undefined = this burst didn't toggle) — lets a double-click undo that
   *  toggle, since the `topic` prop is still stale when dblclick runs. */
  const toggleRestore = useRef<string | null | undefined>(undefined);
  /** Topic id whose popover the current pointerdown just closed — lets the
   *  anchor's click read as "dismiss" instead of reopening the popover. */
  const dismissClick = useRef<string | null>(null);

  const popTopic = pop ? all.find((t) => t.id === pop.id) : null;

  useEffect(() => {
    if (!phone) return;
    const strip = stripRef.current;
    const selected = strip?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!strip || !selected) return;
    const left = selected.offsetLeft;
    const right = left + selected.offsetWidth;
    if (left < strip.scrollLeft) strip.scrollLeft = left;
    else if (right + 16 > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = right + 16 - strip.clientWidth;
  }, [phone, topic, counts, all]);

  function closePop() {
    setPop(null);
    setConfirmDel(null);
  }

  function anchorPop(t: TopicMeta, el: HTMLElement) {
    popAt(t, el.getBoundingClientRect());
  }

  function popAt(t: TopicMeta, r: DOMRect) {
    dismissClick.current = null;
    const left = Math.min(Math.max(8, r.left), window.innerWidth - 160);
    setPop({ id: t.id, left, top: r.bottom + 7, ox: Math.max(14, r.left + r.width / 2 - left) });
    setConfirmDel(null);
  }

  // Outside click / Escape / any scroll closes the popover.
  useEffect(() => {
    if (!pop) return;
    const onDown = (e: PointerEvent) => {
      if (popRef.current?.contains(e.target as Node)) return;
      // A pointerdown on the popover's own tab still emits a click — flag it so
      // onClick doesn't reopen the popover it was just asked to close.
      const tid = (e.target as HTMLElement).closest?.("[data-tid]")?.getAttribute("data-tid");
      if (tid === pop.id) dismissClick.current = tid;
      closePop();
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

  async function create(label: string) {
    const clean = label.trim();
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
  }

  function startHold(t: TopicMeta, el: HTMLElement, e: React.PointerEvent) {
    if (e.pointerType !== "touch") return;
    holdTimer.current = setTimeout(() => {
      heldRef.current = true;
      anchorPop(t, el);
    }, 450);
  }
  function endHold() {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
  }

  return (
    <div className="d-subnav">
      <nav className="d-topics" aria-label="Topics" ref={stripRef}>
        <button className="d-topic" aria-pressed={!topic} onClick={() => onSelect({ topic: null })}>
          All
        </button>
        {topics.map((t) =>
          !phone && renaming === t.id ? (
            // Editing inside the tab itself: the label becomes a live input.
            <div className="d-topic d-topic-edit" key={t.id}>
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
              data-tid={t.id}
              aria-pressed={topic === t.id}
              onClick={(e) => {
                if (phone) {
                  onSelect({ topic: topic === t.id ? null : t.id });
                  return;
                }
                if (e.detail === 1) toggleRestore.current = undefined; // a burst starts
                if (dismissClick.current === t.id) {
                  dismissClick.current = null;
                  return; // pointerdown just closed this tab's popover — a dismiss click
                }
                if (e.detail > 1) return; // second click of a double-click
                if (heldRef.current) {
                  heldRef.current = false;
                  return; // trailing click after a long-press
                }
                // Clicking the active tab opens its popover instead of
                // clearing the filter (use "All" to clear).
                if (topic === t.id && t.id !== "other") {
                  if (pop?.id === t.id) closePop();
                  else anchorPop(t, e.currentTarget);
                  return;
                }
                toggleRestore.current = topic;
                onSelect({ topic: topic === t.id ? null : t.id });
              }}
              onDoubleClick={(e) => {
                if (phone) return;
                e.preventDefault();
                // The first click may have toggled the filter — undo it.
                if (toggleRestore.current !== undefined) {
                  onSelect({ topic: toggleRestore.current });
                  toggleRestore.current = undefined;
                }
                setRenaming(t.id);
              }}
              onContextMenu={(e) => {
                if (phone) return;
                e.preventDefault();
                if (t.id === "other") return;
                anchorPop(t, e.currentTarget);
              }}
              onPointerDown={phone ? undefined : (e) => startHold(t, e.currentTarget, e)}
              onPointerUp={endHold}
              onPointerCancel={endHold}
              onPointerLeave={endHold}
            >
              {t.label}
            </button>
          ),
        )}
        {!phone && (adding ? (
          <div className="d-topic d-topic-edit d-topic-add">
            <input
              className="d-topic-rn"
              placeholder="New category…"
              aria-label="New category name"
              maxLength={60}
              autoFocus
              onBlur={(e) => void create(e.currentTarget.value)}
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
        ))}
      </nav>
      {!phone && popTopic &&
        createPortal(
          <div
            className="d-tpop"
            ref={popRef}
            role="dialog"
            aria-label={`Edit ${popTopic.label}`}
            style={{ left: pop!.left, top: pop!.top, "--ox": `${pop!.ox}px` } as CSSProperties}
          >
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
          </div>,
          document.body,
        )}
    </div>
  );
}
