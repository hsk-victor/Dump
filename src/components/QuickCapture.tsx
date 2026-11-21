"use client";

import { useEffect, useRef, useState } from "react";
import Logo from "./Logo";
import { canSubmit, captureHelper, clipboardMayActivate, dragOverError, fileError, selectDrop, submitsEditor, type CaptureDraft } from "@/lib/capture";
import { captureNative, type ClipboardPayload } from "@/lib/capture-native";
import "./quick-capture.css";

const empty: CaptureDraft = { text: "", file: null };
const ignoreNativeError = () => {};

export default function QuickCapture() {
  const [draft, setDraft] = useState<CaptureDraft>(empty);
  const [writing, setWriting] = useState(false);
  const [delayed, setDelayed] = useState(false);
  const [message, setMessage] = useState("");
  const [dragging, setDragging] = useState(false);
  const [dragWarning, setDragWarning] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const draftRef = useRef(draft);
  const locked = useRef(false);
  const editor = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLElement>(null);
  const dragDepth = useRef(0);
  const interactionGeneration = useRef(0);
  draftRef.current = draft;

  function dismiss() {
    interactionGeneration.current++;
    if (!locked.current) { setDraft(empty); setMessage(""); }
    void captureNative.hide().catch(ignoreNativeError);
  }

  function clearDrag() {
    dragDepth.current = 0;
    setDragging(false);
    setDragWarning("");
  }

  async function save(value: CaptureDraft, separate = false, clipboard?: { startedHidden: boolean; generation: number; action?: number }) {
    if (!canSubmit(value, locked.current)) return;
    const preserve = separate && canSubmit(draftRef.current, false);
    locked.current = true;
    setWriting(true);
    setMessage("");
    void captureNative.writing(true).catch(ignoreNativeError);
    const timer = setTimeout(() => setDelayed(true), 300);
    try {
      const body = value.file ? new FormData() : JSON.stringify({ text: value.text.trim() });
      if (body instanceof FormData) { body.append("file", value.file!); body.append("text", value.text.trim()); }
      const response = await fetch("/api/dumps", { method: "POST", body, ...(!(body instanceof FormData) ? { headers: { "Content-Type": "application/json" } } : {}) });
      if (!response.ok) throw new Error("Save failed");
      void captureNative.saved().catch(ignoreNativeError);
      if (preserve) setMessage("Saved to Dump");
      else { setDraft(empty); void captureNative.hide().catch(ignoreNativeError); }
    } catch {
      if (preserve) setMessage(clipboard ? "Couldn’t save the clipboard. Your draft is still here. Paste or attach it to retry." : "Couldn’t save the drop. Your draft is still here. Drop again to retry.");
      else { setDraft(value); setMessage("Couldn’t save. Your draft is still here."); }
      if (clipboard && clipboardMayActivate(clipboard.startedHidden, clipboard.generation, interactionGeneration.current)) void captureNative.attention(clipboard.action).catch(ignoreNativeError);
    } finally {
      clearTimeout(timer);
      locked.current = false;
      setWriting(false);
      setDelayed(false);
      void captureNative.writing(false).catch(ignoreNativeError);
    }
  }

  function attach(files: File[]) {
    if (locked.current) return;
    if (files.length !== 1) { setMessage("Dump one file at a time."); return; }
    const error = fileError(files[0]);
    if (error) { setMessage(error); return; }
    setDraft((value) => ({ ...value, file: files[0] }));
    setMessage("");
  }

  useEffect(() => {
    editor.current?.focus();
    const resize = new ResizeObserver(() => { void captureNative.resize(Math.ceil(panel.current?.getBoundingClientRect().height ?? 164)).catch(ignoreNativeError); });
    if (panel.current) resize.observe(panel.current);
    return () => resize.disconnect();
  }, []);

  useEffect(() => {
    const input = editor.current;
    if (input) { input.style.height = "0px"; input.style.height = `${Math.min(72, Math.max(24, input.scrollHeight))}px`; }
  }, [draft.text]);

  useEffect(() => {
    if (!draft.file?.type.startsWith("image/")) { setPreview(null); return; }
    const url = URL.createObjectURL(draft.file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [draft.file]);

  useEffect(() => {
    if (!captureNative.available()) return;
    let active = true;
    let pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try {
        const response = await fetch("/api/dumps/recent", { cache: "no-store" });
        if (response.ok && active) await captureNative.recents((await response.json()).items);
      } catch {} finally { pending = false; }
    };
    void captureNative.recents([]).catch(ignoreNativeError);
    void refresh();
    window.addEventListener("dump:recents-refresh", refresh);
    return () => { active = false; window.removeEventListener("dump:recents-refresh", refresh); };
  }, []);

  useEffect(() => {
    const movedOn = () => { interactionGeneration.current++; };
    const focus = () => { movedOn(); editor.current?.focus(); };
    const clipboard = (payload: ClipboardPayload) => {
      const interaction = { startedHidden: payload.startedHidden === true, generation: interactionGeneration.current, action: payload.action };
      const attention = () => {
        if (clipboardMayActivate(interaction.startedHidden, interaction.generation, interactionGeneration.current)) void captureNative.attention(interaction.action).catch(ignoreNativeError);
      };
      if (locked.current) {
        setMessage("A save is in progress. Try Dump clipboard again when it finishes.");
        attention();
        return;
      }
      try {
        const file = payload.file ? new File([Uint8Array.from(atob(payload.file.base64), (c) => c.charCodeAt(0))], payload.file.name, { type: payload.file.type }) : null;
        const value = { text: payload.text ?? "", file };
        const error = file && fileError(file);
        if (error || payload.message || !canSubmit(value, false)) {
          if (canSubmit(value, false)) setDraft(error ? { ...value, file: null } : value);
          setMessage(error || payload.message || "Clipboard is empty or unsupported.");
          attention();
        } else void save(value, true, interaction);
      } catch {
        setMessage("Couldn’t read the clipboard. Paste or attach a file instead.");
        attention();
      }
    };
    const unlisten = captureNative.listen({ focus, open: focus, hidden: movedOn, clipboard });
    const key = (event: KeyboardEvent) => { if (event.key === "Escape" && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); dismiss(); } };
    window.addEventListener("keydown", key);
    window.addEventListener("blur", movedOn);
    window.addEventListener("dragend", clearDrag);
    return () => { unlisten(); window.removeEventListener("keydown", key); window.removeEventListener("blur", movedOn); window.removeEventListener("dragend", clearDrag); };
  }, []);

  return <main ref={panel} className="qc-panel" data-dragging={dragging || undefined}
    onDragEnter={() => { dragDepth.current++; }}
    onDragOver={(event) => {
      event.preventDefault();
      const error = dragOverError(event.dataTransfer);
      event.dataTransfer.dropEffect = error ? "none" : "copy";
      setDragging(!error);
      setDragWarning(error || "");
    }}
    onDragLeave={(event) => {
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
      if (!dragDepth.current || event.relatedTarget) clearDrag();
    }}
    onDragEnd={clearDrag}
    onDrop={(event) => {
      event.preventDefault(); clearDrag();
      if (locked.current) { setMessage("A save is in progress. Drop again when it finishes."); return; }
      const value = selectDrop(event.dataTransfer);
      if ("error" in value) setMessage(value.error); else void save(value, true);
    }}>
    <header><h1><Logo size={22} />Quick capture</h1><button type="button" className="qc-esc" onClick={dismiss} aria-label="Close quick capture">Esc</button></header>
    <div className="qc-editor"><textarea ref={editor} rows={1} aria-label="Paste a link or write a note" placeholder="Paste a link or write a note…" value={draft.text} readOnly={writing}
      onChange={(event) => setDraft((value) => ({ ...value, text: event.target.value }))}
      onKeyDown={(event) => { if (submitsEditor({ ...event, isComposing: event.nativeEvent.isComposing, keyCode: event.nativeEvent.keyCode })) { event.preventDefault(); void save(draft); } }}
      onPaste={(event) => { const images = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/")); if (images.length) { event.preventDefault(); attach(images); } }} /></div>
    {draft.file && <div className="qc-attachment">
      {preview ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview} alt="Attachment preview" />
      ) : <span className="qc-file" aria-hidden>▤</span>}
      <div><strong>{draft.file.name}</strong><small>{draft.file.type.split("/").pop()?.toUpperCase() || "FILE"} · {Math.max(1, Math.round(draft.file.size / 1024))} KB</small></div>
      <button type="button" disabled={writing} onClick={() => setDraft((value) => ({ ...value, file: null }))} aria-label="Remove attachment">×</button>
    </div>}
    <footer><button type="button" className="qc-attach" disabled={writing} onClick={() => picker.current?.click()} aria-label={draft.file ? "Replace attachment" : "Attach a file"} title={draft.file ? "Replace attachment" : "Attach a file"}>+</button>
      <span className="qc-helper" aria-live="polite">{captureHelper(dragging, dragWarning, message)}</span>
      <button type="button" className="qc-submit" disabled={!canSubmit(draft, writing)} onPointerDown={(event) => { event.currentTarget.dataset.pressed = "true"; }} onPointerUp={(event) => { delete event.currentTarget.dataset.pressed; }} onPointerLeave={(event) => { delete event.currentTarget.dataset.pressed; }} onPointerCancel={(event) => { delete event.currentTarget.dataset.pressed; }} onClick={() => void save(draft)}><span aria-live="polite">{delayed ? "Dumping…" : "Dump"}</span><kbd aria-hidden>↵</kbd></button>
    </footer>
    <input ref={picker} type="file" hidden onChange={(event) => { if (event.target.files?.length) attach(Array.from(event.target.files)); event.target.value = ""; }} />
  </main>;
}
