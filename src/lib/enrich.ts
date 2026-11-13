import { classifyHeuristic } from "./classify";
import { db, getDump, updateDump, type Dump } from "./db";
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
      // If the site was unreachable, leave the title empty so a later retry can fill it in;
      // the card shows the URL-derived title meanwhile.
      fields = {
        kind: ex.kind,
        title: dump.title ?? truncate(ex.title, 300) ?? (unreachable ? null : titleFromUrl(dump.url)),
        description: truncate(ex.description, 1000),
        content: ex.content,
        imageUrl: ex.imageUrl,
        siteName: ex.siteName,
        author: ex.author,
      };
    }
    const merged = { ...dump, ...fields };
    const forClassifying = { ...merged, title: merged.title ?? (dump.url ? titleFromUrl(dump.url) : null) };

    let classification: Partial<Dump>;
    const ai = await classifyWithAi({ ...forClassifying, useImage: merged.kind === "image" });
    if (ai) {
      classification = {
        topic: ai.topic,
        tags: ai.tags,
        summary: ai.summary,
        classifiedBy: "ai",
        ...(ai.title && (!merged.title || merged.kind === "image") ? { title: ai.title } : {}),
      };
    } else {
      const rules = classifyHeuristic(forClassifying);
      classification = { topic: rules.topic, tags: rules.tags, classifiedBy: "rules" };
    }

    // Couldn't reach the site at all: keep the fallback title/topic but mark it failed so it can be retried.
    return commit(id, { ...fields, ...classification, status: unreachable ? "failed" : "ready" });
  } catch (err) {
    console.warn(`[dump] enrich failed for ${id}:`, (err as Error).message);
    const rules = classifyHeuristic({ ...dump, title: dump.title ?? (dump.url ? titleFromUrl(dump.url) : null) });
    return commit(id, { status: "failed", topic: rules.topic, classifiedBy: "rules", tags: rules.tags });
  }
}
