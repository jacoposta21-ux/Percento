# PERCENTO

*Compare the incomparable.* A mobile-first higher-or-lower web game. Two cards, each holding a real, sourced percentage about topics that have nothing to do with each other. Pick the higher one; the **Percentometer** dial reveals both values with source and year.

- **Endless**: the higher card stays, a new card arrives, one wrong answer ends the run. Personal best is saved on the device.
- **Daily Challenge**: 10 pairs, the same for everyone, new at midnight Europe/Rome. One attempt per day, each answer saved immediately (reload resumes, never replays). Share a 🟩🟥 grid and a link.
- **Sources**: every statistic in the game with its link and year.

No runtime dependencies: plain HTML, CSS and ES modules. Node ≥ 20 for the tooling.

## Run

```bash
npm run dev            # validate (dev), build with ALL entries incl. unverified + review mode, serve on :8080
npm run build          # production gate: validate (production) then build dist/ with verified entries only
npm run serve          # serve dist/ on http://127.0.0.1:8080 (PORT=… to change)
npm test               # unit tests: validator, pair rules, 1,000-pair simulation, daily/DST, share, verifier
npm run test:e2e       # headless Chromium: full games at 360px and 1280px, light/dark, a11y checks
npm run simulate -- --mode=dev     # pairing-rule report (--mode=production for the verified pool)
npm run verify-sources # open every source page, promote entries whose evidence is on the page
npm run review         # regenerate DATA_REVIEW.md
```

`npm run test:e2e` needs Chromium. It uses `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` by default; set `CHROMIUM_PATH` to use another one, and run `npm install` first for `playwright-core` (dev dependency only).

## Deploy

`dist/` is a static site: upload it to any static host (Netlify, Vercel, GitHub Pages, S3 + CloudFront, nginx). No server code, no build step on the host. Routing uses `#/` hashes, so no rewrite rules are needed.

```bash
npm ci && npm run build   # fails unless the production pool meets every target
# upload dist/
```

`npm run build` deliberately fails while fewer than 300 entries are verified (see below).

## Data

Each data file in `data/entries/*.json` is an array of entries:

| field | meaning |
|---|---|
| `id`, `text` (≤140 chars, English), `value` (0.1–100, 1 decimal) | the card |
| `source`, `sourceTitle`, `sourceUrl`, `verifiedUrl?`, `pdf?` | where it comes from (authoritative domains only, see `scripts/lib/sources.mjs`) |
| `year` | data reference year if stated, else publication year |
| `category`, `tone` (`serious`/`curious`/`silly`), `country` (ISO3, `WORLD`, `EU`, `OECD`), `indicator` | balancing |
| `status` (`verified`/`unverified`), `addedOn`, `evidence`, `verifiedOn`, `reviewReason` | provenance |

The validator (`scripts/validate.mjs`) fails the build on: missing or unknown fields, invalid values, values that are not a number in their `evidence`, non-authoritative URLs, more than 3 entries per indicator, more than 15% of the pool from one source, more than 20% from one country, less than 40% curious/silly, near-duplicate texts, entries with no legal partner, and (production only) fewer than 300 entries / 13 categories / 20 per category.

**Daily stability.** An entry may appear in a daily set only from the day *after* its `addedOn` (or `verifiedOn`, if it was promoted later). The set is seeded from the Rome date and computed over the pool sorted by id, so adding or promoting data never changes today's or past challenges.

## Current status: data is not yet verified

The game, tooling and tests are complete, but **production currently serves 0 statistics**. The research environment could not open any statistics website: its network policy allowed only package registries, and the page fetcher could not resolve any host. All 328 candidates were collected from search excerpts restricted to the official source domain, with the exact wording quoted in `evidence`. The data rules require the source page itself to be opened, so every entry is `unverified` and listed in [DATA_REVIEW.md](DATA_REVIEW.md).

To publish, on a machine with internet access:

```bash
sudo apt-get install poppler-utils   # pdftotext, for PDF sources
npm run verify-sources               # promotes entries whose quoted evidence and value are on the page
npm run review && npm run validate && npm run build
```

Entries that fail (hedged wording, different number, page moved) stay unverified, with the reason written into the entry and DATA_REVIEW.md. Then a human checks the 10% spot-check sample in DATA_REVIEW.md.

## Layout

```
index.html, styles.css      app shell and styles (light + dark)
src/app.js                  router, screens, round engine
src/pairs.js                pairing rules + seeded PRNG (shared with Node tooling)
src/daily.js                Rome date, DST-safe midnight, deterministic daily set
src/dial.js                 Percentometer SVG + needle physics
src/copy.js                 headlines, quips, end-screen lines
src/share.js, storage.js    share/copy flow, safe localStorage
scripts/                    validate, build, serve, simulate, verify-sources, review
data/entries/               dataset, one file per source family
tests/, e2e/                unit tests (node:test), browser QA (playwright-core)
```
