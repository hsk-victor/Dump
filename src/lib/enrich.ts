import { classifyHeuristic } from "./classify";
import { db, getDump, listResortable, updateDump, type Dump } from "./db";
import { extractUrl } from "./extract";
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

/**
 * Writes enrichment results, re-reading the row in the same transaction so a topic the user
 * picked while enrichment was running is never overwritten — and neither is any other field
 * that changed since this run read its snapshot (e.g. a duplicate backfilling bookmarklet
 * metadata, or a user edit). Those fields hold newer data than what this run saw.
 */
function commit(id: string, patch: Partial<Dump>, snapshot?: Dump): Dump | null {
  return db().transaction(() => {
    const current = getDump(id);
    if (!current) return null;
    const { topic, classifiedBy, ...rest } = patch;
    const fields = rest as Partial<Dump>;
    for (const key of Object.keys(fields) as (keyof Dump)[]) {
      if (snapshot && JSON.stringify(current[key] ?? null) !== JSON.stringify(snapshot[key] ?? null)) {
        delete (fields as Record<string, unknown>)[key];
      }
    }
    return updateDump(id, current.topicLocked ? fields : { ...fields, topic, classifiedBy });
  })();
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
  const ai = await classifyWithAi({ ...forAI, useImage });
  const rules = classifyHeuristic(forAI, ai?.topic);
  return { topic: rules.topic, tags: rules.tags, classifiedBy: ai ? "ai" : "rules" };
}

/** Clips and images are worth a second pass to name what they're about. */
function needsIdentify(d: Pick<Dump, "kind" | "domain">): boolean {
  return d.kind === "image" || d.kind === "video" || /(^|\.)(instagram|tiktok)\.com$/.test(d.domain ?? "");
}

/** Enrichment runs queue per dump, so a run that read the row before new data landed
 * can't race a later one and overwrite it finishing last. */
const enrichTail = new Map<string, Promise<unknown>>();

/**
 * Fills in a freshly saved dump: fetch metadata for links, then file it under a topic.
 * Runs in the background after the dump has already been saved and shown to the user.
 */
export function enrichDump(id: string): Promise<Dump | null> {
  const prev = enrichTail.get(id) ?? Promise.resolve();
  const job = prev.then(() => runEnrich(id));
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
      };
    }
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
    return commit(id, { ...fields, ...classification, status: unreachable ? "failed" : "ready" }, dump);
  } catch (err) {
    console.warn(`[dump] enrich failed for ${id}:`, (err as Error).message);
    const rules = classifyHeuristic({ ...dump, title: dump.title ?? (dump.url ? titleFromUrl(dump.url) : null) });
    return commit(id, { status: "failed", topic: rules.topic, classifiedBy: "rules", tags: rules.tags }, dump);
  }
}

/** Re-files a dump from what's already stored, without fetching it again. Null if Jev couldn't answer. */
export async function resortDump(id: string): Promise<{ before: string; after: string } | null> {
  const dump = getDump(id);
  if (!dump || dump.topicLocked) return null;
  const classification = await classify({ ...dump, title: dump.title ?? (dump.url ? titleFromUrl(dump.url) : null) }, dump.kind === "image");
  if (classification.classifiedBy !== "ai") return null;
  const out = commit(id, classification, dump);
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
