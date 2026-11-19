import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { Dump } from "@/lib/db";
import DumpCard, { notePreview } from "./DumpCard";

const title = "Mobile reminder: book a train to Kyoto this weekend";
const note: Dump = {
  id: "note",
  kind: "note",
  topic: "other",
  status: "ready",
  sourceState: null,
  url: null,
  domain: null,
  provider: null,
  title,
  description: null,
  content: title,
  note: null,
  imageUrl: null,
  imageUrls: [],
  siteName: null,
  author: null,
  authorHandle: null,
  authorAvatarUrl: null,
  videoUrl: null,
  videoPosterUrl: null,
  videoType: null,
  xRender: null,
  summary: null,
  subject: null,
  tags: [],
  classifiedBy: "rules",
  topicLocked: false,
  pinned: false,
  position: 1,
  createdAt: Date.UTC(2026, 0, 1),
  updatedAt: Date.UTC(2026, 0, 1),
};

it.each([
  ["short", title],
  ["long", [title, ...Array.from({ length: 12 }, (_, i) => `Itinerary item ${i + 1}`)].join("\n")],
])("renders the complete %s note in the card body without opening Edit", (_, content) => {
  const html = renderToStaticMarkup(createElement(DumpCard, {
    dump: { ...note, content },
    onTopic: vi.fn(),
    onDelete: vi.fn(),
    onRetry: vi.fn(),
    onPin: vi.fn(),
    onSaveNote: vi.fn(),
    topics: [],
  }));

  expect(html).toContain(`<p class="d-note-lines" dir="auto" title="Click to edit">${content}</p>`);
  expect(html.split(title)).toHaveLength(2);
  expect(html).not.toContain("<textarea");
});

it("keeps short notes intact and offers a reading control for long notes in a narrow window", () => {
  const content = Array.from({ length: 16 }, (_, i) => `Observation ${i + 1}: Save things you want to revisit later.`).join("\n");
  const render = (body: string) => renderToStaticMarkup(createElement(DumpCard, {
    dump: { ...note, content: body },
    phone: true,
    onTopic: vi.fn(),
    onDelete: vi.fn(),
    onRetry: vi.fn(),
    onPin: vi.fn(),
    onSaveNote: vi.fn(),
    topics: [],
  }));
  expect(notePreview(title)).toBe(title);
  expect(render(title)).not.toContain("Read more");
  const long = render(content);
  expect(long).toContain(`<p class="d-note-lines" dir="auto">${notePreview(content)}</p>`);
  expect(long).toContain('aria-expanded="false">Read more</button>');
  expect(long).not.toContain("<textarea");
});

const link: Dump = {
  ...note,
  id: "link",
  kind: "article",
  url: "https://example.com/story",
  domain: "example.com",
  title: "Coastal study",
  content: null,
  description: "Tide pools at dawn",
};
const card = (dump: Dump, phone = false) =>
  renderToStaticMarkup(createElement(DumpCard, { dump, phone, onTopic: vi.fn(), onDelete: vi.fn(), onRetry: vi.fn(), onPin: vi.fn(), onSaveNote: vi.fn(), topics: [] }));

it("draws a saved card with no state row or badge", () => {
  const html = card(link);
  expect(html).not.toContain("d-state");
  expect(html).toContain('href="https://example.com/story"');
});

it("keeps a gone original's content, drops its dead link and says Original unavailable", () => {
  const html = card({ ...link, sourceState: "unavailable" });
  expect(html).toContain("Original unavailable");
  expect(html).toContain("Coastal study");
  expect(html).toContain("Tide pools at dawn");
  expect(html).not.toContain('href="https://example.com/story"');
  expect(html).not.toContain("d-state-failed");
});

it("shows a failed fetch as an error row with a named Retry, never as removed", () => {
  const html = card({ ...link, status: "failed", sourceState: "unreachable" });
  expect(html).toContain("Couldn&#x27;t get preview");
  expect(html).toContain('aria-label="Retry getting preview, Coastal study"');
  expect(html).not.toContain("Original unavailable");
  expect(html).toContain("Coastal study");
});

it("keeps the topic visible while a preview loads", () => {
  const html = card({ ...link, status: "processing", updatedAt: Date.now() });
  expect(html).toContain("d-topic-chip");
  expect(html).not.toContain("Sorting");
});

it("gives a gone poster-only video no play button", () => {
  const html = card({ ...link, kind: "video", provider: "tiktok", imageUrl: "/api/files/poster.jpg", imageUrls: ["/api/files/poster.jpg"], sourceState: "unavailable" });
  expect(html).toContain("Preview only");
  expect(html).toContain("Video not saved");
  expect(html).not.toContain('class="d-play"');
});

it("never shows source loss on a note", () => {
  const html = card({ ...note, sourceState: "unavailable", status: "failed" });
  expect(html).not.toContain("d-state");
});

it("keeps a gone card's saved text in the narrow layout", () => {
  const html = card({ ...link, sourceState: "unavailable" }, true);
  expect(html).toContain("Tide pools at dawn");
  expect(html).toContain("Original unavailable");
});

it("renders desktop actions in their own row outside card content", () => {
  const html = renderToStaticMarkup(createElement(DumpCard, {
    dump: note,
    onTopic: vi.fn(),
    onDelete: vi.fn(),
    onRetry: vi.fn(),
    onPin: vi.fn(),
    onSaveNote: vi.fn(),
    topics: [],
  }));

  expect(html).toContain('<div class="d-card-shell"><article');
  expect(html).toContain('</article><div class="d-actions">');
});

it("keeps a failed title-only post's author in the narrow layout", () => {
  const post: Dump = { ...link, kind: "post", provider: "bluesky", url: "https://bsky.app/profile/nadia/post/1", domain: "bsky.app", title: "Morning thread", author: "nadia.bsky.social", description: null, status: "failed", sourceState: "unreachable" };
  const html = card(post, true);
  expect(html).toContain("nadia.bsky.social");
  expect(html).toContain("Couldn&#x27;t get preview");
  expect(html).not.toContain("Open original");
});

it("draws audio as a way out to its service, never a pretend player", () => {
  const song: Dump = { ...link, kind: "audio", provider: "spotify", url: "https://open.spotify.com/track/1", domain: "open.spotify.com", title: "Night Drive", author: "Lumen Avenue", imageUrl: "/api/files/a.jpg", imageUrls: ["/api/files/a.jpg"] };
  const live = card(song);
  expect(live).toContain("Open in Spotify");
  expect(live).not.toContain("d-mus-transport");
  expect(live).not.toContain("d-mus-prog");
  const gone = card({ ...song, sourceState: "unavailable" });
  expect(gone).not.toContain("Open in Spotify");
  expect(gone).toContain("Artwork kept · audio not saved");
});

it("puts an exception's status inside the in-flow footer on desktop media cards, above topic/date", () => {
  const repo: Dump = { ...link, kind: "link", provider: "github", url: "https://github.com/acme/tidepool", domain: "github.com", title: "acme/tidepool", imageUrl: "/api/files/og.jpg", imageUrls: ["/api/files/og.jpg"], sourceState: "unavailable" };
  const html = card(repo);
  expect(html).toContain('data-exception="true"');
  const panel = html.slice(html.indexOf('class="d-mpanel"'));
  expect(panel.indexOf("Original unavailable")).toBeGreaterThan(-1);
  expect(panel.indexOf("Original unavailable")).toBeLessThan(panel.indexOf('class="d-meta"'));
});
