export interface CaptureDraft { text: string; file: File | null }

export function canSubmit(draft: CaptureDraft, writing: boolean) {
  return !writing && Boolean(draft.text.trim() || draft.file);
}

export function submitsEditor(event: { key: string; shiftKey: boolean; isComposing: boolean; keyCode: number }) {
  return event.key === "Enter" && !event.shiftKey && !event.isComposing && event.keyCode !== 229;
}

export function extractDropUrl(value: string): string | null {
  const lines = value.split(/\r?\n/).filter((line) => !line.trim().startsWith("#")).join(" ");
  const matches = lines.match(/[a-z][a-z0-9+.-]*:[^\s<>"']+/gi) ?? [];
  if (matches.length !== 1) return null;
  try {
    const url = new URL(matches[0]);
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname ? url.href : null;
  } catch { return null; }
}

export function fileError(file: File): string | null {
  if (file.type === "inode/directory" || file.type === "application/x-directory" || /[/\\]/.test(file.name)) return "Folders can’t be dumped. Choose a file instead.";
  if (file.size > 15 * 1024 * 1024) return "File is larger than 15 MB.";
  return null;
}

export function dragOverError(data: Pick<DataTransfer, "files" | "items" | "types">): string | null {
  const files = Array.from(data.files);
  const items = Array.from(data.items).filter((item) => item.kind === "file");
  if (files.length > 1 || items.length > 1) return "Dump one item at a time.";
  if (items.some((item) => item.webkitGetAsEntry?.()?.isDirectory || item.type === "inode/directory" || item.type === "application/x-directory")) return "Folders can’t be dumped. Choose a file instead.";
  const file = files[0] ?? items[0]?.getAsFile?.();
  if (file) return fileError(file);
  return items.length || Array.from(data.types).some((type) => ["Files", "text/plain", "text/uri-list"].includes(type)) ? null : "Drop one HTTP or HTTPS link, image or file.";
}

export function selectDrop(data: Pick<DataTransfer, "files" | "items" | "getData">): CaptureDraft | { error: string } {
  const items = Array.from(data.items);
  if (items.some((item) => item.kind === "file" && item.webkitGetAsEntry?.()?.isDirectory)) return { error: "Folders can’t be dumped. Choose a file instead." };
  const files = Array.from(data.files);
  if (files.length > 1 || items.filter((item) => item.kind === "file").length > 1) return { error: "Dump one item at a time." };
  if (files.length) {
    const error = fileError(files[0]);
    return error ? { error } : { text: "", file: files[0] };
  }
  const text = extractDropUrl(data.getData("text/uri-list") || data.getData("text/plain"));
  return text ? { text, file: null } : { error: "Drop one HTTP or HTTPS link, image or file." };
}
