// Opens each candidate's source page and promotes it to "verified" only when
// the quoted evidence (and so the number) is actually on the page.
//
//   npm run verify-sources              # NOT_OPENED candidates only
//   npm run verify-sources -- --all     # every unverified entry
//   npm run verify-sources -- --dry-run # report, change nothing
//   npm run verify-sources -- --id=x,y  # just these entries
//
// Rules applied (see README "Data rules"):
// - every part of `evidence` (parts separated by "…") must appear on the page,
//   in order, close together;
// - a hedge word right before the number ("about 71%") keeps it unverified;
// - the card value must equal a number in the evidence (allowing rounding to
//   one decimal, or a stated ratio such as 0.380 → 38.0);
// - PDFs are converted with `pdftotext` (poppler) when it is installed.
// Results are written back to data/entries/*.json and logged to
// data/verification-log.json for DATA_REVIEW.md.
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { DATA_DIR, ROOT, argValue } from './lib/data.mjs';

const today = new Date().toISOString().slice(0, 10);
const DRY = process.argv.includes('--dry-run');
const ALL = process.argv.includes('--all');
const ONLY = argValue('id', '') ? new Set(argValue('id', '').split(',')) : null;
const LOG_FILE = join(ROOT, 'data', 'verification-log.json');

const HEDGES = ['about', 'around', 'approximately', 'approx', 'nearly', 'almost', 'roughly', 'up to',
  'some', 'over', 'more than', 'less than', 'under', 'circa', 'estimated', 'close to', 'just over',
  'just under', 'quasi', 'circa', 'oltre', 'meno di', 'più di', 'environ', 'près de', 'plus de',
  'etwa', 'rund', 'fast', 'über', 'aproximadamente', 'casi', 'cerca de', 'más de', '~'];

export function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

export const normalize = (s) => s
  .toLowerCase()
  .replace(/[‘’“”"']/g, '')
  .replace(/[‐-―]/g, '-')
  .replace(/[|•·]/g, ' ')
  .replace(/(\d)\s+%/g, '$1%')
  .replace(/\s+/g, ' ')
  .trim();

/** Finds evidence parts in order; returns the index of the first part or -1. */
export function findEvidence(text, evidence, window = 400) {
  const parts = evidence.split('…').map((p) => normalize(p)).filter(Boolean);
  let from = 0;
  let first = -1;
  for (const part of parts) {
    const at = text.indexOf(part, from);
    if (at === -1 || (first !== -1 && at - from > window)) return -1;
    if (first === -1) first = at;
    from = at + part.length;
  }
  return first;
}

export function hedgedBefore(text, index) {
  const before = text.slice(Math.max(0, index - 25), index);
  return HEDGES.some((h) => new RegExp(`(^|[^a-z])${h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`).test(before));
}

const NUMBER_WORDS = { 'twenty-six': 26, 'thirty-one': 31, 'thirty-eight': 38, 'forty-five': 45, ninety: 90 };

const roundsTo = (n, value) => [n, n * 100].some((c) =>
  Math.abs(Math.round(c * 10) / 10 - value) < 1e-9 || Math.abs(Math.round(c) - value) < 1e-9);

/** True when the card value is one of the evidence numbers (or its rounding / ratio form). */
export function valueMatchesEvidence(value, evidence) {
  const nums = (evidence.match(/\d+(?:[.,]\d+)?/g) || []).map((n) => Number(n.replace(',', '.')));
  for (const [w, n] of Object.entries(NUMBER_WORDS)) if (evidence.toLowerCase().includes(w)) nums.push(n);
  return nums.some((n) => roundsTo(n, value));
}

/** Offset (within `span`) of the first number token that matches the card value, or 0. */
export function valueOffset(span, value) {
  const re = /\d+(?:[.,]\d+)?/g;
  let m;
  while ((m = re.exec(span))) if (roundsTo(Number(m[0].replace(',', '.')), value)) return m.index;
  return 0;
}

async function fetchText(url) {
  const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (PERCENTO source verifier)' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = res.headers.get('content-type') || '';
  const buf = Buffer.from(await res.arrayBuffer());
  if (type.includes('pdf') || buf.subarray(0, 4).toString() === '%PDF') {
    const dir = mkdtempSync(join(tmpdir(), 'percento-pdf-'));
    const file = join(dir, 'source.pdf');
    writeFileSync(file, buf);
    try {
      return execFileSync('pdftotext', ['-layout', file, '-'], { maxBuffer: 64 * 1024 * 1024 }).toString();
    } catch {
      throw new Error('PDF_NEEDS_TOOL: install poppler-utils (pdftotext) to read PDF sources');
    }
  }
  return htmlToText(buf.toString('utf8'));
}

async function main() {
  const log = existsSync(LOG_FILE) ? JSON.parse(readFileSync(LOG_FILE, 'utf8')) : {};
  const files = readdirSync(DATA_DIR).filter((f) => f.endsWith('.json'));
  const pageCache = new Map();
  let promoted = 0;
  let checked = 0;

  for (const file of files) {
    const path = join(DATA_DIR, file);
    const entries = JSON.parse(readFileSync(path, 'utf8'));
    let changed = false;
    for (const e of entries) {
      if (e.status !== 'unverified') continue;
      if (ONLY && !ONLY.has(e.id)) continue;
      if (!ONLY && !ALL && !e.reviewReason.startsWith('NOT_OPENED')) continue;
      checked++;
      const url = e.verifiedUrl || e.sourceUrl;
      let outcome;
      try {
        if (!pageCache.has(url)) pageCache.set(url, normalize(await fetchText(url)));
        const text = pageCache.get(url);
        const at = findEvidence(text, e.evidence || '');
        if (at === -1) outcome = { result: 'NOT_FOUND', detail: 'evidence text not found on the page' };
        else if (hedgedBefore(text, at + valueOffset(text.slice(at, at + 600), e.value))) outcome = { result: 'HEDGED', detail: 'the page hedges the number' };
        else if (!valueMatchesEvidence(e.value, e.evidence)) outcome = { result: 'VALUE_MISMATCH', detail: `value ${e.value} is not a number in the evidence` };
        else outcome = { result: 'VERIFIED' };
      } catch (err) {
        outcome = { result: 'UNREACHABLE', detail: String(err.message || err) };
      }
      log[e.id] = { ...outcome, url, checkedOn: today };
      console.log(`${outcome.result.padEnd(14)} ${e.id}${outcome.detail ? `  (${outcome.detail})` : ''}`);
      if (DRY) continue;
      if (outcome.result === 'VERIFIED') {
        e.status = 'verified';
        e.verifiedOn = today;
        delete e.reviewReason;
        promoted++;
      } else {
        e.reviewReason = `${outcome.result}: ${outcome.detail} (checked ${today}; ${url}).`;
      }
      changed = true;
    }
    if (changed) writeFileSync(path, `${JSON.stringify(entries, null, 2)}\n`);
  }
  if (!DRY) writeFileSync(LOG_FILE, `${JSON.stringify(log, null, 2)}\n`);
  console.log(`\nchecked ${checked}, promoted ${promoted}${DRY ? ' (dry run)' : ''}`);
  console.log('Next: npm run review (regenerates DATA_REVIEW.md), then npm run validate.');
}

if (import.meta.url === `file://${process.argv[1]}`) main();
