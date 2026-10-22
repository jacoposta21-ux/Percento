import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadEntries } from '../scripts/lib/data.mjs';
import { mulberry32, pairKey } from '../src/pairs.js';
import { RULES } from '../src/config.js';
import {
  createMatchGenerator, createOddGenerator, isClearOdd, MATCH_MAX_GAP, ODD_GROUP_SPAN, ODD_MIN_DISTANCE, ODD_MAX_DISTANCE,
} from '../src/modes.js';

const POOL = loadEntries();
const CATS = [...new Set(POOL.map((e) => e.category))];

test('match the card: one right answer, close-ish values, different categories, no repeats, target on both sides', () => {
  const gen = createMatchGenerator(POOL, mulberry32(5));
  const seen = new Set();
  let left = 0;
  let near = 0;
  for (let i = 0; i < 300; i++) {
    const q = gen.next();
    assert.ok(q, `ran out at ${i}`);
    assert.ok(Math.abs(q.a.value - q.b.value) >= RULES.minGap, 'the shown percentage fits only one card');
    assert.notEqual(q.a.category, q.b.category);
    assert.ok(!seen.has(pairKey(q.a, q.b)));
    seen.add(pairKey(q.a, q.b));
    if (q.target === 'a') left++;
    if (Math.abs(q.a.value - q.b.value) <= MATCH_MAX_GAP) near++;
  }
  assert.ok(left > 100 && left < 200, `target side balanced (${left}/300 left)`);
  assert.ok(near / 300 > 0.9, `mostly close values, not giveaways (${near}/300)`);
});

test('odd one out: a tight group, one clear outsider in a random position, four categories', () => {
  const gen = createOddGenerator(POOL, mulberry32(9));
  const positions = [0, 0, 0, 0];
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const q = gen.next();
    assert.ok(q, `ran out at ${i}`);
    const values = q.cards.map((e) => e.value);
    const group = values.filter((_, k) => k !== q.odd);
    assert.ok(Math.max(...group) - Math.min(...group) <= ODD_GROUP_SPAN, `group spans ${group}`);
    assert.ok(q.distance >= ODD_MIN_DISTANCE && q.distance <= ODD_MAX_DISTANCE, `odd distance ${q.distance}`);
    assert.ok(isClearOdd(values, q.odd), `ambiguous: ${values}`);
    // No other card could pass as the odd one.
    for (let k = 0; k < 4; k++) if (k !== q.odd) assert.ok(!isClearOdd(values, k));
    assert.equal(new Set(q.cards.map((e) => e.category)).size, 4, 'four different categories');
    assert.equal(new Set(q.cards.map((e) => e.id)).size, 4);
    assert.ok(!seen.has(q.key), 'no repeated group');
    seen.add(q.key);
    positions[q.odd]++;
  }
  assert.ok(positions.every((n) => n > 25), `odd position is random (${positions})`);
});

test('both modes work within every single category', () => {
  for (const cat of CATS) {
    const pool = POOL.filter((e) => e.category === cat);
    const match = createMatchGenerator(pool, mulberry32(2), { sameCategory: true });
    const odd = createOddGenerator(pool, mulberry32(2), { sameCategory: true });
    for (let i = 0; i < 15; i++) {
      const m = match.next();
      assert.ok(m && m.a.category === cat && m.b.category === cat, `${cat}: match round ${i}`);
      const o = odd.next();
      assert.ok(o && o.cards.every((e) => e.category === cat), `${cat}: odd round ${i}`);
      assert.ok(isClearOdd(o.cards.map((e) => e.value), o.odd));
    }
  }
});

test('isClearOdd rejects groups with two possible outsiders', () => {
  assert.equal(isClearOdd([72, 76, 79, 43], 3), true, 'the example from the brief');
  assert.equal(isClearOdd([10, 30, 50, 70], 3), false, 'evenly spread: no clear odd one');
  assert.equal(isClearOdd([20, 22, 60, 64], 2), false, 'two pairs');
});
