import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadEntries } from '../scripts/lib/data.mjs';
import {
  addDays, currentStreak, dailyGuessCards, dailyPairs, dailyPool, formatCountdown, longestStreak, msUntilNextDaily, romeDate, romeMidnight,
} from '../src/daily.js';
import { isCrossFamily, isLegalPair, pairKey } from '../src/pairs.js';
import { shareText } from '../src/share.js';

// Pretend every candidate was added well before the test dates.
const POOL = loadEntries().map((e) => ({ ...e, addedOn: '2026-01-01' }));
const ids = (pairs) => pairs.map((p) => pairKey(p.a, p.b));

test('same date gives identical pairs, regardless of entry order', () => {
  const one = dailyPairs(POOL, '2026-11-05');
  const two = dailyPairs([...POOL].reverse(), '2026-11-05');
  assert.equal(one.length, 10);
  assert.deepEqual(ids(one), ids(two));
});

test('different dates give different pairs', () => {
  const days = Array.from({ length: 30 }, (_, i) => ids(dailyPairs(POOL, addDays('2026-11-01', i))).join(','));
  assert.equal(new Set(days).size, 30);
});

test('daily pairs follow the pairing rules', () => {
  for (let i = 0; i < 60; i++) {
    const pairs = dailyPairs(POOL, addDays('2026-11-01', i));
    const keys = new Set();
    let cross = 0;
    for (const p of pairs) {
      assert.ok(isLegalPair(p.a, p.b));
      assert.ok(!keys.has(pairKey(p.a, p.b)));
      keys.add(pairKey(p.a, p.b));
      if (isCrossFamily(p.a, p.b)) cross++;
    }
    assert.ok(cross >= 7, `day ${i}: only ${cross}/10 cross-family`);
  }
});

test("adding an entry with today's addedOn does not change today's set", () => {
  const today = '2026-11-05';
  const before = ids(dailyPairs(POOL, today));
  const extra = { id: 'zz-new-entry', text: 'Brand new', value: 51.5, category: 'space', addedOn: today, status: 'verified', verifiedOn: today };
  const extra2 = { ...extra, id: 'aa-new-entry', category: 'food', value: 12.5 };
  assert.deepEqual(ids(dailyPairs([...POOL, extra, extra2], today)), before);
  // ...but it may appear from tomorrow on.
  assert.ok(dailyPool([...POOL, extra], addDays(today, 1)).some((e) => e.id === 'zz-new-entry'));
});

test('entries promoted to verified later do not rewrite older challenges', () => {
  const day = '2026-11-05';
  const before = ids(dailyPairs(POOL, day));
  const promoted = { id: 'mm-promoted', text: 'x', value: 33.3, category: 'history', addedOn: '2026-01-01', verifiedOn: '2026-12-01' };
  assert.deepEqual(ids(dailyPairs([...POOL, promoted], day)), before);
});

test('Rome dates and midnight across DST changes', () => {
  // CEST (UTC+2) in summer, CET (UTC+1) in winter.
  assert.equal(new Date(romeMidnight('2026-07-01')).toISOString(), '2026-06-30T22:00:00.000Z');
  assert.equal(new Date(romeMidnight('2026-12-01')).toISOString(), '2026-11-30T23:00:00.000Z');
  // The days the clocks change (29 Mar 2026, 25 Oct 2026) still start at local midnight.
  assert.equal(new Date(romeMidnight('2026-03-29')).toISOString(), '2026-03-28T23:00:00.000Z');
  assert.equal(new Date(romeMidnight('2026-03-30')).toISOString(), '2026-03-29T22:00:00.000Z');
  assert.equal(new Date(romeMidnight('2026-10-25')).toISOString(), '2026-10-24T22:00:00.000Z');
  assert.equal(new Date(romeMidnight('2026-10-26')).toISOString(), '2026-10-25T23:00:00.000Z');
  // Late evening UTC is already tomorrow in Rome.
  assert.equal(romeDate(new Date('2026-07-01T22:30:00Z')), '2026-07-02');
  assert.equal(romeDate(new Date('2026-12-01T22:30:00Z')), '2026-12-01');
});

test('countdown is exact on short and long days', () => {
  // 25 Oct 2026 lasts 25 hours in Rome; 29 Mar 2026 lasts 23.
  const startLong = romeMidnight('2026-10-25');
  assert.equal(msUntilNextDaily(startLong), 25 * 3600 * 1000);
  const startShort = romeMidnight('2026-03-29');
  assert.equal(msUntilNextDaily(startShort), 23 * 3600 * 1000);
  assert.equal(msUntilNextDaily(romeMidnight('2026-11-05') + 1000), 24 * 3600 * 1000 - 1000);
  assert.equal(formatCountdown(3 * 3600 * 1000 + 5 * 60 * 1000 + 9000), '03:05:09');
});

test('share text is Wordle-style', () => {
  const text = shareText({ date: '2026-11-05', answers: [true, true, false, true, true, true, false, true, true, true], url: 'https://example.org/#/daily' });
  assert.equal(text, 'PERCENTO Daily 2026-11-05: 8/10\n🟩🟩🟥🟩🟩🟩🟥🟩🟩🟩\nhttps://example.org/#/daily');
});

test('streaks: alive until a day is missed, longest run remembered', () => {
  assert.equal(currentStreak([], '2026-10-22'), 0);
  assert.equal(currentStreak(['2026-10-20', '2026-10-21', '2026-10-22'], '2026-10-22'), 3);
  assert.equal(currentStreak(['2026-10-20', '2026-10-21'], '2026-10-22'), 2, 'today not played yet: still alive');
  assert.equal(currentStreak(['2026-10-19', '2026-10-20'], '2026-10-22'), 0, 'missed yesterday');
  assert.equal(currentStreak(['2026-02-28', '2026-03-01'], '2026-03-01'), 2, 'across month ends');
  assert.equal(longestStreak(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-10', '2026-10-11']), 3);
});

test('daily closest guess: 5 cards, identical for a date, different the next day', () => {
  const pool = Array.from({ length: 60 }, (_, i) => ({ id: `c${String(i).padStart(2, '0')}`, value: i + 1, category: 'food', addedOn: '2026-01-01' }));
  const a = dailyGuessCards(pool, '2026-10-22').map((e) => e.id);
  const b = dailyGuessCards([...pool].reverse(), '2026-10-22').map((e) => e.id);
  assert.equal(a.length, 5);
  assert.equal(new Set(a).size, 5);
  assert.deepEqual(a, b, 'independent of file order');
  assert.notDeepEqual(a, dailyGuessCards(pool, '2026-10-23').map((e) => e.id));
});
