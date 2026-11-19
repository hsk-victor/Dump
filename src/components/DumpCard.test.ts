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
