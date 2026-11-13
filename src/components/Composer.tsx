"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  onDump: (input: { text: string; file: File | null }) => Promise<boolean>;
}

export default function Composer({ onDump }: Props) {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!file) return setPreview(null);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Press "/" or "n" anywhere to jump to the dump box; drop images anywhere on the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "n" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) {
        e.preventDefault();
        setDragging(true);
      }
    };
    const onDragLeave = (e: DragEvent) => {
      if (!e.relatedTarget) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      setDragging(false);
      const f = e.dataTransfer?.files?.[0];
      if (f) {
        e.preventDefault();
        if (f.type.startsWith("image/")) setFile(f);
        inputRef.current?.focus();
        return;
      }
      const uri = e.dataTransfer?.getData("text/uri-list") || e.dataTransfer?.getData("text/plain");
      if (uri) {
        e.preventDefault();
        setText((t) => (t ? `${t} ${uri}` : uri));
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  async function submit() {
    if (busy || (!text.trim() && !file)) return;
    setBusy(true);
    const ok = await onDump({ text: text.trim(), file });
    setBusy(false);
    if (ok) {
      setText("");
      setFile(null);
      inputRef.current?.focus();
    }
  }

  return (
    <>
      <div className="d-dock" data-dragging={dragging || undefined}>
        {preview ? (
          <div className="relative shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="Image to dump" className="h-9 w-9 rounded-lg object-cover" />
            <button
              type="button"
              onClick={() => setFile(null)}
              className="absolute -top-1.5 -right-1.5 grid h-4.5 w-4.5 place-items-center rounded-full bg-black text-[10px] text-white"
              aria-label="Remove image"
            >
              ×
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => fileRef.current?.click()} className="d-dock-icon" aria-label="Add image" title="Add image">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp,image/avif"
          className="hidden"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            e.target.value = "";
          }}
        />
        <textarea
          ref={inputRef}
          autoFocus
          rows={text.includes("\n") ? 3 : 1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          onPaste={(e) => {
            const img = [...e.clipboardData.files].find((f) => f.type.startsWith("image/"));
            if (img) {
              e.preventDefault();
              setFile(img);
            }
          }}
          placeholder="Dump a link, post, image or note…"
          aria-label="Dump something"
          className="d-dock-input"
        />
        <kbd className="d-dock-kbd">N</kbd>
        <button type="button" onClick={submit} disabled={busy || (!text.trim() && !file)} className="d-dock-btn">
          {busy ? "Dumping…" : "Dump"}
        </button>
      </div>
      {dragging && (
        <div className="d-drop">
          <span>Drop to dump</span>
        </div>
      )}
    </>
  );
}
