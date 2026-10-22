// Daily Challenge: date maths in Europe/Rome and the deterministic daily set.
import { DAILY_TIMEZONE, RULES } from './config.js';
import { createPairGenerator, hashString, mulberry32 } from './pairs.js';

const partsFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: DAILY_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function romeParts(instant) {
  const out = {};
  for (const { type, value } of partsFormatter.formatToParts(instant)) out[type] = Number(value);
  return out;
}

/** "YYYY-MM-DD" of the given instant, as seen on a clock in Rome. */
export function romeDate(instant = new Date()) {
  const p = romeParts(instant);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Offset of Rome from UTC (in ms) at a given instant. */
function romeOffset(ms) {
  const p = romeParts(new Date(ms));
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** UTC instant (ms) of 00:00 Rome time on the given "YYYY-MM-DD". */
export function romeMidnight(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const wall = Date.UTC(y, m - 1, d);
  // Two passes settle the offset even when the day itself changes DST.
  let guess = wall - romeOffset(wall);
  guess = wall - romeOffset(guess);
  return guess;
}

export function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Milliseconds until the next Daily Challenge (next midnight in Rome). */
export function msUntilNextDaily(now = Date.now()) {
  return romeMidnight(addDays(romeDate(new Date(now)), 1)) - now;
}

/**
 * The date from which an entry may appear in a daily set. An entry that was
 * only promoted to "verified" later counts from its verification date, so
 * promotions never rewrite old challenges. Entries count from the day AFTER
 * that date, so adding data today never changes today's set.
 */
export const eligibleFrom = (entry) =>
  entry.verifiedOn && entry.verifiedOn > entry.addedOn ? entry.verifiedOn : entry.addedOn;

export function dailyPool(pool, dateStr) {
  return pool.filter((e) => eligibleFrom(e) < dateStr);
}

/** The 10 pairs for a date. Same input data and date → same pairs, everywhere. */
export function dailyPairs(pool, dateStr, count = RULES.dailyPairs) {
  // v2: since every round became two new cards, the seed changed with the format.
  const rng = mulberry32(hashString(`percento-daily-v2:${dateStr}`));
  const gen = createPairGenerator(dailyPool(pool, dateStr), rng);
  const pairs = [];
  while (pairs.length < count) {
    const pair = gen.next();
    if (!pair) break;
    pairs.push(pair);
  }
  return pairs;
}

export function formatCountdown(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}
