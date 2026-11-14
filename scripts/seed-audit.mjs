// Seed a realistic mixed feed for the tailored-cards integration audit.
// Inserts rows directly into data/dump.db with status ready so enrichment
// never overwrites them. Run: node scripts/seed-audit.mjs
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import path from "node:path";
import fs from "node:fs";

const DATA_DIR = path.resolve(process.cwd(), "data");
fs.mkdirSync(path.join(DATA_DIR, "uploads"), { recursive: true });
const db = new Database(path.join(DATA_DIR, "dump.db"));

const NOW = Date.now();
const HOUR = 3600_000;

// Unsplash image pool (verified reachable from this VM).
const img = (id, w = 800) => `https://images.unsplash.com/photo-${id}?w=${w}&q=80`;
const IMGS = {
  mountain: img("1506905925346-21bda4d32df4"),
  hills: img("1470071459604-3b5ec3a7fe05"),
  forest: img("1441974231531-c6227db76b6e"),
  coffee: img("1495474472287-4d71bcdd2085"),
  circuit: img("1518770660439-4636190af475"),
  retro: img("1550745165-9bc0b252726f"),
  laptop: img("1517694712202-14dd9538aa97"),
  macbook: img("1498050108023-c5249f4df085"),
  music: img("1493225457124-a3eb161ffa5f"),
  dj: img("1470225620780-dba8ba36b745"),
  watch: img("1523275335684-37898b6baf30"),
  car: img("1449965408869-eaa3f722e40d"),
  desert: img("1469854523086-cc02fe5d8800"),
  night: img("1519681393784-d120267933ba"),
  abstract: img("1541701494587-cb58502866ab"),
  book: img("1541963463532-d68292c34b19"),
  desk: img("1488190211105-8b0e65b80b4e"),
  code: img("1461749280684-dccba630e2f6"),
  portrait: img("1558655146-9f40138edfeb"),
  plant: img("1416879595882-3373a0480b5b"),
  city: img("1449824913935-59a10b8d2000"),
  ocean: img("1439405326854-014607f694d7"),
};

const YT = (v) => `https://i.ytimg.com/vi/${v}/hqdefault.jpg`;
const OGH = (repo) => `https://opengraph.githubassets.com/1/${repo}`;

// [hoursAgo, row]
const R = (h, row) => ({ ...row, created: NOW - h * HOUR });
const rows = [
  // ---- interleaved feed order (newest first) ----
  R(0.2, { kind: "post", provider: "hackernews", url: "https://news.ycombinator.com/item?id=42415360", domain: "news.ycombinator.com", title: "Ask HN: What are you using for local-first sync in 2026? | Hacker News", siteName: "Hacker News" }),
  R(0.5, { kind: "image", provider: "unsplash", url: "https://unsplash.com/photos/mist-over-the-ridge", domain: "unsplash.com", title: "Mist over the ridge", imageUrl: IMGS.hills, author: "Marek Piwnicki" }),
  R(0.8, { kind: "note", title: "Books to read before March", content: "Books to read before March\nThe Master and Margarita — Bulgakov\nA Pattern Language (borrow from Sam)\nThinking in Systems — re-read ch. 4\nGödel, Escher, Bach, finally" }),
  R(1.1, { kind: "video", provider: "youtube", url: "https://www.youtube.com/watch?v=jNQXAC9IVRw", domain: "youtube.com", title: "Me at the zoo", author: "jawed", imageUrl: YT("jNQXAC9IVRw"), siteName: "YouTube" }),
  R(1.5, { kind: "link", url: "https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_grid_layout", domain: "developer.mozilla.org", title: "CSS grid layout - CSS: Cascading Style Sheets | MDN", siteName: "MDN Web Docs" }),
  R(2.0, { kind: "post", provider: "x", url: "https://x.com/someoldhandle/status/1728890123456789012", domain: "x.com", status: "failed" }),
  R(2.4, { kind: "link", provider: "github", url: "https://github.com/facebook/react", domain: "github.com", title: "GitHub - facebook/react: The library for web and native user interfaces", imageUrl: OGH("facebook/react"), siteName: "GitHub", description: "The library for web and native user interfaces. Contribute to facebook/react development by creating an account on GitHub." }),
  R(3.0, { kind: "audio", provider: "spotify", url: "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC", domain: "open.spotify.com", title: "Never Gonna Give You Up", author: "Rick Astley", imageUrl: IMGS.music, siteName: "Spotify" }),
  R(3.5, { kind: "post", provider: "reddit", url: "https://www.reddit.com/r/nextjs/comments/1b3k9x2/server_components_are_confusing_me/", domain: "reddit.com", title: "Server components are confusing me", author: "u/confused_dev", description: "I get the pitch — zero-bundle server code — but every boundary I draw ends up needing 'use client' anyway. What am I missing?", imageUrl: IMGS.code }),
  R(4.0, { kind: "video", provider: "vimeo", url: "https://vimeo.com/76979871", domain: "vimeo.com", title: "The New Vimeo Player (You Know, For Videos)", author: "Vimeo", imageUrl: IMGS.abstract, description: "A faster, smarter player that adapts to your connection." }),
  R(4.5, { kind: "article", provider: "medium", url: "https://medium.com/@dbanksdesign/typography-tokens-4f9cd2a0cf9a", domain: "medium.com", title: "Typography tokens: how we scaled type across five products", author: "Danny Banks", siteName: "Medium", imageUrl: IMGS.desk, description: "Design tokens get all the attention, but type is where most design systems quietly fall apart. Here's the naming scheme that survived three rebrands." }),
  R(5.0, { kind: "post", provider: "threads", url: "https://www.threads.net/@zuck/post/C8xMPqrLmK3", domain: "threads.net", title: "Thought the feed needed more film photography", author: "zuck", description: "Thought the feed needed more film photography. Shot on a Pentax 67, Portra 400.", imageUrl: IMGS.portrait }),
  R(5.5, { kind: "post", provider: "instagram", url: "https://www.instagram.com/p/DHk2mQxP4fA/", domain: "instagram.com", title: "Morning light in the studio", author: "molly.louise", imageUrl: IMGS.plant, imageUrls: [IMGS.plant, IMGS.coffee, IMGS.desk, IMGS.book], description: "Morning light in the studio, finally got the shelf organized" }),
  R(6.0, { kind: "note", title: "حان الوقت لترتيب ملفات المشروع القديمة", content: "حان الوقت لترتيب ملفات المشروع القديمة\nأولاً: انقل الصور إلى مجلد الأرشيف\nثانياً: راجع الملاحظات المكررة واحذف ما لا يلزم\nثالثاً: لا تنسَ نسخة احتياطية قبل نهاية الأسبوع" }),
  R(6.5, { kind: "video", provider: "tiktok", url: "https://www.tiktok.com/@devlog.sam/video/7312345678901234567", domain: "tiktok.com", title: "I rebuilt my entire app in a weekend", author: "devlog.sam", imageUrl: IMGS.retro, imageUrls: [IMGS.retro, IMGS.circuit, IMGS.laptop], description: "I rebuilt my entire app in a weekend — here's the timelapse #buildinpublic" }),
  R(7.0, { kind: "link", url: "https://sqlite.org/lang_explain.html", domain: "sqlite.org", title: "EXPLAIN Query Plan", siteName: "SQLite" }),
  R(7.5, { kind: "post", provider: "hackernews", url: "https://news.ycombinator.com/item?id=42419998", domain: "news.ycombinator.com", title: "Show HN: I made a tiny search engine for my 4,000 saved links | Hacker News", siteName: "Hacker News" }),
  R(8.0, { kind: "image", provider: "imgur", url: "https://imgur.com/gallery/golden-hour-cat", domain: "imgur.com", title: "golden hour cat", imageUrl: IMGS.watch, imageUrls: [IMGS.watch, IMGS.night, IMGS.ocean] }),
  R(8.5, { kind: "post", provider: "bluesky", url: "https://bsky.app/profile/moss.earth/post/3jxq1vdc22h2k", domain: "bsky.app", title: null, author: "Moss", description: "the thing nobody tells you about maintaining a tiny open source library is that the issue queue becomes a second job with worse benefits and no salary" }),
  R(9.0, { kind: "audio", provider: "soundcloud", url: "https://soundcloud.com/flying-lotus/coronus-the-terminator", domain: "soundcloud.com", title: "Coronus, The Terminator", author: "Flying Lotus", imageUrl: IMGS.dj, siteName: "SoundCloud" }),
  R(9.5, { kind: "link", provider: "github", url: "https://github.com/emilkowalski/sonner/pull/312", domain: "github.com", title: "Add swipe-to-dismiss direction prop · Pull Request #312 · emilkowalski/sonner", imageUrl: OGH("emilkowalski/sonner"), siteName: "GitHub", description: "Lets consumers choose which swipe direction dismisses the toast. Fixes #298." }),
  R(10.0, { kind: "post", provider: "reddit", url: "https://www.reddit.com/r/webdev/comments/1c2zzr8/deleted_thread_example/", domain: "reddit.com", status: "failed" }),
  R(10.5, { kind: "article", url: "https://overreacted.io/a-complete-guide-to-useeffect/", domain: "overreacted.io", title: "A Complete Guide to useEffect — overreacted", author: "Dan Abramov", siteName: "overreacted", description: "A deep dive into effects, dependencies, and why your mental model probably has a gap in it." }),
  R(11.0, { kind: "post", provider: "x", url: "https://x.com/kvlly/status/1731002209876543210", domain: "x.com", author: "kvlly", title: null, description: "الواجهات الجيدة لا تحتاج إلى شرح — التصميم الجيد يشرح نفسه بنفسه، وهذا هو الفرق بين التلميح والتوثيق الكامل للمنتج" }),
  R(11.5, { kind: "video", provider: "instagram", url: "https://www.instagram.com/reel/DHmW0y8vKqR/", domain: "instagram.com", title: "Timelapse: priming a canvas", author: "molly.louise", imageUrl: IMGS.abstract }),
  R(12.0, { kind: "link", provider: "github", url: "https://github.com/sindresorhus", domain: "github.com", title: "sindresorhus - Overview", siteName: "GitHub", description: "Full-Time Open-Sourcerer. Focuses on Swift & JavaScript. - sindresorhus" }),
  R(12.5, { kind: "image", provider: null, url: "https://cdn.example-cdn.io/paste/screenshot-2026-11-02-144201.png", domain: "cdn.example-cdn.io", title: "Screenshot 2026-11-02 at 14.42.01", imageUrl: IMGS.macbook }),
  R(13.0, { kind: "post", provider: "hackernews", url: "https://news.ycombinator.com/item?id=42430001", domain: "news.ycombinator.com", title: "A very long Hacker News story title that keeps going and going, describing a remarkably thorough investigation into why distributed consensus protocols remain deceptively difficult to implement correctly in production systems | Hacker News", siteName: "Hacker News" }),
  R(13.5, { kind: "audio", provider: "applemusic", url: "https://music.apple.com/us/album/kind-of-blue/268443092", domain: "music.apple.com", title: "Kind of Blue", author: "Miles Davis", siteName: "Apple Music" }),
  R(14.0, { kind: "post", provider: "instagram", url: "https://www.instagram.com/p/DHnQRst3vWx/", domain: "instagram.com" }),
  R(14.5, { kind: "article", provider: "substack", url: "https://reading.supply/@james/post/the-quiet-appeal-of-boring-software", domain: "reading.supply", title: "The Quiet Appeal of Boring Software", author: "James Young", siteName: "Reading Supply", description: "Nobody writes manifestos about software that just works. But the boring stack — SQLite, plain CSS, a cron job — is having a moment, and it's not nostalgia." }),
  R(15.0, { kind: "post", provider: "mastodon", url: "https://mastodon.social/@gankra/113400221199887766", domain: "mastodon.social", author: "gankra@mastodon.social", title: null, description: "every six months the rust community rediscovers that error messages are a user interface and I am once again begging you to print them like one" }),
  R(15.5, { kind: "video", provider: "loom", url: "https://www.loom.com/share/a1b2c3d4e5f6478899aabbccddeeff00", domain: "loom.com", title: "Walkthrough: new onboarding flow", author: "Priya N.", status: "processing" }),
  R(16.0, { kind: "link", url: "https://example.com/some/deep/page", domain: "example.com", status: "failed" }),
  R(16.5, { kind: "post", provider: "reddit", url: "https://www.reddit.com/r/UI_Design/comments/1d4aabb/calm_interfaces_are_the_new_minimal/", domain: "reddit.com", title: "Calm interfaces are the new minimal", author: "u/pixelpusher99", description: "Minimalism stripped the chrome; calm keeps the surface but lowers the noise floor. Layered shadows > borders, and hover reveals > always-on metadata.", imageUrl: IMGS.desert }),
  R(17.0, { kind: "link", url: "https://una.im/", domain: "una.im" }),
  R(17.5, { kind: "image", provider: "pinterest", url: "https://www.pinterest.com/pin/982356212345678/", domain: "pinterest.com", title: "brutalist poster grid studies", author: "grid.systems", imageUrl: IMGS.city }),
  R(18.0, { kind: "video", provider: "youtube", url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ", domain: "youtube.com", title: "Big Buck Bunny | Blender Foundation", author: "Blender", imageUrl: YT("aqz-KE-bpKQ"), siteName: "YouTube" }),
  R(18.5, { kind: "note", title: "Idea", content: "Idea\na dump card that folds the composer INTO the masonry — first column slot, always reachable" }),
  R(19.0, { kind: "post", provider: "hackernews", url: "https://news.ycombinator.com/item?id=42434444", domain: "news.ycombinator.com", title: "Stripe is hiring infrastructure engineers (YC W26) | Hacker News", siteName: "Hacker News" }),
  R(19.5, { kind: "article", url: "https://joshwcomeau.com/css/interactive-guide-to-flexbox/", domain: "joshwcomeau.com", title: "An Interactive Guide to Flexbox", author: "Josh Comeau", siteName: "Josh W. Comeau", imageUrl: IMGS.forest, description: "Flexbox is a deceptively complex layout mode. This guide builds intuition with interactive examples." }),
  R(20.0, { kind: "image", provider: "flickr", url: "https://www.flickr.com/photos/deleted-user/removed-photo/", domain: "flickr.com", title: "removed photo", status: "failed" }),
  R(20.5, { kind: "audio", provider: "spotify", url: "https://open.spotify.com/track/5ghIJDpPoe3CfHMGu71E6T", domain: "open.spotify.com", status: "processing" }),
  R(21.0, { kind: "video", provider: "twitch", url: "https://www.twitch.tv/videos/2345678901", domain: "twitch.tv", title: "[VOD] ship week: day three — theming pass", author: "hsk_victor", imageUrl: IMGS.night }),
  R(21.5, { kind: "post", provider: "x", url: "https://x.com/arranfrances/status/1732001234567890123", domain: "x.com", author: "arran", title: null, description: "shipped the redesign. nobody noticed. that's the point.", imageUrl: IMGS.car, imageUrls: [IMGS.car, IMGS.desert] }),
];

const stmt = db.prepare(`INSERT INTO dumps (id, kind, topic, status, url, domain, provider, title, description, content, note, image_url, image_urls, site_name, author, summary, subject, tags, classified_by, topic_locked, created_at, updated_at)
  VALUES (@id, @kind, @topic, @status, @url, @domain, @provider, @title, @description, @content, @note, @image_url, @image_urls, @site_name, @author, @summary, @subject, @tags, @classified_by, @topic_locked, @created_at, @updated_at)`);

const ins = db.transaction((rs) => {
  for (const r of rs) {
    const t = r.created;
    stmt.run({
      id: randomUUID(),
      kind: r.kind,
      topic: "tech",
      status: r.status ?? "ready",
      url: r.url ?? null,
      domain: r.domain ?? null,
      provider: r.provider ?? null,
      title: r.title ?? null,
      description: r.description ?? null,
      content: r.content ?? null,
      note: r.note ?? null,
      image_url: r.imageUrl ?? null,
      image_urls: r.imageUrls?.length ? JSON.stringify(r.imageUrls) : null,
      site_name: r.siteName ?? null,
      author: r.author ?? null,
      summary: null,
      subject: null,
      tags: "[]",
      classified_by: "rules",
      topic_locked: 0,
      created_at: t,
      updated_at: t,
    });
  }
});
ins(rows);
console.log(`seeded ${rows.length} dumps`);
