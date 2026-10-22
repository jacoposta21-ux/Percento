import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadEntries } from '../scripts/lib/data.mjs';
import { createPairGenerator, isCrossFamily, isLegalPair, mulberry32, pairKey } from '../src/pairs.js';
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

test('every round is two new cards, the right one higher about half the time', () => {
  const gen = createPairGenerator(POOL, mulberry32(7));
  const seen = new Set();
  let rightHigher = 0;
  const rounds = Math.floor(POOL.length / 2) - 10;
  for (let i = 0; i < rounds; i++) {
    const { a, b } = gen.next();
    assert.ok(!seen.has(a.id) && !seen.has(b.id), `card reused in round ${i}`);
    seen.add(a.id);
    seen.add(b.id);
    if (b.value > a.value) rightHigher++;
  }
  const share = rightHigher / rounds;
  assert.ok(share > 0.3 && share < 0.7, `right card higher share ${share}`);
});

test('no pair repeats within a session, even across runs', () => {
  const gen = createPairGenerator(POOL, mulberry32(3));
  const seen = new Set();
  for (let i = 0; i < 450; i++) {
    const pair = gen.next();
    const key = pairKey(pair.a, pair.b);
    assert.ok(!seen.has(key), `repeat ${key}`);
    seen.add(key);
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
  assert.ok(gen.next());
  assert.equal(gen.next(), null);
  assert.ok(RULES.minGap === 3);
});

test('category play: every category gives at least 40 rounds of legal same-category pairs', () => {
  for (const cat of [...new Set(POOL.map((e) => e.category))]) {
    const gen = createPairGenerator(POOL.filter((e) => e.category === cat), mulberry32(11), { sameCategory: true });
    for (let i = 0; i < 40; i++) {
      const pair = gen.next();
      assert.ok(pair, `${cat}: ran out of pairs at round ${i}`);
      assert.equal(pair.a.category, cat);
      assert.ok(isLegalPair(pair.a, pair.b, true));
    }
  }
});
