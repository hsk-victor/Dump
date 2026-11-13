import { classifyHeuristic } from "./classify";
import { db, getDump, listResortable, updateDump, type Dump } from "./db";
import { extractUrl } from "./extract";
import { titleFromUrl } from "./detect";
import { classifyWithAi } from "./llm";

function truncate(s: string | null | undefined, n: number) {
  if (!s) return null;
  const clean = s.replace(/\s+/g, " ").trim();
  return clean.length > n ? `${clean.slice(0, n - 1).trimEnd()}…` : clean;
}

export function noteTitle(text: string): string {
  const firstLine = text.split("\n").find((l) => l.trim()) ?? text;
  return truncate(firstLine, 80) ?? "Note";
}

/**
 * Writes enrichment results, re-reading the topic lock in the same transaction so a topic the user
 * picked while enrichment was running is never overwritten.
 */
function commit(id: string, patch: Partial<Dump>): Dump | null {
  return db().transaction(() => {
    const current = getDump(id);
    if (!current) return null;
    const { topic, classifiedBy, ...rest } = patch;
    return updateDump(id, current.topicLocked ? rest : { ...rest, topic, classifiedBy });
  })();
}

/** Topic from Jev when configured (rules as the fallback); tags always come from the rules. */
async function classify(input: Dump, useImage: boolean): Promise<Partial<Dump>> {
  const ai = await classifyWithAi({ ...input, useImage });
  const rules = classifyHeuristic(input, ai?.topic);
  return { topic: rules.topic, tags: rules.tags, classifiedBy: ai ? "ai" : "rules" };
}

/**
 * Fills in a freshly saved dump: fetch metadata for links, then file it under a topic.
 * Runs in the background after the dump has already been saved and shown to the user.
 */
export async function enrichDump(id: string): Promise<Dump | null> {
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
        title,
        description: truncate(ex.description, 1000),
        content: title ? ex.content : [titleFromUrl(dump.url), ex.content].filter(Boolean).join("\n") || null,
        imageUrl: ex.imageUrl,
        siteName: ex.siteName,
        author: ex.author,
      };
    }
    const merged = { ...dump, ...fields };
    const forClassifying = { ...merged, title: merged.title ?? (dump.url ? titleFromUrl(dump.url) : null) };

    const classification = await classify(forClassifying, merged.kind === "image");
    // Couldn't reach the site at all: keep the fallback topic but mark it failed so it can be retried.
    return commit(id, { ...fields, ...classification, status: unreachable ? "failed" : "ready" });
  } catch (err) {
    console.warn(`[dump] enrich failed for ${id}:`, (err as Error).message);
    const rules = classifyHeuristic({ ...dump, title: dump.title ?? (dump.url ? titleFromUrl(dump.url) : null) });
    return commit(id, { status: "failed", topic: rules.topic, classifiedBy: "rules", tags: rules.tags });
  }
}

/** Re-files a dump from what's already stored, without fetching it again. Null if Jev couldn't answer. */
export async function resortDump(id: string): Promise<{ before: string; after: string } | null> {
  const dump = getDump(id);
  if (!dump || dump.topicLocked) return null;
  const classification = await classify({ ...dump, title: dump.title ?? (dump.url ? titleFromUrl(dump.url) : null) }, dump.kind === "image");
  if (classification.classifiedBy !== "ai") return null;
  const out = commit(id, classification);
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
