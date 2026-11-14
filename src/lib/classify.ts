import type { Topic } from "./taxonomy";

export interface ClassifyInput {
  title?: string | null;
  description?: string | null;
  content?: string | null;
  note?: string | null;
  url?: string | null;
  domain?: string | null;
  siteName?: string | null;
}

export interface Classification {
  topic: Topic;
  tags: string[];
  confidence: number;
}

interface Lexicon {
  domains: string[];
  /** Words or phrases. A trailing `*` matches any word starting with the stem. */
  keywords: string[];
}

const LEXICON: Record<Exclude<Topic, "other">, Lexicon> = {
  ai: {
    domains: ["openai.com", "anthropic.com", "huggingface.co", "deepmind.google", "mistral.ai", "perplexity.ai", "midjourney.com", "cognition.ai"],
    keywords: ["ai", "artificial intelligence", "machine learning", "deep learning", "llm*", "gpt*", "chatgpt", "claude", "gemini", "openai", "anthropic", "neural network*", "transformer*", "prompt*", "agent*", "agentic", "fine-tun*", "diffusion", "embedding*", "inference", "copilot", "devin", "rag", "ml", "mcp"],
  },
  tech: {
    domains: ["github.com", "gitlab.com", "stackoverflow.com", "dev.to", "news.ycombinator.com", "vercel.com", "npmjs.com", "pypi.org", "developer.mozilla.org", "techcrunch.com", "theverge.com", "arstechnica.com", "wired.com", "hashnode.dev"],
    keywords: ["code", "coding", "programm*", "developer*", "software", "javascript", "typescript", "python", "rust", "golang", "java", "react", "nextjs", "next.js", "node", "api", "apis", "database*", "sql", "postgres*", "sqlite", "frontend", "backend", "devops", "kubernetes", "docker", "cloud", "aws", "linux", "open source", "open-source", "github", "repo", "repository", "framework", "library", "compiler", "algorithm*", "startup*", "saas", "app", "apps", "iphone", "android", "apple", "google", "microsoft", "gadget*", "laptop*", "cybersecurity", "security", "hacker*", "tech", "technology", "engineering", "css", "html", "web dev*", "cli", "terminal", "bug*", "deploy*"],
  },
  design: {
    domains: ["dribbble.com", "behance.net", "figma.com", "awwwards.com", "canva.com", "fontsinuse.com", "pinterest.com"],
    keywords: ["design*", "ui", "ux", "typography", "font*", "typeface*", "logo*", "branding", "illustrat*", "figma", "color palette*", "palette*", "art", "artist*", "artwork*", "painting*", "drawing*", "sketch*", "poster*", "photography", "photograph*", "aesthetic*", "architecture", "graphic*", "animation", "3d", "inspiration", "moodboard*", "layout*", "minimalis*"],
  },
  business: {
    domains: ["bloomberg.com", "wsj.com", "ft.com", "forbes.com", "businessinsider.com", "hbr.org", "cnbc.com", "investopedia.com", "producthunt.com", "ycombinator.com", "stripe.com"],
    keywords: ["business", "startup*", "founder*", "entrepreneur*", "market*", "invest*", "investor*", "stock*", "shares", "crypto*", "bitcoin", "ethereum", "finance", "financial", "money", "revenue", "profit*", "economy", "economic*", "inflation", "fundrais*", "venture capital", "vc", "ipo", "valuation", "sales", "pricing", "growth", "strategy", "management", "leadership", "career*", "job*", "hiring", "salary", "productivity", "budget*", "saving*", "tax*", "ceo", "company", "companies", "brand*", "negotiat*", "remote work"],
  },
  science: {
    domains: ["nature.com", "science.org", "arxiv.org", "nasa.gov", "scientificamerican.com", "newscientist.com", "quantamagazine.org", "phys.org", "nationalgeographic.com"],
    keywords: ["science", "scientist*", "research*", "study", "studies", "physics", "quantum", "chemistry", "biology", "evolution", "genetic*", "dna", "space", "nasa", "astronom*", "planet*", "galaxy", "universe", "telescope", "climate", "ecolog*", "neuroscience", "brain", "mathemat*", "math", "theorem", "experiment*", "paper", "discovery", "fossil*", "species", "molecule*", "particle*", "rocket*", "mars"],
  },
  news: {
    domains: ["nytimes.com", "bbc.com", "bbc.co.uk", "cnn.com", "theguardian.com", "reuters.com", "apnews.com", "washingtonpost.com", "aljazeera.com", "politico.com", "axios.com", "npr.org", "straitstimes.com", "channelnewsasia.com"],
    keywords: ["news", "breaking", "election*", "vote", "voting", "president", "prime minister", "minister", "government", "politic*", "policy", "congress", "senate", "parliament", "law", "court", "supreme court", "war", "military", "protest*", "geopolitic*", "democra*", "republican*", "conservative*", "liberal*", "sanction*", "diplomat*", "tariff*", "immigration", "officials", "crisis"],
  },
  food: {
    domains: ["allrecipes.com", "bonappetit.com", "seriouseats.com", "food52.com", "epicurious.com", "nytcooking.com", "cooking.nytimes.com", "tasty.co", "budgetbytes.com", "delish.com", "foodnetwork.com", "eater.com"],
    keywords: ["recipe*", "cook*", "bake", "baking", "baked", "kitchen", "food", "foodie", "dinner", "lunch", "breakfast", "brunch", "dessert*", "meal*", "dish", "dishes", "ingredient*", "restaurant*", "cafe", "coffee", "tea", "chef*", "pasta", "pizza", "bread", "cake*", "cookie*", "chocolate", "chicken", "beef", "vegan", "vegetarian", "noodle*", "ramen", "sushi", "curry", "soup*", "salad*", "sauce*", "taste", "delicious", "eat", "eats", "eating", "cuisine", "wine", "cocktail*", "snack*", "michelin", "hawker"],
  },
  travel: {
    domains: ["tripadvisor.com", "lonelyplanet.com", "airbnb.com", "booking.com", "expedia.com", "skyscanner.com", "maps.google.com", "goo.gl", "atlasobscura.com", "cntraveler.com", "agoda.com"],
    keywords: ["travel*", "trip*", "vacation*", "holiday*", "itinerar*", "destination*", "flight*", "airline*", "airport*", "hotel*", "hostel*", "resort*", "airbnb", "beach*", "island*", "hiking", "hike", "mountain*", "city guide", "things to do", "visit", "visiting", "tourist*", "tourism", "backpack*", "road trip", "passport", "visa", "japan", "tokyo", "kyoto", "paris", "london", "italy", "bali", "thailand", "singapore", "europe", "itinerary", "explore"],
  },
  health: {
    domains: ["healthline.com", "webmd.com", "mayoclinic.org", "nih.gov", "strava.com", "examine.com", "menshealth.com", "womenshealthmag.com"],
    keywords: ["health*", "fitness", "workout*", "exercise*", "gym", "training", "run", "running", "marathon", "yoga", "pilates", "strength", "muscle*", "weight loss", "diet*", "nutrition", "protein", "calorie*", "sleep", "mental health", "anxiety", "depression", "therapy", "meditat*", "mindfulness", "wellness", "wellbeing", "doctor*", "medical", "medicine", "disease*", "symptom*", "vitamin*", "supplement*", "stretch*", "cardio", "longevity", "habit*"],
  },
  music: {
    domains: ["open.spotify.com", "spotify.com", "soundcloud.com", "music.apple.com", "bandcamp.com", "pitchfork.com", "genius.com", "last.fm"],
    keywords: ["music", "song*", "album*", "single", "track*", "playlist*", "band", "bands", "singer*", "rapper*", "concert*", "tour", "lyrics", "guitar*", "piano", "drum*", "dj", "remix*", "hip hop", "hip-hop", "rap", "jazz", "rock", "pop", "edm", "classical", "musician*", "spotify", "vinyl", "festival*", "k-pop", "kpop", "music video", "official video", "official audio", "lyric video", "remaster*", "feat", "ft", "cover", "acoustic", "live performance"],
  },
  film: {
    domains: ["imdb.com", "letterboxd.com", "rottentomatoes.com", "netflix.com", "hulu.com", "disneyplus.com", "primevideo.com", "variety.com", "hollywoodreporter.com", "themoviedb.org"],
    keywords: ["movie*", "film*", "cinema", "tv show*", "tv series", "series", "season", "episode*", "netflix", "hbo", "disney", "marvel", "pixar", "anime", "trailer*", "director*", "actor*", "actress*", "oscar*", "box office", "documentar*", "sitcom", "streaming", "watchlist", "hollywood", "screenplay"],
  },
  books: {
    domains: ["goodreads.com", "amazon.com/books", "gutenberg.org", "bookshop.org", "storygraph.com", "lithub.com", "theparisreview.org"],
    keywords: ["book*", "novel*", "author*", "reading", "read", "reading list", "fiction", "nonfiction", "non-fiction", "poem*", "poetry", "essay*", "writing", "writer*", "write", "literature", "library", "chapter*", "memoir*", "publish*", "kindle", "audiobook*", "bestseller*", "quote*", "story", "stories"],
  },
  gaming: {
    domains: ["steampowered.com", "store.steampowered.com", "ign.com", "polygon.com", "kotaku.com", "pcgamer.com", "itch.io", "twitch.tv", "nintendo.com", "playstation.com", "xbox.com", "gamespot.com"],
    keywords: ["game*", "gaming", "gamer*", "video game*", "nintendo", "switch", "playstation", "ps5", "xbox", "steam", "esports", "speedrun*", "minecraft", "fortnite", "zelda", "pokemon", "rpg", "mmo", "indie game*", "console*", "twitch", "multiplayer", "boss fight", "level design"],
  },
  sports: {
    domains: ["espn.com", "nba.com", "nfl.com", "fifa.com", "uefa.com", "skysports.com", "bleacherreport.com", "theathletic.com", "formula1.com", "olympics.com"],
    keywords: ["sport*", "football", "soccer", "basketball", "baseball", "tennis", "golf", "cricket", "rugby", "hockey", "f1", "formula 1", "nba", "nfl", "mlb", "premier league", "champions league", "world cup", "olympic*", "athlete*", "match", "goal*", "score*", "league", "tournament", "championship", "coach", "transfer", "ufc", "boxing", "cycling", "playoff*"],
  },
  shopping: {
    domains: ["amazon.com", "amazon.co.uk", "ebay.com", "etsy.com", "aliexpress.com", "shopee.sg", "lazada.sg", "target.com", "walmart.com", "bestbuy.com", "ikea.com", "uniqlo.com", "kickstarter.com", "wirecutter.com"],
    keywords: ["buy", "buying", "shop", "shopping", "store", "deal*", "discount*", "sale", "price", "cheap", "product*", "review*", "best", "gift*", "wishlist", "add to cart", "order", "purchase*", "coupon*", "gear", "unboxing", "worth it", "recommendation*", "kickstarter"],
  },
  home: {
    domains: ["apartmenttherapy.com", "houzz.com", "thespruce.com", "bhg.com", "instructables.com", "familyhandyman.com", "gardenersworld.com"],
    keywords: ["home", "house", "apartment", "interior*", "decor*", "furniture", "sofa", "room", "bedroom", "living room", "kitchen design", "renovat*", "diy", "craft*", "woodwork*", "garden*", "plant*", "houseplant*", "cleaning", "organiz*", "organis*", "storage", "declutter*", "tool*", "repair*", "fix", "build", "parenting", "pet*", "dog*", "cat", "cats", "puppy", "kitten*"],
  },
  style: {
    domains: ["vogue.com", "gq.com", "elle.com", "hypebeast.com", "highsnobiety.com", "sephora.com", "asos.com", "zara.com", "net-a-porter.com", "ssense.com"],
    keywords: ["fashion", "style", "outfit*", "wear", "wearing", "clothes", "clothing", "dress*", "shoe*", "sneaker*", "jacket*", "shirt*", "jeans", "streetwear", "wardrobe", "lookbook", "skincare", "makeup", "beauty", "hair*", "haircut", "nail*", "perfume", "fragrance*", "cosmetic*", "jewel*", "watch", "watches", "accessor*", "runway"],
  },
  fun: {
    domains: ["9gag.com", "knowyourmeme.com", "imgur.com", "theonion.com", "xkcd.com", "boredpanda.com", "giphy.com"],
    keywords: ["meme*", "funny", "lol", "lmao", "hilarious", "joke*", "humor", "humour", "comedy", "comedian", "prank*", "wholesome", "cursed", "shitpost*", "gif", "satire", "parody", "laugh*", "relatable", "viral"],
  },
  personal: {
    domains: [],
    keywords: ["todo", "to-do", "remember", "remind*", "don't forget", "dont forget", "note to self", "idea", "ideas", "goal*", "plan", "plans", "appointment*", "meeting", "call", "email", "birthday", "anniversary", "groceries", "grocery", "errand*", "pick up", "tomorrow", "tonight", "next week", "deadline", "journal", "diary", "password", "address", "phone number", "mom", "dad", "wife", "husband", "friend*"],
  },
};

const STOPWORDS = new Set(
  "a an and are as at be been but by for from has have how i if in into is it its just me my not of on or our so that the their them then there these they this to too up us was we were what when where which who why will with you your about after all also any can could do does get got more most new now one only out over some than very via".split(" "),
);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^\p{L}\p{N}#+.\-' ]+/gu, " ")
    .split(/\s+/)
    .map((t) => t.replace(/^[.'\-]+|[.'\-]+$/g, ""))
    .filter(Boolean);
}

function urlWords(url: string | null | undefined): string {
  if (!url) return "";
  try {
    const u = new URL(url);
    return decodeURIComponent(u.pathname)
      .replace(/[-_/+.]+/g, " ")
      .replace(/\b\d+\b/g, " ");
  } catch {
    return "";
  }
}

interface CompiledKeyword {
  words: string[];
  prefix: boolean;
  label: string;
}

const COMPILED: Record<string, CompiledKeyword[]> = Object.fromEntries(
  Object.entries(LEXICON).map(([topic, lex]) => [
    topic,
    lex.keywords.map((k) => {
      const prefix = k.endsWith("*");
      const clean = prefix ? k.slice(0, -1) : k;
      return { words: tokenize(clean), prefix, label: clean.trim() };
    }),
  ]),
);

function countMatches(tokens: string[], kw: CompiledKeyword): { count: number; matched: string | null } {
  const n = kw.words.length;
  let count = 0;
  let matched: string | null = null;
  if (n === 0) return { count, matched };
  for (let i = 0; i + n <= tokens.length; i++) {
    let ok = true;
    for (let j = 0; j < n; j++) {
      const tok = tokens[i + j];
      const word = kw.words[j];
      const isLast = j === n - 1;
      if (isLast && kw.prefix ? !tok.startsWith(word) : tok !== word) {
        ok = false;
        break;
      }
    }
    if (ok) {
      count++;
      matched ??= tokens.slice(i, i + n).join(" ");
    }
  }
  return { count, matched };
}

function domainMatches(domain: string, url: string, candidates: string[]) {
  return candidates.some((d) => {
    if (d.includes("/")) return url.includes(d);
    return domain === d || domain.endsWith(`.${d}`);
  });
}

/**
 * Keyword + domain scoring classifier. Works offline and needs no API key.
 * Title words count more than description words, which count more than body text.
 */
/** Keyword/domain classifier. Pass `topic` when it was already decided elsewhere to get tags for that topic. */
export function classifyHeuristic(input: ClassifyInput, decided?: Topic): Classification {
  const fields: Array<[string, number]> = [
    [input.title ?? "", 3],
    [input.note ?? "", 3],
    [input.description ?? "", 2],
    [urlWords(input.url), 1.5],
    [input.siteName ?? "", 1],
    [(input.content ?? "").slice(0, 6000), 1],
  ];
  const tokenized = fields.map(([text, weight]) => [tokenize(text), weight] as const);
  const domain = (input.domain ?? "").toLowerCase();
  const url = (input.url ?? "").toLowerCase();

  const scores: Record<string, number> = {};
  const hits: Record<string, Map<string, number>> = {};

  for (const [topic, lex] of Object.entries(LEXICON)) {
    let score = domain && domainMatches(domain, url, lex.domains) ? 6 : 0;
    const topicHits = new Map<string, number>();
    for (const kw of COMPILED[topic]) {
      let kwScore = 0;
      let label = kw.label;
      for (const [tokens, weight] of tokenized) {
        const { count: c, matched } = countMatches(tokens, kw);
        if (matched && kw.prefix && label === kw.label) label = matched;
        // Diminishing returns so one repeated word can't dominate.
        if (c > 0) kwScore += weight * (1 + Math.log2(c)) * (kw.words.length > 1 ? 1.5 : 1);
      }
      if (kwScore > 0) {
        score += kwScore;
        topicHits.set(label, (topicHits.get(label) ?? 0) + kwScore);
      }
    }
    scores[topic] = score;
    hits[topic] = topicHits;
  }

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [bestTopic, bestScore] = ranked[0];
  const secondScore = ranked[1]?.[1] ?? 0;
  const total = ranked.reduce((s, [, v]) => s + v, 0);

  const topic: Topic = decided ?? (bestScore >= 2.5 ? (bestTopic as Topic) : "other");
  const confidence = total > 0 ? Math.min(1, (bestScore - secondScore * 0.5) / total + bestScore / 30) : 0;

  return { topic, tags: extractTags(input, topic === "other" ? undefined : hits[topic]), confidence: Number(confidence.toFixed(2)) };
}

function extractTags(input: ClassifyInput, topicHits?: Map<string, number>): string[] {
  const tags: string[] = [];
  const add = (t: string) => {
    const clean = t.toLowerCase().replace(/^#/, "").trim();
    if (clean.length >= 2 && clean.length <= 30 && !clean.includes(".") && !tags.includes(clean)) tags.push(clean);
  };

  const all = [input.title, input.note, input.description, input.content].filter(Boolean).join(" ");
  for (const m of all.matchAll(/(?:^|\s)#([\p{L}\p{N}_]{2,30})/gu)) add(m[1]);

  if (topicHits) {
    [...topicHits.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .forEach(([label]) => add(label));
  }

  // Frequent meaningful words from the title/description fill remaining slots.
  const freq = new Map<string, number>();
  for (const tok of tokenize([input.title, input.description, input.note].filter(Boolean).join(" "))) {
    if (tok.length < 4 || tok.includes(".") || STOPWORDS.has(tok) || /^\d+$/.test(tok) || tok.startsWith("#")) continue;
    freq.set(tok, (freq.get(tok) ?? 0) + 1);
  }
  [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, 6)
    .forEach(([w]) => tags.length < 5 && add(w));

  return tags.slice(0, 5);
}
