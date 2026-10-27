# Eyeball

Live at https://eyeball.cloud. Formerly PERCENTO; browser storage keys keep the `percento:` prefix so players keep their records.

*Compare the incomparable.* A mobile-first higher-or-lower web game. Two cards, each holding a real, sourced percentage about topics that have nothing to do with each other. Pick the higher one; the ruler reveals both values with source and year.

- **Home**: three doors only. **Single player** (the four games, mixed or by category, `#/solo`), **Multiplayer** (the same four games live, `#/online`) and the **Daily challenge**; the leaderboard sits on the right on desktop.
- **Multiplayer**: pick one of the four games and the cards (mixed or one category), then **Find a game** (strangers; public games are matched by game and category), **Create a room** (friends) or join with a code. Higher or lower, Match the card and Odd one out are last one standing (same seeded questions for everyone, 15 s each, one mistake and you are out); Closest guess runs 10 cards on the server clock.
- **Endless**: two new cards every round; a right answer moves on by itself, one wrong answer ends the run. Play **mixed** (cards from different categories) or **by category** (both cards from one of 13 topics; best streak per category).
- **Online, last one standing**: up to 10 signed-in players get the same cards in the same order, 15 seconds per card; one mistake (or the clock) and you are out, whoever goes furthest wins. Live standings. **Find a game** matches strangers (a public game starts 20 s after a second player joins, at once with 10); **Room with friends** is private, optionally limited to one category, started by the host.
- **Closest guess**: one card at a time; drag the slider to the percentage you think it is, 15 seconds per card, 10 cards. 100 points for a bull's-eye, 3 fewer per point off. Solo (mixed or by category) or online (strangers or a private room): rounds run on the server clock, everyone's guesses appear on a ruler after each card, the server hides other players' guesses until the round ends and rejects late ones.
- **Match the card**: one percentage and two statistics; tap the one it belongs to. The other card is usually within 20 points, so it is not a giveaway. A miss ends the run; best streak per category. Also online (last one standing).
- **Odd one out**: four statistics from four different topics, three within 10 points of each other and one 12–40 points away (in a random position). A card only becomes the outsider when no other card could be read as one. After the pick all four values appear on a ruler with a one-line explanation. A miss ends the run; best streak per category. Also online (last one standing).
- **Daily habit**: two daily challenges, the same for everyone, 10 seconds per card: Higher or lower (10 pairs) and Closest guess (5 cards, share grid 🎯🟩🟨🟥). A 🔥 streak counts days in a row with either one finished. After each daily, "Everybody today" shows the score distribution and "better than X% of today's players".
- **What everybody answered**: after each reveal, "62% of players got this one right" (pairs) or "Players guess 41% on average, usually 12 points off" (closest guess). Shared counters in Supabase that guests feed too.
- **Sound**: effects and a generative music loop made with the Web Audio API (no audio files); one mute button, separate switches in Settings.
- **Accounts** (optional): email + password or Google. Endless runs and Daily answers are saved to the account and count on the world leaderboard. Guests keep everything on their device.
- **Daily Challenge**: 10 pairs, the same for everyone, new at midnight Europe/Rome. One attempt per day, each answer saved immediately (reload resumes, never replays). Share a 🟩🟥 grid and a link.
- **Sources**: every statistic in the game with its link and year.

Plain HTML, CSS and ES modules. The only runtime library is supabase-js (vendored in `vendor/`, loaded in the background); if it or the server is unreachable, the game keeps working as a guest. Node ≥ 20 for the tooling.

## Languages

English, Italian, French, Spanish, German and Portuguese. The game picks the browser's language (Settings → Language to change it).

- Interface: `src/locales/<lang>.js`, keyed by the English text (`t('Play again')` in the code, `{name}` placeholders). `npm run i18n` lists strings missing in any language after the code changes; the unit tests fail on missing strings or mismatched placeholders.
- Cards: `data/i18n/<lang>.json` maps each card id to `[text, detail]` (text ≤ 80, detail ≤ 70 characters, no percentages). The build writes `src/cards/<lang>.js` for the cards it ships. A new card without a translation shows in English and fails the unit tests until it is translated.
- Percentages follow the language's number format (12.5% / 12,5 %). Daily challenges, rooms, leaderboards and "what everybody answered" are shared across languages: they work on card ids, not texts.
- Translations were machine-made by a model and checked automatically (placeholders, lengths, no answers revealed); a native-speaker read-through is still recommended, especially for the jokes.

## Online backend (Supabase)

Project `percento` (eu-central-1). Schema, row level security and the room functions are in `supabase/migrations/`. The browser uses the publishable key in `src/online-config.js`; the database rules decide what it may do (players write only their own rows; rooms are created, joined, started and scored only through `create_room`, `join_room`, `start_room`, `report_room_score`, which enforce 10 players, host-only start and no joining after the start).

One-time settings in the Supabase dashboard (Authentication):

1. **URL Configuration**: Site URL `https://eyeball.cloud`, and add it (plus `https://percento-virid.vercel.app`) to Redirect URLs. Without this, confirmation emails and Google sign-in send players to localhost.
2. **Email**: the built-in mailer only delivers to members of the Supabase team and a few emails per hour. Either set up custom SMTP (Authentication → Emails → SMTP, e.g. Resend or Brevo), or switch off "Confirm email" (Sign In / Providers → Email) so players are signed in immediately.
3. **Guests online**: switch on "Allow anonymous sign-ins" (Authentication → Sign In / Providers). Guests pick a nickname and play online without email; they can later add an email and password on the Account page and keep their name and records. Until it is on, the guest button says guest play is not switched on yet. Supabase suggests turning on CAPTCHA protection once the game is public.
4. **Google**: create an OAuth client in Google Cloud Console (Web application, redirect URI `https://tsbdkvgfdnalxgahnvnp.supabase.co/auth/v1/callback`), then paste its client ID and secret in Sign In / Providers → Google. Until then the Google button explains it is not switched on.

The e2e suite never touches the real backend: `e2e/fake-supabase.js` stands in for it in the browser (two tabs play a full room against each other).

## Run

```bash
npm run dev            # validate (dev), build with ALL entries incl. unverified + review mode, serve on :8080
npm run build          # production gate: validate (production) then build dist/ with verified entries only
npm run serve          # serve dist/ on http://127.0.0.1:8080 (PORT=… to change)
npm test               # unit tests: validator, pair rules, 1,000-pair simulation, daily/DST, share, verifier
npm run test:e2e       # headless Chromium: full games at 360px and 1280px, a11y checks, accounts and a 2-player room
npm run simulate -- --mode=dev     # pairing-rule report (--mode=production for the verified pool)
npm run verify-sources # open every source page, promote entries whose evidence is on the page
npm run review         # regenerate DATA_REVIEW.md
```

`npm run test:e2e` needs Chromium. It uses `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` by default; set `CHROMIUM_PATH` to use another one, and run `npm install` first for `playwright-core` (dev dependency only).

## Deploy

**CrazyGames build**: `npm run build:crazygames` writes `crazygames/eyeball-crazygames.zip` (upload it in the CrazyGames developer portal; covers and the preview video are in `crazygames/`). That build follows the portal rules: online play is guest-only (no email or Google sign-in), shared texts and room invites carry no link back to eyeball.cloud, and Vercel analytics is left out.

`dist/` is a static site: upload it to any static host (Netlify, Vercel, GitHub Pages, S3 + CloudFront, nginx). No server code, no build step on the host. Routing uses `#/` hashes, so no rewrite rules are needed. Accounts and rooms talk to Supabase directly from the browser.

```bash
npm ci && npm run build   # fails unless the production pool meets every target
# upload dist/
```

`npm run build` fails while fewer than 300 entries are playable (verified or approved; see below).

## Data

Each data file in `data/entries/*.json` is an array of entries:

| field | meaning |
|---|---|
| `id`, `text` (≤140 chars, English), `value` (0.1–100, 1 decimal) | the card |
| `source`, `sourceTitle`, `sourceUrl`, `verifiedUrl?`, `pdf?` | where it comes from (authoritative domains only, see `scripts/lib/sources.mjs`) |
| `year` | data reference year if stated, else publication year |
| `category`, `tone` (`serious`/`curious`/`silly`), `country` (ISO3, `WORLD`, `EU`, `OECD`), `indicator` | balancing |
| `status` (`verified`/`approved`/`unverified`), `addedOn`, `evidence`, `verifiedOn`, `approvedOn`, `reviewReason` | provenance |

The validator (`scripts/validate.mjs`) fails the build on: missing or unknown fields, invalid values, values that are not a number in their `evidence`, non-authoritative URLs, more than 3 entries per indicator, more than 15% of the pool from one source, more than 20% from one country, less than 40% curious/silly, near-duplicate texts, entries with no legal partner, and (production only) fewer than 300 entries / 13 categories / 20 per category.

**Daily stability.** An entry may appear in a daily set only from the day *after* its `addedOn` (or `verifiedOn`, if it was promoted later). The set is seeded from the Rome date and computed over the pool sorted by id, so adding or promoting data never changes today's or past challenges.

## Approximate entries

`data/entries/approx-*.json` (about 200 cards) were added for category play from well-established general knowledge, at the founder's request, without opening the source page. They carry `reviewReason: "APPROX: …"`, are listed in DATA_REVIEW.md, and like every unverified entry are served only by the dev build.

## Current status: founder-approved data

All 497 cards are `approved`: on 2026-10-23 the founder read them in a review page and accepted them all, so production serves them. None is `verified` yet, because no source page could be opened from the research environment (its network policy allowed only package registries). About 200 cards (`approx-*.json`) are figures from general knowledge rather than from a search excerpt of the source.

Statuses: `verified` (the quoted evidence and the number were found on the source page; `verifiedOn`), `approved` (accepted by the founder without opening the source; `approvedOn`, keeps its `reviewReason`), `unverified` (dev build only). Production plays `verified` and `approved`.

To check the sources properly, on a machine with internet access:

```bash
sudo apt-get install poppler-utils   # pdftotext, for PDF sources
npm run verify-sources               # promotes entries whose quoted evidence and value are on the page
npm run review && npm run validate && npm run build
```

Entries that fail (hedged wording, different number, page moved) keep their status, with the reason written into the entry and DATA_REVIEW.md.

## Layout

```
index.html, styles.css      app shell and styles (light + dark)
src/app.js                  router, screens, round engine
src/pairs.js                pairing rules + seeded PRNG (shared with Node tooling)
src/daily.js                Rome date, DST-safe midnight, deterministic daily set
src/dial.js                 percentage ruler SVG + needle physics
src/copy.js                 headlines, quips, end-screen lines
src/share.js, storage.js    share/copy flow, safe localStorage
src/online.js               accounts, saved progress, leaderboards, rooms (Supabase)
src/audio.js, icons.js      synthesised sound and music; line icons for categories
vendor/fonts/               Unbounded + Rethink Sans (OFL), self-hosted
vendor/                     supabase-js UMD build (pinned)
supabase/migrations/        database schema and rules
scripts/                    validate, build, serve, simulate, verify-sources, review
data/entries/               dataset, one file per source family
tests/, e2e/                unit tests (node:test), browser QA (playwright-core)
```
