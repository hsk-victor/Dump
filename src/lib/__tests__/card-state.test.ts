import { describe, expect, it } from "vitest";
import type { Dump } from "../db";
import { cardState, LOADING_DEADLINE_MS, STILL_LOADING_MS } from "../card-state";

const NOW = 1_800_000_000_000;

function dump(over: Partial<Dump> = {}): Dump {
  return {
    mediaArchive: {}, keepVideo: false,
    id: "d", kind: "link", topic: "other", status: "ready", sourceState: null, url: "https://example.com/a", domain: "example.com",
    provider: null, title: "A page", description: null, content: null, note: null, imageUrl: null, imageUrls: [], siteName: null,
    author: null, authorHandle: null, authorAvatarUrl: null, videoUrl: null, videoPosterUrl: null, videoType: null, xRender: null,
    summary: null, subject: null, tags: [], classifiedBy: "rules", topicLocked: false, pinned: false, position: 1,
    createdAt: NOW, updatedAt: NOW, ...over,
  };
}

describe("cardState", () => {
  it("is quiet for a saved card", () => {
    expect(cardState(dump(), NOW)).toEqual({ loading: null, unavailable: null, failed: null, posterOnly: false });
  });

  it("waits 300ms before labelling a load, then says still after 10s", () => {
    expect(cardState(dump({ status: "processing" }), NOW + 100).loading).toEqual({ label: "Getting preview…", showLabel: false });
    expect(cardState(dump({ status: "processing" }), NOW + 400).loading).toEqual({ label: "Getting preview…", showLabel: true });
    expect(cardState(dump({ status: "processing" }), NOW + STILL_LOADING_MS).loading?.label).toBe("Still getting preview…");
  });

  it("turns a load past the 30s deadline into a retryable failure", () => {
    const s = cardState(dump({ status: "processing" }), NOW + LOADING_DEADLINE_MS);
    expect(s.loading).toBeNull();
    expect(s.failed).toEqual({ label: "Couldn't get preview", action: "Retry getting preview" });
  });

  it("never reads a failed fetch as a removed original", () => {
    const s = cardState(dump({ status: "failed", sourceState: "unreachable" }), NOW);
    expect(s.unavailable).toBeNull();
    expect(s.failed?.label).toBe("Couldn't get preview");
    expect(cardState(dump({ status: "failed" }), NOW, false).failed?.label).toBe("You're offline");
  });

  it("marks a confirmed-gone original unavailable without an error", () => {
    const s = cardState(dump({ sourceState: "unavailable" }), NOW);
    expect(s.unavailable).toEqual({ detail: null });
    expect(s.failed).toBeNull();
  });

  it("keeps the unavailable row and adds the error when both hold", () => {
    const s = cardState(dump({ sourceState: "unavailable", status: "failed" }), NOW);
    expect(s.unavailable).not.toBeNull();
    expect(s.failed).toEqual({ label: "Couldn't check original", action: "Retry checking original" });
  });

  it("says what a gone video or song kept", () => {
    expect(cardState(dump({ kind: "video", sourceState: "unavailable", videoUrl: "https://cdn/x.mp4" }), NOW)).toMatchObject({
      unavailable: { detail: "Video not saved" },
      posterOnly: true,
    });
    expect(cardState(dump({ kind: "video", sourceState: "unavailable", videoUrl: "/api/files/v.mp4" }), NOW)).toMatchObject({
      unavailable: { detail: null },
      posterOnly: false,
    });
    expect(cardState(dump({ kind: "post", provider: "x", sourceState: "unavailable", videoUrl: "https://video.twimg.com/v.mp4" }), NOW)).toMatchObject({
      unavailable: { detail: "Video not saved" },
      posterOnly: true,
    });
    expect(cardState(dump({ kind: "audio", sourceState: "unavailable", imageUrl: "/api/files/a.jpg" }), NOW).unavailable?.detail).toBe(
      "Artwork kept · audio not saved",
    );
  });

  it("gives an upload no fetch state", () => {
    expect(cardState(dump({ kind: "image", url: null, status: "failed" }), NOW).failed).toBeNull();
    expect(cardState(dump({ kind: "image", url: null, status: "processing" }), NOW + 500).loading).toBeNull();
  });

  it("never gives a note a source-loss or fetch state", () => {
    const s = cardState(dump({ kind: "note", url: null, sourceState: "unavailable", status: "failed" }), NOW);
    expect(s).toEqual({ loading: null, unavailable: null, failed: null, posterOnly: false });
  });
});
