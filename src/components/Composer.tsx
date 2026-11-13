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
    <div
      className={`relative rounded-2xl border bg-white shadow-sm transition ${
        dragging ? "border-stone-900 ring-4 ring-stone-900/10" : "border-stone-200 focus-within:border-stone-400"
      }`}
    >
      <textarea
        ref={inputRef}
        autoFocus
        rows={text.includes("\n") ? 4 : 2}
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
        placeholder="Dump anything: paste a link, an X post, a video, an image, or just type a note…"
        aria-label="Dump something"
        className="block w-full resize-none rounded-2xl bg-transparent px-5 pt-4 pb-2 text-[15px] leading-relaxed outline-none placeholder:text-stone-400"
      />
      <div className="flex items-center gap-3 px-3 pb-3">
        {preview ? (
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="Image to dump" className="h-12 w-12 rounded-lg object-cover ring-1 ring-stone-200" />
            <button
              type="button"
              onClick={() => setFile(null)}
              className="absolute -top-1.5 -right-1.5 grid h-5 w-5 place-items-center rounded-full bg-stone-900 text-[11px] text-white"
              aria-label="Remove image"
            >
              ×
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="rounded-lg px-2.5 py-1.5 text-sm text-stone-500 hover:bg-stone-100 hover:text-stone-800"
          >
            + Image
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp,image/avif"
          className="hidden"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <span className="hidden text-xs text-stone-400 sm:inline">Enter to dump · Shift+Enter for a new line · paste or drop images</span>
        <button
          type="button"
          onClick={submit}
          disabled={busy || (!text.trim() && !file)}
          className="ml-auto rounded-xl bg-stone-900 px-5 py-2 text-sm font-medium text-white transition hover:bg-stone-700 disabled:cursor-not-allowed disabled:bg-stone-300"
        >
          {busy ? "Dumping…" : "Dump it"}
        </button>
      </div>
      {dragging && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center rounded-2xl bg-white/80 text-sm font-medium">
          Drop to dump
        </div>
      )}
    </div>
  );
}
