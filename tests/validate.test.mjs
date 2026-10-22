import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDataset, validateEntry } from '../scripts/lib/validate.mjs';
import { isAuthoritativeUrl } from '../scripts/lib/sources.mjs';

const TODAY = '2026-10-22';
const base = (over = {}) => ({
  id: 'x-1',
  text: 'People who own a teapot',
  detail: 'UK · 2023',
  emoji: '🫖',
  value: 42.5,
  source: 'ONS',
  sourceUrl: 'https://www.ons.gov.uk/x',
  year: 2023,
  category: 'everyday',
  tone: 'curious',
  status: 'verified',
  addedOn: '2026-10-01',
  country: 'GBR',
  indicator: 'teapot-ownership',
  evidence: '42.5% of households',
  verifiedOn: '2026-10-02',
  ...over,
});

test('a well-formed entry passes', () => {
  assert.deepEqual(validateEntry(base(), TODAY), []);
});

test('missing fields fail', () => {
  const { source, ...rest } = base();
  assert.match(validateEntry(rest, TODAY).join(), /missing field "source"/);
});

test('invalid values fail', () => {
  assert.ok(validateEntry(base({ value: 12.34 }), TODAY).length, '2 decimals');
  assert.ok(validateEntry(base({ value: 0.04 }), TODAY).length, 'shows as 0.0%');
  assert.ok(validateEntry(base({ value: 101 }), TODAY).length, '> 100');
  assert.ok(validateEntry(base({ value: '40' }), TODAY).length, 'string');
  assert.ok(validateEntry(base({ text: 'x'.repeat(71) }), TODAY).length, 'too long');
  assert.ok(validateEntry(base({ text: 'Teapots: 42%' }), TODAY).length, 'reveals value');
  assert.ok(validateEntry(base({ category: 'gossip' }), TODAY).length, 'category');
  assert.ok(validateEntry(base({ tone: 'mean' }), TODAY).length, 'tone');
  assert.ok(validateEntry(base({ addedOn: '2027-01-01' }), TODAY).length, 'future');
  assert.ok(validateEntry(base({ year: 2030 }), TODAY).length, 'future year');
});

test('status-specific fields', () => {
  assert.ok(validateEntry(base({ evidence: undefined }), TODAY).length);
  assert.ok(validateEntry(base({ verifiedOn: undefined }), TODAY).length);
  assert.ok(validateEntry(base({ status: 'unverified', evidence: undefined, verifiedOn: undefined }), TODAY).length);
  assert.deepEqual(validateEntry(base({ status: 'unverified', verifiedOn: undefined, reviewReason: 'hedged' }), TODAY), []);
});

test('non-authoritative sources fail', () => {
  assert.equal(isAuthoritativeUrl('https://www.statista.com/x'), false);
  assert.equal(isAuthoritativeUrl('https://ec.europa.eu/eurostat/x'), true);
  assert.equal(isAuthoritativeUrl('https://notistat.it.evil.com'), false);
  assert.ok(validateEntry(base({ sourceUrl: 'https://www.bbc.co.uk/news' }), TODAY).length);
});

// Builds a pool that passes every cap, then breaks one rule at a time.
const CATS = ['nature', 'food', 'tech', 'sport', 'health', 'history', 'economy', 'everyday',
  'animals', 'geography', 'body', 'space', 'habits'];
const COUNTRIES = ['ITA', 'GBR', 'USA', 'JPN', 'BRA', 'IND', 'FRA', 'DEU', 'ESP', 'WORLD'];
const SOURCES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
const WORDS = 'apple banana cherry dragon eagle falcon garden harbor island jungle kettle lemon mango nectar orange pepper quartz river saddle tiger umbrella velvet walrus xylophone yacht zebra'.split(' ');
function goodPool(n = 312) {
  return Array.from({ length: n }, (_, i) => base({
    id: `e-${i}`,
    text: `${WORDS[i % 26]} ${WORDS[Math.floor(i / 26) % 26]} item${i} thing${i * 7}`,
    value: Math.round(((i * 37) % 997) / 10 + 0.5) / 1 % 100 + 0.1,
    category: CATS[i % 13],
    country: COUNTRIES[i % 10],
    source: SOURCES[i % 8],
    indicator: `ind-${Math.floor(i / 2)}`,
    tone: i % 2 ? 'silly' : 'serious',
  })).map((e) => { const value = Math.round(e.value * 10) / 10; return { ...e, value, evidence: `${value}%` }; });
}

test('a good pool passes in production mode', () => {
  const { errors } = validateDataset(goodPool(), { today: TODAY });
  assert.deepEqual(errors, []);
});

test('caps are enforced', () => {
  const p = goodPool();
  for (let i = 0; i < 4; i++) p[i].indicator = 'same';
  assert.match(validateDataset(p, { today: TODAY }).errors.join('\n'), /indicator "same"/);

  const q = goodPool();
  for (let i = 0; i < 80; i++) q[i].source = 'Z';
  assert.match(validateDataset(q, { today: TODAY }).errors.join('\n'), /source "Z"/);

  const r = goodPool();
  for (let i = 0; i < 80; i++) r[i].country = 'ITA';
  assert.match(validateDataset(r, { today: TODAY }).errors.join('\n'), /country "ITA"/);

  const s = goodPool().map((e) => ({ ...e, tone: 'serious' }));
  assert.match(validateDataset(s, { today: TODAY }).errors.join('\n'), /curious\/silly share/);

  const t = goodPool();
  t[1].text = t[0].text;
  t[1].detail = t[0].detail;
  t[1].value = t[0].value;
  t[1].evidence = t[0].evidence;
  assert.match(validateDataset(t, { today: TODAY }).errors.join('\n'), /near-duplicate/);
});

test('targets fail production but only warn in dev', () => {
  const small = goodPool(60);
  assert.match(validateDataset(small, { today: TODAY }).errors.join('\n'), /target 300/);
  assert.equal(validateDataset(small, { mode: 'dev', today: TODAY }).errors.length, 0);
});

test('production pool ignores unverified entries', () => {
  const p = goodPool().map((e) => ({ ...e, status: 'unverified', reviewReason: 'x', verifiedOn: undefined }));
  assert.match(validateDataset(p, { today: TODAY }).errors.join('\n'), /pool has 0 entries/);
});

test('verified entries with no legal partner fail', () => {
  const lonely = [
    base({ id: 'a', category: 'food', value: 10 }),
    base({ id: 'b', category: 'food', value: 50, indicator: 'b', text: 'other words here entirely' }),
    base({ id: 'c', category: 'space', value: 11, indicator: 'c', text: 'something else unrelated' }),
  ];
  const { errors } = validateDataset(lonely, { mode: 'dev', today: TODAY });
  assert.match(errors.join('\n'), /\[a\] has no legal partner/);
  assert.doesNotMatch(errors.join('\n'), /\[c\] has no legal partner/);
});
