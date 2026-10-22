// Dev helper: append candidate entries to a dataset file.
// Usage: node scripts/add-entries.mjs data/entries/<file>.json < entries.json
// Input is a JSON array; defaults fill status/addedOn/reviewReason for
// candidates whose source page has not been opened yet.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const file = process.argv[2];
const today = new Date().toISOString().slice(0, 10);
const incoming = JSON.parse(readFileSync(0, 'utf8'));
const current = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
const ids = new Set(current.map((e) => e.id));
const ORDER = ['id', 'text', 'value', 'year', 'category', 'tone', 'country', 'indicator', 'source',
  'sourceTitle', 'sourceUrl', 'verifiedUrl', 'pdf', 'status', 'evidence', 'verifiedOn', 'reviewReason', 'addedOn', 'notes'];

for (const raw of incoming) {
  if (ids.has(raw.id)) throw new Error(`duplicate id ${raw.id}`);
  const e = { status: 'unverified', addedOn: today, ...raw };
  if (e.status === 'unverified' && !e.reviewReason) {
    e.reviewReason = 'NOT_OPENED: the build environment could not open the source page (network policy); value and evidence are from an official-domain search excerpt. Run `npm run verify-sources`.';
  }
  const sorted = Object.fromEntries(ORDER.filter((k) => e[k] !== undefined).map((k) => [k, e[k]]));
  current.push(sorted);
  ids.add(e.id);
}
writeFileSync(file, `${JSON.stringify(current, null, 2)}\n`);
console.log(`${file}: ${current.length} entries`);
