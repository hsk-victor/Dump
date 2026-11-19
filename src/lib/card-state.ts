import type { Dump } from "./db";

/** The loading row only appears once a fetch outlasts this, so quick saves never flash it. */
export const LOADING_LABEL_DELAY_MS = 300;
/** After this the row says "Still …" so a slow fetch doesn't read as frozen. */
export const STILL_LOADING_MS = 10_000;
/** The UI's per-attempt deadline: past it a pending fetch shows as a retryable failure. */
export const LOADING_DEADLINE_MS = 30_000;
/** Server-side: a 'processing' row this old with no run in flight is reconciled to failed. */
export const STALE_PROCESSING_MS = 45_000;

export interface CardState {
  /** An operation in flight; `showLabel` is false for its first 300ms. */
  loading: { label: string; showLabel: boolean } | null;
  /** The original is confirmed gone (404/410). Never set for notes or network errors. */
  unavailable: { detail: string | null } | null;
  /** A fetch that failed or timed out; `action` names what Retry does. */
  failed: { label: string; action: string } | null;
  /** Video whose only retained copy is its poster: it can't play anymore. */
  posterOnly: boolean;
}

/** A video file this app stores itself, rather than a remote or proxied stream. */
export function hasLocalVideo(dump: Pick<Dump, "videoUrl"> & Partial<Pick<Dump, "mediaArchive">>): boolean {
  return !!dump.videoUrl && (dump.videoUrl.startsWith("/api/files/") || !!dump.mediaArchive?.[dump.videoUrl]);
}

/** Video dumps, and posts carrying a video (X stores those as kind "post"). */
function isVideo(dump: Pick<Dump, "kind" | "videoUrl">): boolean {
  return dump.kind === "video" || !!dump.videoUrl;
}

function unavailableDetail(dump: Dump): string | null {
  if (isVideo(dump) && !hasLocalVideo(dump)) return "Video not saved";
  if (dump.kind === "audio") return dump.imageUrl ? "Artwork kept · audio not saved" : "Audio not saved";
  return null;
}

/**
 * Which exception rows a card shows. Saved is the quiet default: all fields null.
 * A dead source and a failed fetch are separate facts and can both hold at once.
 */
export function cardState(dump: Dump, now: number, online = true): CardState {
  const state: CardState = { loading: null, unavailable: null, failed: null, posterOnly: false };
  // Notes are user-authored: no original to lose and no preview to fetch. Background
  // classification never blocks or fails them.
  // Uploads have no original either: their file is already stored, and a background
  // classification hiccup is not a failed save.
  if (dump.kind === "note" || !dump.url) return state;

  const gone = dump.sourceState === "unavailable";
  if (gone) {
    state.unavailable = { detail: unavailableDetail(dump) };
    state.posterOnly = isVideo(dump) && !hasLocalVideo(dump);
  }

  if (dump.status === "processing") {
    const age = Math.max(0, now - dump.updatedAt);
    if (age < LOADING_DEADLINE_MS) {
      const still = age >= STILL_LOADING_MS;
      const label = gone ? (still ? "Still checking original…" : "Checking original…") : still ? "Still getting preview…" : "Getting preview…";
      state.loading = { label, showLabel: age >= LOADING_LABEL_DELAY_MS };
      return state;
    }
  } else if (dump.status !== "failed") {
    return state;
  }

  // Failed, or pending past the deadline.
  state.failed = {
    label: online ? (gone ? "Couldn't check original" : "Couldn't get preview") : "You're offline",
    action: gone ? "Retry checking original" : "Retry getting preview",
  };
  return state;
}
