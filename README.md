# Dump

Save ("dump") anything you come across, like X posts, links, articles, videos, images and notes, and never organise it yourself. Every dump is filed automatically by **type** and **topic**, so you can browse or search it later.

## Run it

```bash
npm install
npm run dev        # http://localhost:3000
```

Requires Node 20+. Data lives in `./data` (SQLite database + uploaded images); set `DUMP_DATA_DIR` to put it elsewhere.

Optional: set `OPENROUTER_API_KEY` to file dumps with [Jev](https://openrouter.ai/typesafe/jev-1.14), a decision model, via OpenRouter's [Decisions API](https://openrouter.ai/docs/api/reference/decisions). Jev picks the topic (and can look at uploaded images); tags still come from the rules. It answers in ~0.2s and costs about $0.00002 per dump. Without a key, Dump uses a built-in rules classifier that works offline. With a key, the ✦ button in the header re-sorts everything you haven't filed by hand.

The same key also powers **subject identification**: clips and images (TikTok/Instagram posts and reels, YouTube and other videos, uploaded or linked images) get a second pass with a regular chat-completions vision model that names what they're about — "Severance (2022) · TV series" — plus a 1–2 line description that becomes the card's dek and is searchable. A low-confidence answer keeps the card unchanged. The identified subject is stored as JSON in a `subject` column and feeds Jev's filing; re-sorting reuses it without calling the model again.

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | unset | Turns on AI categorisation and subject identification |
| `DUMP_MODEL` | `typesafe/jev-1.14` | Decisions API model used for categorisation |
| `DUMP_IDENTIFY_MODEL` | `openai/gpt-6-luna` | Chat-completions model that identifies clip/image subjects |
| `DUMP_DATA_DIR` | `./data` | Where the DB and uploads are stored |

```bash
npm test           # unit tests (vitest)
npm run lint
npm run build && npm start
```

## Using it

- **Dump:** paste a link, type a note, or paste/drop an image into the box and press Enter. Text around a link is kept as your note ("try this weekend https://…").
- **Auto-filing:** the dump appears instantly with a "Sorting…" badge, then fills in with its title, preview, topic and tags a moment later.
- **Browse:** the sidebar lists topics and types with counts. Click to filter.
- **Search:** press `/` and type. Search runs across titles, descriptions, page text, notes, tags and sites, with prefix matching.
- **Bookmarklet:** drag "+ Dump it" from the sidebar to your bookmarks bar to dump the page you're on in one click. It also sends the page's og:description and og:image, which a logged-in Instagram/TikTok tab has but a server-side fetch never sees.
- **Fix a filing (optional):** hover a card, then use "Move…". Manual choices are never overwritten.
- Dumping the same link twice moves it back to the top instead of creating a duplicate.

## How it works

```
POST /api/dumps ──► save row (status=processing) ──► respond immediately
                         │
                         └─ after(): enrich in background
                              1. URL → kind guess (x.com/status → post, youtube → video, .jpg → image …)
                              2. fetch metadata: oEmbed (X, YouTube, Vimeo, TikTok, Reddit, Spotify, SoundCloud)
                                 + the page's Open Graph tags / JSON-LD / main text
                              3. for clips/images: identify the subject with the vision model
                                 (title + description when confident, stored as `subject` JSON)
                              4. classify topic: Jev if configured (it sees the identified subject),
                                 otherwise keyword/domain rules; tags from rules
                              5. save (status=ready); the UI polls until nothing is processing
```

Key files:

- `src/lib/taxonomy.ts`: the fixed lists of types and topics
- `src/lib/detect.ts`: input parsing, URL normalisation, kind detection
- `src/lib/extract.ts`: metadata fetching (with an SSRF guard against private-network URLs)
- `src/lib/classify.ts`: offline keyword/domain topic classifier
- `src/lib/llm.ts`: optional AI calls — Jev classifier (OpenRouter Decisions API `choice` over the topic list, falls back to rules) and the vision model that identifies clip/image subjects (chat completions, strict JSON schema)
- `src/lib/db.ts`: SQLite schema, FTS5 search index kept in sync by triggers
- `src/app/api/*`: REST API; `src/app/dump`: bookmarklet endpoint
- `src/components/*`: UI

## Design decisions

- **Next.js (App Router) + TypeScript:** UI and API live in one app and one deploy. Route handlers plus `after()` let us answer instantly and do the slow fetching and classification in the background.
- **SQLite (better-sqlite3) + FTS5:** zero setup and a single file, with fast, ranked full-text search built in. That's plenty for a personal library; swap in Postgres when there are multiple users.
- **Two axes, fixed topic list:** *type* comes from the source (reliable), *topic* comes from content. A fixed list of about 20 topics keeps the library tidy. Free-form AI categories drift into near-duplicates ("Cooking", "Recipes", "Food & Drink"). Tags carry the specifics.
- **Rules first, AI optional:** the app is fully useful with no API key or cost. The AI path is a drop-in upgrade and falls back to rules on any error. It uses a decision model rather than a chat model: picking one of 20 topics is a typed choice, so there's no JSON to parse and the answer is always a valid topic.
- **Save first, enrich later:** a dump is never lost because a site was slow or blocked. If fetching fails you still get a title from the URL and a topic from what's known.

## Known limitations (v1)

- Single user, no accounts or auth. Run it locally or behind your own auth.
- Some sites block bots or need JavaScript (e.g. IMDb, Allrecipes, Medium). For these, Dump falls back to the URL slug for the title and classification.
- X posts are read via the public oEmbed endpoint (text and author only, no media).
- Without an API key, images are classified only by filename and any note you add, and clips/images are not identified.
- Server-side fetches of Instagram and TikTok get almost nothing (login walls, oEmbed without titles), so those dumps rely on the bookmarklet sending og:description/og:image.
