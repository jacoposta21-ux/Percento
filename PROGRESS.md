# PROGRESS

One line per task: task — result — issues.

- M1 setup: package.json, shared config, pair rules, Rome-date daily module, dataset loader — done — none.
- M1 validator (schema, values, authoritative-domain allowlist, caps, tone share, near-duplicates, legal partner; production targets as errors) + 10 unit tests — pass — none.
- Environment check — BLOCKER for M2 verification: shell egress allows only package registries; WebFetch fails DNS on every host; only WebSearch works (excerpts, not pages). Plan: collect candidates as "unverified" with quoted evidence and add `npm run verify-sources` to promote them once network access exists.
- M2 research: 328 candidate entries from ~60 official sources via official-domain search excerpts, all 'unverified' (NOT_OPENED / HEDGED / CONFLICT reasons); dev-mode validation 0 errors 0 warnings — production pool 0 (blocked: pages cannot be opened).
- M2 tooling: verify-sources (fetch page, PDF via pdftotext, evidence-in-order match, hedge detection, value-in-evidence check) + review generator for DATA_REVIEW.md; validator now rejects values not present in evidence — tests 13/13 pass.
