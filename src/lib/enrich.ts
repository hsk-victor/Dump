import { classifyHeuristic } from "./classify";
import { getDump, updateDump, type Dump } from "./db";
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
 * Fills in a freshly saved dump: fetch metadata for links, then file it under a topic.
 * Runs in the background after the dump has already been saved and shown to the user.
 */
export async function enrichDump(id: string): Promise<Dump | null> {
  const dump = getDump(id);
  if (!dump) return null;

  try {
    let fields: Partial<Dump> = {};
    if (dump.url) {
      const ex = await extractUrl(dump.url);
      fields = {
        kind: ex.kind,
        title: dump.title ?? truncate(ex.title, 300) ?? titleFromUrl(dump.url),
        description: truncate(ex.description, 1000),
        content: ex.content,
        imageUrl: ex.imageUrl,
        siteName: ex.siteName,
        author: ex.author,
      };
    }
    const merged = { ...dump, ...fields };

    let classification: Partial<Dump>;
    const ai = await classifyWithAi({ ...merged, useImage: merged.kind === "image" });
    if (ai) {
      classification = {
        topic: ai.topic,
        tags: ai.tags,
        summary: ai.summary,
        classifiedBy: "ai",
        ...(ai.title && (!merged.title || merged.kind === "image") ? { title: ai.title } : {}),
      };
    } else {
      const rules = classifyHeuristic(merged);
      classification = { topic: rules.topic, tags: rules.tags, classifiedBy: "rules" };
    }

    if (dump.topicLocked) {
      delete classification.topic;
      delete classification.classifiedBy;
    }
    return updateDump(id, { ...fields, ...classification, status: "ready" });
  } catch (err) {
    console.warn(`[dump] enrich failed for ${id}:`, (err as Error).message);
    const rules = classifyHeuristic(dump);
    return updateDump(id, {
      status: "failed",
      ...(dump.topicLocked ? {} : { topic: rules.topic, classifiedBy: "rules" as const }),
      tags: rules.tags,
    });
  }
}
