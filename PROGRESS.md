# PROGRESS

One line per task: task — result — issues.

- M1 setup: package.json, shared config, pair rules, Rome-date daily module, dataset loader — done — none.
- M1 validator (schema, values, authoritative-domain allowlist, caps, tone share, near-duplicates, legal partner; production targets as errors) + 10 unit tests — pass — none.
- Environment check — BLOCKER for M2 verification: shell egress allows only package registries; WebFetch fails DNS on every host; only WebSearch works (excerpts, not pages). Plan: collect candidates as "unverified" with quoted evidence and add `npm run verify-sources` to promote them once network access exists.
- M2 research: 328 candidate entries from ~60 official sources via official-domain search excerpts, all 'unverified' (NOT_OPENED / HEDGED / CONFLICT reasons); dev-mode validation 0 errors 0 warnings — production pool 0 (blocked: pages cannot be opened).
- M2 tooling: verify-sources (fetch page, PDF via pdftotext, evidence-in-order match, hedge detection, value-in-evidence check) + review generator for DATA_REVIEW.md; validator now rejects values not present in evidence — tests 13/13 pass.
- M3 Endless: round engine, Percentometer SVG dial (damped swing, synced count-up), scoring, game over, personal best (storage wrapped, memory fallback) — e2e pass — fixed hidden-attribute CSS override and array flattening bug.
- M4 Pair generator: legal pairs, no repeats per session, fresh-card preference, 92% cross-family bias, champion retire when nothing higher — fixed bias (newcomer was higher only 11% of the time → coin flip decided first); 1,000-pair sim: 0 violations, 97.7% cross-family.
- M5 Daily: Rome-date seed, eligibility = day after max(addedOn, verifiedOn), answers saved per pair, resume on reload, DST-exact countdown — unit tests incl. 23h/25h days pass.
- M6 Share: Wordle grid + link, native share on touch devices, clipboard + execCommand fallback, toast — e2e clipboard check pass.
- M7 Sources page grouped by category with link + year; dev-only review mode — pass.
- M8 Polish: copy (28 headlines, 28 quips, end lines), 360px layout, AA contrast light+dark, 44px targets incl. inline links (fixed "FAO" 41px), keyboard 1/2/↑/↓/Enter, reduced motion — e2e 212 checks pass.
- M9 Final QA: unit 27/27, e2e 212/212, dev validation 0 errors, 1,000-pair sim 0 violations / 97.7% cross-family; production validation FAILS (0 verified) — true blocker: no network access to sources from the build environment; README + DATA_REVIEW.md delivered.
