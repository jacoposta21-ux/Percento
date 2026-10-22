import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadEntries } from '../scripts/lib/data.mjs';
import { createPairGenerator, higherOf, isCrossFamily, isLegalPair, mulberry32, pairKey } from '../src/pairs.js';
import { RULES } from '../src/config.js';
import { simulate } from '../scripts/simulate.mjs';

// Production has no verified entries yet, so rule tests run on the full
// candidate pool (same shape, same caps).
const POOL = loadEntries();

test('1,000 simulated endless pairs respect every rule', () => {
  const report = simulate(POOL, { pairs: 1000, seed: 42 });
  assert.equal(report.pairs, 1000);
  assert.deepEqual(report.violations, []);
  assert.ok(report.crossFamilyShare >= 0.8, `cross-family share ${report.crossFamilyShare}`);
});

test('cross-family bias holds across many seeds', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const r = simulate(POOL, { pairs: 200, seed });
    assert.deepEqual(r.violations, []);
    assert.ok(r.crossFamilyShare >= 0.85, `seed ${seed}: ${r.crossFamilyShare}`);
  }
});

test('the champion stays and the newcomer is higher about half the time', () => {
  const gen = createPairGenerator(POOL, mulberry32(7));
  let champion = null;
  let higherNew = 0;
  let total = 0;
  for (let i = 0; i < 400; i++) {
    const pair = gen.next(champion);
    if (champion && !pair.fresh) {
      assert.equal(pair.a.id, champion.id);
      total++;
      if (pair.b.value > pair.a.value) higherNew++;
    }
    champion = higherOf(pair);
  }
  const share = higherNew / total;
  assert.ok(share > 0.3 && share < 0.7, `newcomer higher share ${share}`);
});

test('no pair repeats within a session, even across runs', () => {
  const gen = createPairGenerator(POOL, mulberry32(3));
  const seen = new Set();
  for (let run = 0; run < 30; run++) {
    let champion = null;
    for (let i = 0; i < 15; i++) {
      const pair = gen.next(champion);
      const key = pairKey(pair.a, pair.b);
      assert.ok(!seen.has(key), `repeat ${key}`);
      seen.add(key);
      champion = Math.random() < 0.7 ? higherOf(pair) : null;
    }
  }
});

test('legal pair rules', () => {
  const a = { id: 'a', category: 'food', value: 10 };
  assert.equal(isLegalPair(a, { id: 'b', category: 'space', value: 12.9 }), false, 'gap < 3');
  assert.equal(isLegalPair(a, { id: 'b', category: 'space', value: 13 }), true);
  assert.equal(isLegalPair(a, { id: 'b', category: 'food', value: 50 }), false, 'same category');
  assert.equal(isCrossFamily(a, { category: 'space' }), false, 'food and space are both planet');
  assert.equal(isCrossFamily(a, { category: 'history' }), true);
});

test('a tiny pool is exhausted gracefully', () => {
  const tiny = [
    { id: 'x', category: 'food', value: 10 },
    { id: 'y', category: 'space', value: 50 },
  ];
  const gen = createPairGenerator(tiny, mulberry32(1));
  assert.ok(gen.next(null));
  assert.equal(gen.next(null), null);
  assert.ok(RULES.minGap === 3);
});
