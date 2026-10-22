// Question generators for the two "one answer out of several" modes. Pure
// functions (no DOM), shared by the game and the Node tests, built on the
// same pool, seeded randomness and pairing rules as the other modes.
import { RULES } from './config.js';
import { createPairGenerator } from './pairs.js';

/**
 * Match the card: one percentage, two statements; the percentage belongs to
 * exactly one of them. Pairs come from the usual generator (values at least
 * RULES.minGap apart, so only one answer is right), preferring partners within
 * MATCH_MAX_GAP points: two far-apart values would make it too easy.
 * next() → { a, b, target: 'a' | 'b' } or null.
 */
export const MATCH_MAX_GAP = 20;

export function createMatchGenerator(pool, rng = Math.random, { sameCategory = false } = {}) {
  const pairs = createPairGenerator(pool, rng, { sameCategory, maxGap: MATCH_MAX_GAP });
  return {
    next() {
      const pair = pairs.next();
      return pair && { ...pair, target: rng() < 0.5 ? 'a' : 'b' };
    },
  };
}

/**
 * Odd one out: three statistics close together and one clearly away from them.
 *   - the group spans at most ODD_GROUP_SPAN points (RELAXED when a small pool runs dry);
 *   - the odd card sits ODD_MIN_DISTANCE to ODD_MAX_DISTANCE points from the
 *     nearest member of the group (never glaring, never borderline);
 *   - it must be the only plausible answer: its distance from the median of
 *     the other three is at least twice any other card's (see isClearOdd);
 *   - in mixed play all four cards come from different categories;
 *   - the odd card's position is random.
 * next() → { cards: [4 entries], odd: index, group: { lo, hi }, distance } or null.
 */
export const ODD_GROUP_SPAN = 10;
export const ODD_MIN_DISTANCE = 12;
export const ODD_MAX_DISTANCE = 40;
// When a small pool (one category) runs out of strict groups: a slightly wider
// group and outsider range. The "only one possible odd card" rule never relaxes.
const RELAXED = { span: 14, max: 55 };
const ATTEMPTS = 2000;

const median3 = (xs) => [...xs].sort((x, y) => x - y)[1];

/** Distance of each value from the median of the other three. */
export function oddScores(values) {
  return values.map((v, i) => Math.abs(v - median3(values.filter((_, k) => k !== i))));
}

/** True when `odd` is unmistakably the card furthest from the rest. */
export function isClearOdd(values, odd) {
  const scores = oddScores(values);
  const others = scores.filter((_, i) => i !== odd);
  return scores[odd] >= ODD_MIN_DISTANCE && scores[odd] >= 2 * Math.max(...others);
}

export function createOddGenerator(pool, rng = Math.random, { sameCategory = false } = {}) {
  const entries = [...pool].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  const seen = new Set();
  const usedGroups = new Set();
  const pick = (list) => list[Math.floor(rng() * list.length)];
  // Unseen cards first, so a run shows as many different statistics as possible.
  const prefer = (list) => { const fresh = list.filter((e) => !seen.has(e.id)); return fresh.length ? fresh : list; };
  const distinct = (cards) => sameCategory || new Set(cards.map((e) => e.category)).size === cards.length;

  function attempt({ span, max }) {
    // Mostly start from a card not seen yet, but not always: the last unseen
    // cards may be extremes that cannot form a group.
    const a = pick(rng() < 0.7 ? prefer(entries) : entries);
    const near = entries.filter((e) => e.id !== a.id && Math.abs(e.value - a.value) <= span && distinct([a, e]));
    if (near.length < 2) return null;
    const b = pick(prefer(near));
    const c = pick(prefer(near.filter((e) => e.id !== b.id && distinct([a, b, e]))));
    if (!c) return null;
    const group = [a, b, c];
    const lo = Math.min(...group.map((e) => e.value));
    const hi = Math.max(...group.map((e) => e.value));
    if (hi - lo > span) return null;
    const away = (e) => Math.min(Math.abs(e.value - lo), Math.abs(e.value - hi));
    const outside = (e) => e.value < lo || e.value > hi;
    const odds = entries.filter((e) => !group.includes(e) && outside(e)
      && away(e) >= ODD_MIN_DISTANCE && away(e) <= max && distinct([...group, e]));
    if (!odds.length) return null;
    const odd = pick(prefer(odds));
    const cards = [...group];
    const at = Math.floor(rng() * 4);
    cards.splice(at, 0, odd);
    if (!isClearOdd(cards.map((e) => e.value), at)) return null;
    const key = cards.map((e) => e.id).sort().join('|');
    if (usedGroups.has(key)) return null;
    return { cards, odd: at, group: { lo, hi }, distance: away(odd), key };
  }

  return {
    next() {
      for (const limits of [{ span: ODD_GROUP_SPAN, max: ODD_MAX_DISTANCE }, RELAXED]) {
        for (let i = 0; i < ATTEMPTS; i++) {
          const q = attempt(limits);
          if (!q) continue;
          usedGroups.add(q.key);
          q.cards.forEach((e) => seen.add(e.id));
          return q;
        }
      }
      return null;
    },
  };
}
