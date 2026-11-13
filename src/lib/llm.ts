import fs from "node:fs/promises";
import path from "node:path";
import { TOPICS, isTopic, type Topic } from "./taxonomy";
import { UPLOAD_DIR } from "./db";
import type { ClassifyInput } from "./classify";

export interface AiClassification {
  topic: Topic;
  tags: string[];
  summary: string | null;
  title: string | null;
}

export function aiEnabled() {
  return !!process.env.OPENAI_API_KEY;
}

const SYSTEM = `You file saved items ("dumps") into a personal library so the owner never has to organise anything.
Pick the single best topic for the item from this fixed list (use the id):
${TOPICS.map((t) => `- ${t.id}: ${t.label}`).join("\n")}
Prefer a specific topic over "other"; use "personal" for the owner's own reminders/to-dos/ideas.
Also return 1-5 short lowercase tags (specific nouns, not the topic name), a one-sentence summary (max 25 words) of what this is and why someone might have saved it, and a short title (max 8 words) if the item has no good title, otherwise null.`;

const SCHEMA = {
  name: "dump_classification",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["topic", "tags", "summary", "title"],
    properties: {
      topic: { type: "string", enum: TOPICS.map((t) => t.id) },
      tags: { type: "array", items: { type: "string" } },
      summary: { type: "string" },
      title: { type: ["string", "null"] },
    },
  },
};

async function imagePart(imageUrl: string | null | undefined) {
  if (!imageUrl) return null;
  if (imageUrl.startsWith("/api/files/")) {
    const file = path.join(UPLOAD_DIR, path.basename(imageUrl));
    const ext = path.extname(file).slice(1).replace("jpg", "jpeg") || "png";
    const data = await fs.readFile(file).catch(() => null);
    if (!data || data.byteLength > 8_000_000) return null;
    return { type: "image_url", image_url: { url: `data:image/${ext};base64,${data.toString("base64")}`, detail: "low" } };
  }
  if (/^https?:\/\//.test(imageUrl)) return { type: "image_url", image_url: { url: imageUrl, detail: "low" } };
  return null;
}

/** Optional LLM classifier. Returns null (so the caller falls back to rules) on any failure. */
export async function classifyWithAi(input: ClassifyInput & { kind: string; imageUrl?: string | null; useImage?: boolean }): Promise<AiClassification | null> {
  if (!aiEnabled()) return null;
  const lines = [
    `Kind: ${input.kind}`,
    input.url && `URL: ${input.url}`,
    input.siteName && `Site: ${input.siteName}`,
    input.title && `Title: ${input.title}`,
    input.description && `Description: ${input.description}`,
    input.note && `Owner's note: ${input.note}`,
    input.content && `Content excerpt: ${input.content.slice(0, 3000)}`,
  ].filter(Boolean);

  const userContent: unknown[] = [{ type: "text", text: lines.join("\n") }];
  const img = input.useImage ? await imagePart(input.imageUrl) : null;
  if (img) userContent.push(img);

  try {
    const res = await fetch(`${process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1"}/chat/completions`, {
      method: "POST",
      signal: AbortSignal.timeout(30000),
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
        temperature: 0.2,
        response_format: { type: "json_schema", json_schema: SCHEMA },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: userContent },
        ],
      }),
    });
    if (!res.ok) {
      console.warn(`[dump] AI classification failed: ${res.status} ${await res.text().catch(() => "")}`.slice(0, 300));
      return null;
    }
    const json = await res.json();
    const parsed = JSON.parse(json.choices?.[0]?.message?.content ?? "{}");
    if (!isTopic(parsed.topic)) return null;
    return {
      topic: parsed.topic,
      tags: Array.isArray(parsed.tags) ? parsed.tags.map((t: unknown) => String(t).toLowerCase().trim()).filter(Boolean).slice(0, 5) : [],
      summary: typeof parsed.summary === "string" && parsed.summary.trim() ? parsed.summary.trim() : null,
      title: typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : null,
    };
  } catch (err) {
    console.warn("[dump] AI classification error:", (err as Error).message);
    return null;
  }
}
