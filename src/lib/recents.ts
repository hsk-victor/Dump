export interface RecentSource {
  id: string;
  kind: string;
  title: string | null;
  filename: string | null;
  domain: string | null;
}

function clean(value: string | null) {
  return (value ?? "").replace(/[&\p{Cc}\p{Cf}]/gu, "").replace(/\s+/g, " ").trim();
}

export function recentLabel(value: RecentSource) {
  const fallback = value.kind === "note" ? "Note" : value.kind === "image" ? "Image" : "File";
  const label = value.kind === "note" ? "Note" : clean(value.title) || clean(value.filename) || clean(value.domain) || fallback;
  const chars = Array.from(label);
  return chars.length > 48 ? `${chars.slice(0, 47).join("")}…` : label;
}
