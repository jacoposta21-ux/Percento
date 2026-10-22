// Pair generator: all pairing rules live here so the game, the Daily
// Challenge, the validator and the simulator share one implementation.
import { RULES, familyOf } from './config.js';

export const isLegalPair = (a, b) =>
  a.id !== b.id && a.category !== b.category && Math.abs(a.value - b.value) >= RULES.minGap;

export const pairKey = (a, b) => (a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`);

export const isCrossFamily = (a, b) => familyOf(a.category) !== familyOf(b.category);

// Small, fast, deterministic PRNG (mulberry32). Returns floats in [0, 1).
export function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// FNV-1a 32-bit hash, used to turn a date string into a seed.
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const pick = (list, rng) => list[Math.floor(rng() * list.length)];

/**
 * Creates a stateful generator for one session.
 * next() returns { a, b }: two cards never shown together before, preferring
 * cards not seen yet in this session. Returns null when no legal pair is left.
 */
export function createPairGenerator(pool, rng = Math.random) {
  // Sort by id so the result never depends on file order.
  const entries = [...pool].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  const usedPairs = new Set();
  const seenIds = new Set();

  const legalFor = (card) =>
    entries.filter((e) => isLegalPair(card, e) && !usedPairs.has(pairKey(card, e)));

  function chooseOpponent(a, legal) {
    // Cards not seen yet come first, then a coin flip keeps the answer
    // balanced: half the time the right card is higher.
    const fresh = legal.filter((e) => !seenIds.has(e.id));
    let candidates = fresh.length ? fresh : legal;
    const higher = candidates.filter((e) => e.value > a.value);
    const lower = candidates.filter((e) => e.value < a.value);
    if (higher.length && lower.length) candidates = rng() < 0.5 ? higher : lower;
    const cross = candidates.filter((e) => isCrossFamily(a, e));
    if (cross.length && rng() < RULES.crossFamilyBias) candidates = cross;
    return pick(candidates, rng);
  }

  return {
    next() {
      const unseen = entries.filter((e) => !seenIds.has(e.id) && legalFor(e).length);
      const starters = unseen.length ? unseen : entries.filter((e) => legalFor(e).length);
      if (!starters.length) return null;
      const a = pick(starters, rng);
      const b = chooseOpponent(a, legalFor(a));
      usedPairs.add(pairKey(a, b));
      seenIds.add(a.id);
      seenIds.add(b.id);
      return { a, b };
    },
    usedPairs,
  };
}

export const higherOf = ({ a, b }) => (a.value > b.value ? a : b);
