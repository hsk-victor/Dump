import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { isTopic, type Topic } from "./taxonomy";
import { UPLOAD_DIR } from "./db";
import { fetchImage } from "./extract";
import type { ClassifyInput } from "./classify";

export interface AiClassification {
  topic: Topic;
  /** Jev's confidence in the choice, 0-1. */
  confidence: number | null;
  /** The versioned model that answered, e.g. typesafe/jev-1.14-20261014. */
  model: string | null;
}

const DECISIONS_URL = "https://openrouter.ai/api/alpha/decisions";
export const DEFAULT_MODEL = "typesafe/jev-1.14";

export function aiEnabled() {
  return !!process.env.OPENROUTER_API_KEY;
}

const TOPIC_CRITERIA: Record<Topic, string> = {
  tech: "Software, programming, developer tools, the web, gadgets, hardware and tech companies, when the item is not mainly about AI.",
  ai: "Artificial intelligence: LLMs, chatbots, machine learning, AI agents and tools, AI research and AI companies.",
  design: "Visual design, UI/UX, typography, illustration, photography, art, architecture and creative inspiration.",
  business: "Startups, companies, careers, marketing, finance, investing, personal money, crypto and the economy.",
  science: "Scientific research and discoveries: space, physics, biology, chemistry, climate, nature and maths.",
  news: "Current events, politics, government, elections, world affairs and social issues.",
  food: "Cooking, recipes, restaurants, drinks, baking and food culture.",
  travel: "Trips, destinations, places to visit, hotels, itineraries and outdoor adventures.",
  health: "Fitness, workouts, nutrition, diet, mental health, sleep, medicine and wellbeing.",
  music: "Songs, albums, artists, concerts, playlists, music videos and making music.",
  film: "Movies, TV shows and series, trailers, streaming, anime, actors and film criticism.",
  books: "Books, reading lists, authors, essays, poetry and the craft of writing.",
  gaming: "Video games, board games, esports, consoles and game development.",
  sports: "Sports, teams, athletes, matches, leagues and results.",
  shopping: "Products to buy, wishlists, deals, product reviews, gear and gift ideas.",
  home: "Home improvement, interior decor, furniture, gardening, cleaning and DIY projects.",
  style: "Fashion, outfits, clothing, beauty, skincare, makeup and hair.",
  fun: "Memes, jokes, funny or viral posts and videos, and things saved purely for entertainment.",
  personal: "The owner's own notes: reminders, to-dos, ideas, plans, errands, journal entries and personal details.",
  other: "Fits none of the other topics.",
};

const QUESTIONS = {
  topic: {
    type: "choice",
    instructions:
      "This `state` is an item the owner saved to their personal library. Which topic should it be filed under? Judge by what the item is about, using its title, description, content, the owner's note and any image.",
    criteria: TOPIC_CRITERIA,
  },
};

// Jev's image limits: 256-1568 px per side and 78,400-2,458,624 px in total.
const MIN_SIDE = 256;
const MAX_SIDE = 1568;
const MIN_PIXELS = 78_400;
const MAX_PIXELS = 2_458_624;

/** Rotates, scales into Jev's size limits and re-encodes as JPEG. Null if the image can't fit them. */
export async function prepareImage(input: Buffer): Promise<string | null> {
  try {
    const { data, info } = await sharp(input, { animated: false }).rotate().toBuffer({ resolveWithObject: true });
    const { width: w, height: h } = info;
    const down = Math.min(1, MAX_SIDE / w, MAX_SIDE / h, Math.sqrt(MAX_PIXELS / (w * h)));
    const up = Math.max(MIN_SIDE / w, MIN_SIDE / h, Math.sqrt(MIN_PIXELS / (w * h)));
    const scale = Math.max(down, up);
    const sw = w * scale;
    const sh = h * scale;
    // Too elongated to meet both side limits at once.
    if (Math.min(sw, sh) < MIN_SIDE - 0.5 || Math.max(sw, sh) > MAX_SIDE + 0.5) return null;
    // Clamp absorbs float error at the side limits; then nudge rounding so the area stays in range.
    const side = (n: number) => Math.min(MAX_SIDE, Math.max(MIN_SIDE, n));
    let width = side(Math.round(sw));
    let height = side(Math.round(sh));
    if (width * height < MIN_PIXELS) [width, height] = [side(Math.ceil(sw)), side(Math.ceil(sh))];
    if (width * height > MAX_PIXELS) [width, height] = [side(Math.floor(sw)), side(Math.floor(sh))];
    if (width * height < MIN_PIXELS || width * height > MAX_PIXELS) return null;
    const jpeg = await sharp(data).resize(width, height).flatten({ background: "#ffffff" }).jpeg({ quality: 85 }).toBuffer();
    return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  } catch {
    return null;
  }
}

async function loadImage(imageUrl: string | null | undefined): Promise<string | null> {
  if (!imageUrl) return null;
  let bytes: Buffer | null = null;
  if (imageUrl.startsWith("/api/files/")) bytes = await fs.readFile(path.join(UPLOAD_DIR, path.basename(imageUrl))).catch(() => null);
  else if (/^https?:\/\//.test(imageUrl)) bytes = await fetchImage(imageUrl);
  return bytes ? prepareImage(bytes) : null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function decide(state: unknown, withImage: boolean) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(DECISIONS_URL, {
      method: "POST",
      signal: AbortSignal.timeout(withImage ? 45_000 : 20_000),
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
      body: JSON.stringify({ model: process.env.DUMP_MODEL || DEFAULT_MODEL, state, questions: QUESTIONS }),
    });
    if (res.ok) return res.json();
    const body = await res.text().catch(() => "");
    if ((res.status === 429 || res.status >= 500) && attempt < 2) {
      const retryAfter = Number(res.headers.get("retry-after")) * 1000;
      await sleep(Math.min(retryAfter > 0 ? retryAfter : 1000 * 2 ** attempt, 10_000));
      continue;
    }
    throw Object.assign(new Error(`Jev ${res.status}: ${body}`.slice(0, 300)), { status: res.status });
  }
}

/** Files an item under a topic with a decision model (Jev). Returns null (so the caller falls back to rules) on any failure. */
export async function classifyWithAi(input: ClassifyInput & { kind: string; imageUrl?: string | null; useImage?: boolean }): Promise<AiClassification | null> {
  if (!aiEnabled()) return null;
  const item = Object.fromEntries(
    Object.entries({
      kind: input.kind,
      url: input.url,
      site: input.siteName,
      title: input.title,
      description: input.description,
      owner_note: input.note,
      content_excerpt: input.content?.slice(0, 3000),
    }).filter(([, v]) => v),
  );
  const image = input.useImage ? await loadImage(input.imageUrl) : null;

  try {
    let json;
    try {
      json = await decide(image ? { ...item, image: { type: "image_url", image_url: { url: image } } } : item, !!image);
    } catch (err) {
      // An image Jev rejects shouldn't cost us the whole classification: retry on the text alone.
      if (!image || ![400, 413, 422].includes((err as { status?: number }).status ?? 0)) throw err;
      json = await decide(item, false);
    }
    const answer = json?.answers?.topic;
    if (answer?.type !== "choice" || !isTopic(answer.choice)) return null;
    return {
      topic: answer.choice,
      confidence: typeof answer.confidence === "number" ? answer.confidence : null,
      model: typeof json.model === "string" ? json.model : null,
    };
  } catch (err) {
    console.warn("[dump] AI classification failed:", (err as Error).message);
    return null;
  }
}
