// Dataset validation. Returns { errors, warnings, stats } for a set of entries.
// mode "production": only verified entries form the pool and every target
// (size, category spread, tone share) is enforced. mode "dev": the pool is
// every entry; schema and caps are still enforced, targets become warnings.
import { CATEGORY_IDS, RULES, STATUSES, TONES } from '../../src/config.js';
import { isLegalPair } from '../../src/pairs.js';
import { isAuthoritativeUrl } from './sources.mjs';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const REQUIRED = ['id', 'text', 'value', 'source', 'sourceUrl', 'year', 'category', 'tone',
  'status', 'addedOn', 'country', 'indicator'];
const KNOWN = new Set([...REQUIRED, 'evidence', 'verifiedOn', 'verifiedUrl', 'reviewReason',
  'sourceTitle', 'unit', 'notes', 'pdf']);

const isValidDate = (s) => typeof s === 'string' && ISO_DATE.test(s) && !Number.isNaN(Date.parse(s))
  && new Date(s).toISOString().slice(0, 10) === s;

const words = (text) => new Set(text.toLowerCase().replace(/[^a-z0-9% ]+/g, ' ').split(/\s+/).filter((w) => w.length > 2));

function jaccard(a, b) {
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  const union = a.size + b.size - inter;
  return union ? inter / union : 0;
}

const share = (count, total) => (total ? count / total : 0);
const pct = (x) => `${(x * 100).toFixed(1)}%`;

function countBy(list, key) {
  const map = new Map();
  for (const e of list) map.set(key(e), (map.get(key(e)) || 0) + 1);
  return map;
}

export function validateEntry(e, today) {
  const errs = [];
  const where = `[${e?.id ?? '?'}]`;
  for (const f of REQUIRED) {
    if (e[f] === undefined || e[f] === null || e[f] === '') errs.push(`${where} missing field "${f}"`);
  }
  for (const f of Object.keys(e)) if (!KNOWN.has(f)) errs.push(`${where} unknown field "${f}"`);
  if (typeof e.id === 'string' && !ID.test(e.id)) errs.push(`${where} id must be kebab-case`);
  if (typeof e.text === 'string') {
    if (e.text.length > RULES.maxTextLength) errs.push(`${where} text is ${e.text.length} chars (max ${RULES.maxTextLength})`);
    if (/\d+(\.\d+)?\s*%/.test(e.text)) errs.push(`${where} text must not reveal a percentage`);
  } else if (e.text !== undefined) errs.push(`${where} text must be a string`);
  if (e.value !== undefined) {
    if (typeof e.value !== 'number' || !Number.isFinite(e.value)) errs.push(`${where} value must be a number`);
    else {
      if (e.value < 0.05 || e.value > 100) errs.push(`${where} value ${e.value} out of range (would show 0.0% or exceeds 100)`);
      if (Math.round(e.value * 10) / 10 !== e.value) errs.push(`${where} value ${e.value} must be rounded to 1 decimal`);
    }
  }
  if (e.year !== undefined) {
    const maxYear = Number(today.slice(0, 4));
    if (!Number.isInteger(e.year) || e.year < 1700 || e.year > maxYear) errs.push(`${where} invalid year ${e.year}`);
  }
  if (e.category !== undefined && !CATEGORY_IDS.includes(e.category)) errs.push(`${where} unknown category "${e.category}"`);
  if (e.tone !== undefined && !TONES.includes(e.tone)) errs.push(`${where} unknown tone "${e.tone}"`);
  if (e.status !== undefined && !STATUSES.includes(e.status)) errs.push(`${where} unknown status "${e.status}"`);
  if (e.addedOn !== undefined) {
    if (!isValidDate(e.addedOn)) errs.push(`${where} addedOn must be YYYY-MM-DD`);
    else if (e.addedOn > today) errs.push(`${where} addedOn ${e.addedOn} is in the future`);
  }
  for (const f of ['sourceUrl', 'verifiedUrl']) {
    if (e[f] === undefined) continue;
    if (typeof e[f] !== 'string' || !/^https:\/\//.test(e[f])) errs.push(`${where} ${f} must be an https URL`);
    else if (!isAuthoritativeUrl(e[f])) errs.push(`${where} ${f} is not on an authoritative domain: ${e[f]}`);
  }
  if (e.status === 'verified') {
    if (!e.evidence) errs.push(`${where} verified entry needs "evidence"`);
    if (!isValidDate(e.verifiedOn)) errs.push(`${where} verified entry needs a valid "verifiedOn"`);
    else if (e.verifiedOn > today) errs.push(`${where} verifiedOn is in the future`);
    if (e.reviewReason) errs.push(`${where} verified entry must not carry a reviewReason`);
  }
  if (e.status === 'unverified' && !e.reviewReason) errs.push(`${where} unverified entry needs "reviewReason"`);
  return errs;
}

export function validateDataset(entries, { mode = 'production', today = new Date().toISOString().slice(0, 10) } = {}) {
  const errors = [];
  const warnings = [];
  if (!Array.isArray(entries)) return { errors: ['dataset must be an array'], warnings, stats: {} };

  const ids = new Set();
  for (const e of entries) {
    errors.push(...validateEntry(e, today));
    if (ids.has(e.id)) errors.push(`[${e.id}] duplicate id`);
    ids.add(e.id);
  }

  const pool = mode === 'production' ? entries.filter((e) => e.status === 'verified') : entries;
  const total = pool.length;
  // Targets are hard errors in production and reminders in dev.
  const target = (msg) => (mode === 'production' ? errors : warnings).push(msg);

  // Caps.
  for (const [ind, n] of countBy(pool, (e) => e.indicator)) {
    if (n > RULES.maxPerIndicator) errors.push(`indicator "${ind}" used ${n} times (max ${RULES.maxPerIndicator})`);
  }
  // Share caps only mean something once the pool is large enough to hold them.
  const capsApply = total >= 50;
  for (const [src, n] of countBy(pool, (e) => e.source)) {
    if (capsApply && share(n, total) > RULES.maxSourceShare) errors.push(`source "${src}" is ${pct(share(n, total))} of the pool (max ${pct(RULES.maxSourceShare)})`);
  }
  for (const [c, n] of countBy(pool, (e) => e.country)) {
    if (capsApply && share(n, total) > RULES.maxCountryShare) errors.push(`country "${c}" is ${pct(share(n, total))} of the pool (max ${pct(RULES.maxCountryShare)})`);
  }

  // Near-duplicate texts.
  const bags = pool.map((e) => [e, words(e.text || '')]);
  for (let i = 0; i < bags.length; i++) {
    for (let j = i + 1; j < bags.length; j++) {
      if (jaccard(bags[i][1], bags[j][1]) >= RULES.nearDuplicateThreshold) {
        errors.push(`near-duplicate texts: [${bags[i][0].id}] and [${bags[j][0].id}]`);
      }
    }
  }

  // Every entry in the pool must have at least one legal partner.
  for (const e of pool) {
    if (!pool.some((o) => isLegalPair(e, o))) errors.push(`[${e.id}] has no legal partner in the ${mode} pool`);
  }

  // Targets.
  const byCategory = countBy(pool, (e) => e.category);
  const light = pool.filter((e) => e.tone === 'curious' || e.tone === 'silly').length;
  if (total < RULES.minTotal) target(`pool has ${total} entries (target ${RULES.minTotal})`);
  if (byCategory.size < RULES.minCategories) target(`pool covers ${byCategory.size} categories (target ${RULES.minCategories})`);
  for (const c of CATEGORY_IDS) {
    const n = byCategory.get(c) || 0;
    if (n < RULES.minPerCategory) target(`category "${c}" has ${n} entries (target ${RULES.minPerCategory})`);
  }
  if (share(light, total) < RULES.minLightToneShare) target(`curious/silly share is ${pct(share(light, total))} (target ${pct(RULES.minLightToneShare)})`);
  if (!capsApply && total) warnings.push(`pool of ${total} is too small for source/country share caps to apply`);

  const stats = {
    mode,
    total: entries.length,
    pool: total,
    verified: entries.filter((e) => e.status === 'verified').length,
    unverified: entries.filter((e) => e.status === 'unverified').length,
    byCategory: Object.fromEntries([...byCategory].sort()),
    byTone: Object.fromEntries([...countBy(pool, (e) => e.tone)].sort()),
    byCountry: Object.fromEntries([...countBy(pool, (e) => e.country)].sort((a, b) => b[1] - a[1])),
    bySource: Object.fromEntries([...countBy(pool, (e) => e.source)].sort((a, b) => b[1] - a[1])),
    lightToneShare: pct(share(light, total)),
  };
  return { errors, warnings, stats };
}
