// Simulates endless play and checks every pairing rule.
//   node scripts/simulate.mjs [--mode=production|dev] [--pairs=1000] [--seed=42]
import { createPairGenerator, higherOf, isCrossFamily, mulberry32, pairKey } from '../src/pairs.js';
import { RULES } from '../src/config.js';
import { loadEntries, argValue } from './lib/data.mjs';

/** Plays `pairs` rounds with random right/wrong answers; returns rule stats. */
export function simulate(pool, { pairs = 1000, seed = 42 } = {}) {
  const rng = mulberry32(seed);
  const gen = createPairGenerator(pool, rng);
  const seen = new Set();
  const violations = [];
  let cross = 0;
  let crossAvailable = 0;
  let count = 0;
  let champion = null;
  while (count < pairs) {
    const pair = gen.next(champion);
    if (!pair) break;
    const { a, b } = pair;
    const key = pairKey(a, b);
    if (Math.abs(a.value - b.value) < RULES.minGap) violations.push(`gap < ${RULES.minGap}: ${key}`);
    if (a.category === b.category) violations.push(`same category: ${key}`);
    if (seen.has(key)) violations.push(`repeated pair: ${key}`);
    if (champion && !pair.fresh && a.id !== champion.id) violations.push(`champion did not stay: ${key}`);
    seen.add(key);
    if (isCrossFamily(a, b)) cross++;
    if (pool.some((o) => o.id !== a.id && o.category !== a.category && Math.abs(o.value - a.value) >= RULES.minGap && isCrossFamily(a, o))) crossAvailable++;
    count++;
    // 75% of answers correct; a wrong answer starts a new run.
    champion = rng() < 0.75 ? higherOf(pair) : null;
  }
  return { pairs: count, violations, crossFamilyShare: count ? cross / count : 0, crossAvailableShare: count ? crossAvailable / count : 0 };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const mode = argValue('mode', 'production');
  const all = loadEntries();
  const pool = mode === 'production' ? all.filter((e) => e.status === 'verified') : all;
  const report = simulate(pool, { pairs: Number(argValue('pairs', 1000)), seed: Number(argValue('seed', 42)) });
  console.log(JSON.stringify({ mode, poolSize: pool.length, ...report, violations: report.violations.slice(0, 20) }, null, 2));
  process.exit(report.violations.length || report.pairs < Number(argValue('pairs', 1000)) || report.crossFamilyShare < 0.8 ? 1 : 0);
}
