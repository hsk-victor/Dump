"use client";

import { useState, type CSSProperties } from "react";
import { Dialog } from "@base-ui/react/dialog";
import type { TopicMeta } from "@/lib/taxonomy";

/** Swatch choices: the built-in palette plus a few extras. */
const COLORS = [
  "#3b82f6", "#8b5cf6", "#ec4899", "#f43f5e", "#ef4444", "#f97316", "#facc15", "#eab308",
  "#84cc16", "#22c55e", "#10b981", "#14b8a6", "#06b6d4", "#0ea5e9", "#6366f1", "#a855f7",
  "#b45309", "#78716c", "#64748b", "#a1a1aa",
];

interface Props {
  open: boolean;
  onClose: () => void;
  topics: TopicMeta[];
  /** dumps per topic id, from counts.topics */
  counts: Record<string, number>;
  /** Called with the server's fresh topic list after every mutation. */
  onChange: (topics: TopicMeta[]) => void;
  toast: (text: string, tone?: "info" | "error") => void;
}

async function read(res: Response): Promise<{ topics?: TopicMeta[]; error?: string }> {
  return res.json().catch(() => ({}));
}

function Swatches({ value, onPick }: { value: string; onPick: (c: string) => void }) {
  return (
    <div className="d-cat-swatches" role="listbox" aria-label="Color">
      {COLORS.map((c) => (
        <button
          key={c}
          className="d-cat-swatch"
          style={{ background: c } as CSSProperties}
          aria-pressed={c === value}
          aria-label={c}
          onClick={() => onPick(c)}
        />
      ))}
    </div>
  );
}

export default function CategoryManager({ open, onClose, topics, counts, onChange, toast }: Props) {
  const [colorRow, setColorRow] = useState<string | null>(null); // topic id (or "new") picking a color
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState<string | null>(null);

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

  /** Returns the label as saved, or null when the rename failed. */
  async function rename(t: TopicMeta, label: string): Promise<string | null> {
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
    setColorRow(null);
    if (color !== t.color) await patch(t.id, { color });
  }

  async function describe(t: TopicMeta, description: string) {
    if (description.trim() === (t.description ?? "")) return true;
    return !!(await patch(t.id, { description }));
  }

  async function remove(t: TopicMeta) {
    const n = counts[t.id] ?? 0;
    // Non-empty categories take two clicks: the first spells out where its dumps go.
    if (n > 0 && confirmDel !== t.id) {
      setConfirmDel(t.id);
      return;
    }
    setConfirmDel(null);
    const res = await fetch(`/api/topics/${t.id}`, { method: "DELETE" });
    const data = await read(res);
    if (!res.ok) return toast(data.error ?? "Couldn't delete that", "error");
    onChange(data.topics!);
    toast(n ? `${t.label} deleted — ${n} ${n === 1 ? "dump" : "dumps"} moved to Everything else` : `${t.label} deleted`);
  }

  async function create() {
    const label = newName.trim();
    if (!label) return toast("Categories need a name", "error");
    const res = await fetch("/api/topics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label, color: newColor ?? undefined }),
    });
    const data = await read(res);
    if (!res.ok) return toast(data.error ?? "Couldn't add that", "error");
    onChange(data.topics!);
    setNewName("");
    setNewColor(null);
    setColorRow(null);
    toast(`${label} added — the sorter will use it from now on`);
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="d-dlg-back" />
        <Dialog.Popup className="d-dlg">
          <div className="d-dlg-head">
            <Dialog.Title className="d-dlg-title">Categories</Dialog.Title>
            <Dialog.Close className="d-icon-btn d-dlg-close" aria-label="Close">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </Dialog.Close>
          </div>
          <p className="d-dlg-hint">
            Rename or recolor a category any time — dumps keep their filing. The hint line tells the sorter what belongs;
            new categories join auto-sorting straight away.
          </p>
          <div className="d-cat-list">
            {topics.map((t) => {
              const n = counts[t.id] ?? 0;
              const deleting = confirmDel === t.id;
              return (
                <div className="d-cat" key={t.id}>
                  <div className="d-cat-main">
                    <button
                      className="d-cat-dot"
                      style={{ background: t.color }}
                      aria-label={`Color for ${t.label}`}
                      aria-expanded={colorRow === t.id}
                      onClick={() => setColorRow(colorRow === t.id ? null : t.id)}
                    />
                    <input
                      className="d-cat-name"
                      defaultValue={t.label}
                      aria-label={`Name for ${t.label}`}
                      maxLength={60}
                      onBlur={(e) => {
                        const el = e.currentTarget;
                        if (el.value.trim() === t.label) return;
                        // Write back what the server saved (or revert on failure): the input is
                        // uncontrolled, so a plain defaultValue update wouldn't reach it.
                        void rename(t, el.value).then((saved) => {
                          el.value = saved ?? t.label;
                        });
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                        if (e.key === "Escape") {
                          // Revert, don't dismiss: Escape means "undo this edit" inside a field.
                          e.stopPropagation();
                          e.currentTarget.value = t.label;
                          e.currentTarget.blur();
                        }
                      }}
                    />
                    {n > 0 && <span className="d-cat-count">{n}</span>}
                    {t.id !== "other" &&
                      (deleting ? (
                        <button className="d-cat-confirm" onClick={() => remove(t)} onBlur={() => setConfirmDel(null)} autoFocus>
                          Move {n} →
                        </button>
                      ) : (
                        <button className="d-cat-del" aria-label={`Delete ${t.label}`} title={`Delete ${t.label}`} onClick={() => remove(t)}>
                          ×
                        </button>
                      ))}
                  </div>
                  <input
                    className="d-cat-desc"
                    defaultValue={t.description ?? ""}
                    placeholder={t.id === "other" ? "Fits none of the other topics." : "What belongs here — guides auto-sorting"}
                    aria-label={`Sorting hint for ${t.label}`}
                    maxLength={300}
                    onBlur={(e) => {
                      const el = e.currentTarget;
                      void describe(t, el.value).then((ok) => {
                        if (!ok) el.value = t.description ?? "";
                      });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                      if (e.key === "Escape") {
                        e.stopPropagation();
                        e.currentTarget.value = t.description ?? "";
                        e.currentTarget.blur();
                      }
                    }}
                  />
                  {colorRow === t.id && <Swatches value={t.color} onPick={(c) => recolor(t, c)} />}
                </div>
              );
            })}
            <div className="d-cat d-cat-new">
              <div className="d-cat-main">
                <button
                  className="d-cat-dot d-cat-dot-new"
                  style={{ background: newColor ?? "transparent" }}
                  aria-label="Color for the new category"
                  aria-expanded={colorRow === "new"}
                  onClick={() => setColorRow(colorRow === "new" ? null : "new")}
                />
                <input
                  className="d-cat-name"
                  placeholder="New category…"
                  aria-label="New category name"
                  value={newName}
                  maxLength={60}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && create()}
                />
                <button className="d-ghost-btn d-cat-add" disabled={!newName.trim()} onClick={create}>
                  Add
                </button>
              </div>
              {colorRow === "new" && <Swatches value={newColor ?? ""} onPick={(c) => { setNewColor(c); setColorRow(null); }} />}
            </div>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
