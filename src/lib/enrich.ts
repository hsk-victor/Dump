import { classifyHeuristic } from "./classify";
import { commitEnrichment, getDump, listResortable, listTopics, type Dump } from "./db";
import { extractUrl } from "./extract";
import { archiveDump } from "./archive";
import { renderXPostImage } from "./x-render";
import { providerFromUrl, titleFromUrl } from "./detect";
import { classifyWithAi, identifySubject } from "./llm";
import { SUBJECT_MIN_CONFIDENCE, type Subject } from "./taxonomy";

function truncate(s: string | null | undefined, n: number, preserveLines = false) {
  if (!s) return null;
  const clean = s.replace(preserveLines ? /[^\S\n]+/g : /\s+/g, " ").trim();
  return clean.length > n ? `${clean.slice(0, n - 1).trimEnd()}…` : clean;
}

export function noteTitle(text: string): string {
  const firstLine = text.split("\n").find((l) => l.trim()) ?? text;
  return truncate(firstLine, 80) ?? "Note";
}

/** A subject the model is sure enough about to name on the card. */
function trusted(subject: Subject | null | undefined): Subject | null {
  return subject && (subject.confidence ?? 0) >= SUBJECT_MIN_CONFIDENCE ? subject : null;
}

/** Topic from Jev when configured (rules as the fallback); tags always come from the rules. */
async function classify(input: Dump, useImage: boolean): Promise<Partial<Dump>> {
  const subject = trusted(input.subject);
  // The identified subject feeds Jev's state, and its description feeds the rules so
  // image-only dumps (no other text) still get tags.
  const forAI = { ...input, subject, description: input.description ?? subject?.description ?? null };
  const topics = listTopics();
  const ai = await classifyWithAi({ ...forAI, useImage }, topics);
  const rules = classifyHeuristic(forAI, ai?.topic, topics);
  return { topic: rules.topic, tags: rules.tags, classifiedBy: ai ? "ai" : "rules" };
}

/** Clips and images are worth a second pass to name what they're about. */
function needsIdentify(d: Pick<Dump, "kind" | "domain">): boolean {
  return d.kind === "image" || d.kind === "video" || /(^|\.)(instagram|tiktok)\.com$/.test(d.domain ?? "");
}

/** Enrichment runs queue per dump, so a run that read the row before new data landed
 * can't race a later one and overwrite it finishing last. */
const enrichTail = new Map<string, Promise<unknown>>();

/** Whether an enrichment or render run for this dump is queued or running in this process. */
export function isEnriching(id: string): boolean {
  return enrichTail.has(id);
}

/**
 * Fills in a freshly saved dump: fetch metadata for links, then file it under a topic.
 * Runs in the background after the dump has already been saved and shown to the user.
 */
export function enrichDump(id: string): Promise<Dump | null> {
  const prev = enrichTail.get(id) ?? Promise.resolve();
  const job = prev.then(async () => {
    const dump = await runEnrich(id);
    void archiveDump(id).catch(() => {});
    return dump;
  });
  const tail = job.then(
    () => { if (enrichTail.get(id) === tail) enrichTail.delete(id); },
    () => { if (enrichTail.get(id) === tail) enrichTail.delete(id); },
  );
  enrichTail.set(id, tail);
  return job;
}

/**
 * Re-renders an existing X save's snapshot without touching its other fields —
 * full enrichment is deliberately not re-run: re-extracting a post that has
 * since been deleted would erase the archived text. The feed handler parks the
 * row in 'processing' first so an open feed polls for the new image; the
 * original status is restored whether the render succeeds or not.
 */
export function refreshXRender(id: string, restoreStatus: Dump["status"]): Promise<Dump | null> {
  const prev = enrichTail.get(id) ?? Promise.resolve();
  const job = prev.then(async () => {
    const dump = getDump(id);
    if (!dump?.url) return null;
    const xRender = await renderXPostImage(dump.url).catch(() => null);
    // A failed render keeps whatever the row had — restoring status is the whole commit.
    return commitEnrichment(id, xRender ? { xRender, status: restoreStatus } : { status: restoreStatus }, dump);
  });
  const tail = job.then(
    () => { if (enrichTail.get(id) === tail) enrichTail.delete(id); },
    () => { if (enrichTail.get(id) === tail) enrichTail.delete(id); },
  );
  enrichTail.set(id, tail);
  return job;
}

async function runEnrich(id: string): Promise<Dump | null> {
  const dump = getDump(id);
  if (!dump) return null;

  try {
    let fields: Partial<Dump> = {};
    let unreachable = false;
    if (dump.url) {
      const ex = await extractUrl(dump.url);
      unreachable = ex.unreachable;
      if (ex.gone) {
        // The original is confirmed gone: what was already saved is all there is now, so
        // keep every retained field and only record the loss. A never-filed dump still gets
        // a topic from what it has.
        // Item metadata that did arrive (e.g. oEmbed) only fills fields still empty; it never
        // overwrites a saved snapshot. The URL-derived words stay searchable without
        // becoming the stored title, so a later successful fetch can still supply one.
        const kept: Partial<Dump> = {};
        const fill = <K extends keyof Dump>(key: K, value: Dump[K] | null | undefined) => {
          const had = dump[key];
          const empty = had == null || (Array.isArray(had) && !had.length);
          const has = value != null && !(Array.isArray(value) && !value.length);
          if (empty && has) kept[key] = value as Dump[K];
        };
        fill("title", truncate(ex.title, 300));
        fill("description", truncate(ex.description, 1000));
        fill("imageUrl", ex.imageUrl);
        fill("imageUrls", ex.imageUrls);
        fill("siteName", ex.siteName);
        fill("author", ex.author);
        fill("authorHandle", ex.authorHandle);
        fill("authorAvatarUrl", ex.authorAvatarUrl);
        fill("videoPosterUrl", ex.videoPosterUrl);
        const title = kept.title ?? dump.title;
        fill("content", title ? ex.content : [titleFromUrl(dump.url), ex.content].filter(Boolean).join("\n") || null);
        const merged = { ...dump, ...kept };
        const filed = dump.classifiedBy ? null : classifyHeuristic({ ...merged, title: merged.title ?? titleFromUrl(dump.url) });
        const cls: Partial<Dump> = filed ? { topic: filed.topic, tags: filed.tags, classifiedBy: "rules" } : {};
        return commitEnrichment(id, { ...kept, ...cls, sourceState: "unavailable", status: "ready" }, dump);
      }
      const title = dump.title ?? truncate(ex.title, 300);
      // Only user-supplied or fetched titles are stored, so a later retry can always fill one in.
      // Without one, the card shows the URL-derived title and its words go into `content` to stay searchable.
      fields = {
        kind: ex.kind,
        provider: providerFromUrl(dump.url),
        title,
        // A bookmarklet-sent og:description/og:image survives a page fetch that got nothing.
        description: truncate(ex.description, 1000, providerFromUrl(dump.url) === "x") ?? dump.description,
        content: title ? ex.content : [titleFromUrl(dump.url), ex.content].filter(Boolean).join("\n") || null,
        imageUrl: ex.imageUrl ?? dump.imageUrl,
        imageUrls: ex.imageUrls.length ? ex.imageUrls : dump.imageUrls,
        siteName: ex.siteName,
        author: ex.author,
        authorHandle: ex.authorHandle ?? dump.authorHandle,
        authorAvatarUrl: ex.authorAvatarUrl ?? dump.authorAvatarUrl,
        videoUrl: ex.videoUrl !== undefined ? ex.videoUrl : dump.videoUrl,
        videoPosterUrl: ex.videoPosterUrl ?? dump.videoPosterUrl,
        videoType: ex.videoType !== undefined ? ex.videoType : dump.videoType,
        sourceState: unreachable ? "unreachable" : "reachable",
      };
      if (unreachable) {
        // A fetch that got no response says nothing new: it only fills fields still empty,
        // so a failed re-check never erases a saved copy, and a known-gone original stays gone.
        for (const key of Object.keys(fields) as (keyof Dump)[]) {
          const had = dump[key];
          if (had != null && !(Array.isArray(had) && !had.length)) delete fields[key];
        }
        fields.sourceState = dump.sourceState === "unavailable" ? "unavailable" : "unreachable";
      }
      // The native-look render is a snapshot: a failed render keeps any older
      // one. Posts with media show the media itself, so the render is only
      // worth generating for text-only posts.
      if (fields.provider === "x" && !fields.imageUrls?.length && !fields.imageUrl && !fields.videoUrl) {
        const xRender = await renderXPostImage(dump.url).catch(() => null);
        if (xRender) fields.xRender = xRender;
      }
    }
    // A re-check that reached nothing has no new data to file by: a dump that was already
    // filed keeps its topic.
    if (unreachable && dump.classifiedBy) return commitEnrichment(id, { ...fields, status: "failed" }, dump);
    const merged = { ...dump, ...fields };

    // Clips/images get a second pass to name what they're about, before the topic is decided,
    // so the card can say "Severance (2022) · TV series" and Jev can file it under Movies & TV.
    const subject = needsIdentify(merged)
      ? await identifySubject({ ...merged, title: merged.title ?? (dump.url ? titleFromUrl(dump.url) : null) })
      : null;
    if (subject) {
      fields.subject = merged.subject = subject;
      if (trusted(subject)) {
        fields.title = merged.title = subject.name;
        if (subject.description) fields.summary = merged.summary = subject.description;
      }
    }

    const forClassifying = { ...merged, title: merged.title ?? (dump.url ? titleFromUrl(dump.url) : null) };

    const classification = await classify(forClassifying, merged.kind === "image");
    // Couldn't reach the site at all: keep the fallback topic but mark it failed so it can be retried.
    return commitEnrichment(id, { ...fields, ...classification, status: unreachable ? "failed" : "ready" }, dump);
  } catch (err) {
    console.warn(`[dump] enrich failed for ${id}:`, (err as Error).message);
    const rules = classifyHeuristic({ ...dump, title: dump.title ?? (dump.url ? titleFromUrl(dump.url) : null) });
    return commitEnrichment(id, { status: "failed", topic: rules.topic, classifiedBy: "rules", tags: rules.tags }, dump);
  }
}

/** Re-files a dump from what's already stored, without fetching it again. Null if Jev couldn't answer. */
export async function resortDump(id: string): Promise<{ before: string; after: string } | null> {
  const dump = getDump(id);
  // Re-check status here too: listResortable's snapshot can predate a reprocess.
  if (!dump || dump.topicLocked || dump.status === "processing") return null;
  const classification = await classify({ ...dump, title: dump.title ?? (dump.url ? titleFromUrl(dump.url) : null) }, dump.kind === "image");
  if (classification.classifiedBy !== "ai") return null;
  const out = commitEnrichment(id, classification, dump);
  return out ? { before: dump.topic, after: out.topic } : null;
}

/** Re-files every dump the user hasn't filed by hand. */
export async function resortAll(concurrency = 6): Promise<{ sorted: number; moved: number; failed: number }> {
  const ids = listResortable();
  let next = 0;
  const totals = { sorted: 0, moved: 0, failed: 0 };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, ids.length) }, async () => {
      while (next < ids.length) {
        const result = await resortDump(ids[next++]);
        if (!result) totals.failed++;
        else {
          totals.sorted++;
          if (result.before !== result.after) totals.moved++;
        }
      }
    }),
  );
  return totals;
}
