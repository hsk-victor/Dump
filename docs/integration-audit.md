# Tailored cards — integration audit

Gate before the `devin/tailored-cards` PR: verify the 12 redesigned card types
compose into one seamless feed. Not a redesign review.

## Method

- Seeded `data/dump.db` directly (`scripts/seed-audit.mjs`): 45 dumps in one
  topic, 2–3 of every card type plus edge states — dead X post, dead reddit
  thread, failed image (flickr), failed link (example.com), processing video
  (loom), processing audio (spotify), Arabic RTL note + RTL post, long HN
  title, bare-URL link, sparse Instagram post, galleries with 1/N counters.
- Audited `npm run dev` feed via CDP screenshots: full page light + dark,
  390px mobile (light + dark), and real-hover captures per card family.

## Findings

### SEAM-BREAKER — fixed in this commit

- **Thumbnail-less video card hides its provider glyph.** `.d-vph` centers a
  2.6rem provider icon dead-center in the 16:9 frame, but `.d-play` (2.75rem,
  same center) renders on top and fully occludes it — the loom card read as an
  empty grey box with a lone play button. Fixed: `.d-vph .d-prov` enlarged to
  4.4rem so the brand glyph forms a visible medallion behind the tinted play
  badge (same shape relationship as YouTube's `.d-vid-placeholder`). One-line
  CSS change in `src/app/globals.css`; verified in capture.

### NIT — reported, not fixed (bigger than a safe CSS tweak)

- **Failed dumps are indistinguishable at rest.** `status="failed"` link/image
  dumps render as ordinary cards (e.g. "removed photo" blue-link bookmark); the
  only signal is `Retry` in the hover meta row. By design (dead → tombstone,
  failed → keep card), but a subtle at-rest affordance for failed state would
  close the loop. Deliberately untouched — needs a design decision.
- **Processing audio with a known title looks finished.** MusicCard shows
  shimmer only when title is absent; with a domain-derived title the widget
  renders complete with transport + progress. Media-first cards show the
  `Sorting…` chip even when titled. Consistent with the text-card convention
  (title present = render), so left alone.
- **Post card can duplicate handle and author.** When `author` equals the
  handle source (seed edge: `gankra@mastodon.social` author + `mastodon.social`
  byline), name and byline read near-identically. Dedupe in shared byline logic
  was deemed riskier than the cosmetic cost.
- **YouTube no-thumbnail placeholder** has the same under-play occlusion
  pattern (3rem icon vs 2.75rem play, ~1px peek). Extremely rare in practice
  (YouTube thumbs are near-always present); left at its deliberate size.
- **Long HN titles clamp mid-word** via `-webkit-line-clamp` — standard
  ellipsis behavior, noted for completeness.

### FINE — verified consistent

- **Visual rhythm.** One family: `var(--radius)` corners, borderless cards on
  soft layered shadows, shared type scale and paddings across all 12 types.
  The flat-orange HN card and platform-native YouTube card are deliberate
  directions, not leaks.
- **Hover actions.** `.d-actions` pill appears top-right on hover/focus-within
  for every card; on coarse pointers media cards (`.d-mediacard`, `.d-mus`)
  hide actions until `data-open`, text cards dock them beside the meta row
  with reserved space — verified in stylesheet and hover captures.
- **Glass panels.** `.d-mpanel` reveals identically on Media, Video,
  Instagram and GitHub cards (rise + fade on `:hover`/`:focus-within`,
  `data-open` pins it, failed dumps keep it open for Retry).
- **Roundels + counters.** `.d-mmark` bottom-left and `.d-mcount` top-right are
  uniform across mediacard/vidcard/igcard/ghcard; `.d-gh-tag` shares the
  top-right and yields to the actions pill (fades on hover/data-open).
- **GitHub banner.** The og:image (repo name, description, stats) IS the card
  face; hover panel surfaces repo/issue/PR label + meta — consistent with
  media-card mechanics. Compact kicker+headline fallback when no image
  (verified on `sindresorhus` profile with `image_url: null`).
- **Tombstones.** Dead X ("This post doesn't exist."), dead reddit ("This
  thread doesn't exist."), dead GitHub ("This GitHub page doesn't exist.") —
  same centered muted treatment.
- **Processing.** `Sorting…` shimmer chip bottom-left on media cards; shimmer
  lines in body on text cards when title is absent.
- **RTL.** Arabic note flips the red margin rule to the right edge; Arabic X
  post aligns correctly; `dir="auto"` throughout.
- **Dark mode.** All cards hold: glass panels, shadows, scrims, brand accents
  adapt; nothing washed out or invisible.
- **Mobile (390px).** Two-column masonry at 0.62× scale — no overflow, no
  clipped counters/roundels, reveal paths intact.
- **Worst-case neighbors.** Large media card beside one-line note beside HN
  card: the masonry still breathes; no card crowds or clips its neighbor.

## Non-findings

- Composer bar rendered mid-page in full-page screenshots is a
  `captureBeyondViewport` artifact of the capture tool, not a layout bug.
- Instagram reel's top-left film glyph is the intentional `.d-ig-flag`
  reel marker, not a stray icon.

## Verification

`npm run lint`, `npx tsc --noEmit`, `npm test` — all clean (see commit).
