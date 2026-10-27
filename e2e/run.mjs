// End-to-end QA in headless Chromium (no test framework, no runtime deps).
// Runs against dist/ (build it first: `npm run test:e2e` does).
//   - full Endless and Daily games at 360px and desktop widths
//   - no horizontal scroll, no tap target under 44px, WCAG AA text contrast
//   - keyboard play, reduced motion, storage blocked, reload-resume, share/copy
//   - accounts, world leaderboard and a 2-player friends room against an
//     in-browser fake of Supabase (e2e/fake-supabase.js); offline fallback
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { startServer } from '../scripts/serve.mjs';
import { dailyPairs, romeDate } from '../src/daily.js';
import { pairKey } from '../src/pairs.js';
import { ROOT } from '../scripts/lib/data.mjs';

const PORT = 8097;
const BASE = `http://127.0.0.1:${PORT}/`;
const SHOTS = join(ROOT, 'e2e', 'screenshots');
const FAKE_SUPABASE = join(ROOT, 'e2e', 'fake-supabase.js');
const EXECUTABLE = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
mkdirSync(SHOTS, { recursive: true });

const { ENTRIES } = await import(join(ROOT, 'dist', 'src', 'data.js'));
const newest = ENTRIES.map((e) => (e.verifiedOn && e.verifiedOn > e.addedOn ? e.verifiedOn : e.addedOn)).sort().pop();
const DAILY_TIME = new Date(Date.parse(`${newest}T12:00:00Z`) + 2 * 86400000);
const DAILY_DATE = romeDate(DAILY_TIME);
// Answers "from other players", seeded into the fake backend for one device:
// every daily pair was answered 10 times, 3 of them right; 4 players already
// finished the daily with scores 2, 5, 9 and 10.
const CROWD_SEED = {
  answer_stats: dailyPairs(ENTRIES, DAILY_DATE).map((p) => ({ key: pairKey(p.a, p.b), kind: 'pair', plays: 10, hits: 3, guess_sum: 0, miss_sum: 0 })),
  daily_counts: [2, 5, 9, 10].map((score) => ({ day: DAILY_DATE, game: 'pairs', score, players: 1 })),
};

const failures = [];
let passes = 0;
const check = (cond, msg) => { if (cond) passes++; else { failures.push(msg); console.log(`  ✗ ${msg}`); } };
const log = (msg) => console.log(msg);

// ---------- in-page audits ----------
async function audit(page, label) {
  const res = await page.evaluate(() => {
    const out = { hscroll: document.documentElement.scrollWidth > window.innerWidth + 1, small: [], contrast: [] };
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !el.closest('[hidden]');
    };
    for (const el of document.querySelectorAll('a, button, [role=button], input, select')) {
      if (!visible(el) || el.classList.contains('skip')) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 44 || r.height < 44) out.small.push(`${el.tagName}.${el.className}:"${(el.textContent || '').trim().slice(0, 30)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    const parse = (c) => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
      return { r, g, b, a };
    };
    const lum = ({ r, g, b }) => {
      const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const bgOf = (el) => {
      for (let n = el; n; n = n.parentElement) {
        const c = parse(getComputedStyle(n).backgroundColor);
        if (c && c.a > 0.5) return c;
      }
      return parse(getComputedStyle(document.body).backgroundColor);
    };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      const el = t.parentElement;
      if (!t.textContent.trim() || seen.has(el) || !visible(el) || el.closest('.skip, svg, .toast:not(.show), [aria-hidden="true"]')) continue;
      seen.add(el);
      const s = getComputedStyle(el);
      const fg = parse(s.color);
      const bg = bgOf(el);
      if (!fg || !bg) continue;
      const [l1, l2] = [lum(fg), lum(bg)].sort((x, y) => y - x);
      const ratio = (l1 + 0.05) / (l2 + 0.05);
      const size = parseFloat(s.fontSize);
      const large = size >= 24 || (size >= 18.66 && Number(s.fontWeight) >= 700);
      if (ratio < (large ? 3 : 4.5)) out.contrast.push(`"${t.textContent.trim().slice(0, 30)}" ${ratio.toFixed(2)}`);
    }
    return out;
  });
  check(!res.hscroll, `${label}: horizontal scroll`);
  check(res.small.length === 0, `${label}: tap targets < 44px: ${res.small.join('; ')}`);
  check(res.contrast.length === 0, `${label}: low contrast: ${res.contrast.join('; ')}`);
}

const cardTexts = (page) => page.$$eval('.card-text', (els) => els.map((e) => e.textContent));
const readValue = async (page, sel) => parseFloat((await page.textContent(`${sel} .card-value`)).replace('%', ''));

// Waits for the verdict. Returns true for a right answer.
async function waitReveal(page) {
  await page.waitForSelector('.feedback.ok, .feedback.ko', { timeout: 8000 });
  return Boolean(await page.$('.feedback.ok'));
}

// Skips the wait after a miss if the button is still there (the game also moves on by itself).
const skip = async (page) => { await page.click('.continue:not([hidden])', { timeout: 2000 }).catch(() => {}); };

// A right answer moves on by itself; so does a wrong one, after a banner (Enter skips the wait).
async function afterVerdict(page, label, correct, { keyboard = false, last = false } = {}) {
  if (correct) {
    check(await page.isHidden('.continue'), `${label}: no Continue button after a right answer`);
    if (!last) await page.waitForSelector('.card-pick:not([disabled])', { timeout: 5000 });
    return;
  }
  if (keyboard) {
    if (await page.isVisible('.verdict-banner')) check((await page.textContent('.verdict-banner')).includes('Wrong answer'), `${label}: a banner tells you it was wrong`);
    if (await page.isVisible('.continue')) await page.keyboard.press('Enter');
    return;
  }
  await page.waitForSelector('.verdict-banner', { state: 'detached', timeout: 8000 })
    .then(() => check(true, ''), () => check(false, `${label}: after a miss the game moves on without a click`));
}

async function setGuess(page, value) {
  await page.fill('.guess-slider', String(value));
  await page.dispatchEvent('.guess-slider', 'input');
}

// ---------- scenarios ----------
async function playEndless(page, label, { keyboard = false } = {}) {
  await page.goto(`${BASE}#/endless`);
  await page.waitForSelector('.card-pick');
  await audit(page, `${label} endless round`);
  let rounds = 0;
  let correctStreak = 0;
  const seen = new Set();
  while (rounds < 60) {
    const texts = await cardTexts(page);
    check(texts.every((t) => !seen.has(t)), `${label}: round ${rounds} should show two new cards`);
    texts.forEach((t) => seen.add(t));
    const hidden = await page.$$eval('.card-value', (els) => els.every((e) => e.textContent.trim() === '?'));
    check(hidden, `${label}: both values hidden before the pick (round ${rounds})`);
    // Alternate inputs; a wrong answer ends the run.
    const pickA = rounds % 2 === 0;
    if (keyboard) await page.keyboard.press(pickA ? '1' : 'ArrowDown');
    else await page.click(pickA ? '.card-a .card-pick' : '.card-b .card-pick');
    const ok = await waitReveal(page);
    const [va, vb] = [await readValue(page, '.card-a'), await readValue(page, '.card-b')];
    const correct = pickA ? va > vb : vb > va;
    check(Math.abs(va - vb) >= 3, `${label}: pair values ${va} and ${vb} closer than 3 points`);
    check(ok === correct, `${label}: feedback does not match answer`);
    const sources = await page.$$eval('.card-source:not([hidden]) a', (as) => as.map((a) => a.href));
    check(sources.length === 2, `${label}: both sources shown after reveal`);
    if (!correct) await audit(page, `${label} endless reveal`);
    rounds++;
    if (correct) correctStreak++;
    await afterVerdict(page, label, correct, { keyboard });
    if (!correct) break;
  }
  await page.waitForSelector('.big-score', { timeout: 5000 });
  const score = Number(await page.textContent('.big-score span'));
  check(score === correctStreak, `${label}: game-over score ${score} != ${correctStreak}`);
  await audit(page, `${label} game over`);
  await page.screenshot({ path: join(SHOTS, `${label}-gameover.png`), fullPage: true });
  return score;
}

// A daily waits on its start screen until Start is pressed.
async function startDailyScreen(page, label) {
  await page.waitForSelector('.daily-intro');
  check(!(await page.$('.card-pick, .guess-slider')), `${label}: the daily does not start by itself`);
  await page.click('main button:has-text("Start")');
}

async function playDaily(page, context, label, { reloadAt = 4 } = {}) {
  await page.goto(`${BASE}#/daily`);
  await startDailyScreen(page, label);
  await page.waitForSelector('.card-pick');
  const firstPair = await cardTexts(page);
  let audited = false;
  for (let i = 0; i < 10; i++) {
    const status = await page.textContent('.status');
    check(status.includes(`Pair ${i + 1} of 10`), `${label}: expected pair ${i + 1}, got "${status}"`);
    if (i === reloadAt) {
      const before = await cardTexts(page);
      await page.reload();
      await page.waitForSelector('.card-pick');
      check(JSON.stringify(await cardTexts(page)) === JSON.stringify(before), `${label}: reload should resume the same unanswered pair`);
    }
    await page.click(i % 3 ? '.card-a .card-pick' : '.card-b .card-pick');
    if (i === 6) {
      // Reload right after answering: the answer is saved, so pair 7 must not replay.
      await page.reload();
      await page.waitForSelector('.card-pick');
      const s = await page.textContent('.status');
      check(s.includes('Pair 8 of 10'), `${label}: answered pair must not replay after reload (got "${s}")`);
      continue;
    }
    const correct = await waitReveal(page);
    if (i === 0) {
      // What everybody answered appears under the verdict.
      const crowd = await page.waitForSelector('.crowd', { timeout: 1500 }).then((el) => el.textContent()).catch(() => '');
      check(label === 'mobile-light' ? crowd.includes('30% of players got this one right') : crowd.includes('one of the first'), `${label}: crowd line after the reveal (${crowd})`);
    }
    if (!correct && !audited) { await audit(page, `${label} daily reveal`); audited = true; }
    await afterVerdict(page, label, correct, { last: i === 9 });
  }
  await page.waitForSelector('.share-text');
  const grid = await page.textContent('.grid');
  check([...grid].filter((c) => c === '🟩' || c === '🟥').length === 10, `${label}: grid should have 10 squares`);
  const text = await page.textContent('.share-text');
  check(/^Eyeball Daily \d{4}-\d{2}-\d{2}: \d+\/10\n[🟩🟥]{10}\nhttp/u.test(text), `${label}: share text format: ${JSON.stringify(text)}`);
  await audit(page, `${label} daily results`);
  await page.click('text=Share result');
  await page.waitForSelector('.toast.show');
  const toastText = await page.textContent('.toast');
  check(/copied|Shared/i.test(toastText), `${label}: confirmation toast (${toastText})`);
  const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => null));
  check(clip === text, `${label}: clipboard should hold the share text`);
  await page.screenshot({ path: join(SHOTS, `${label}-daily-results.png`), fullPage: true });
  const countdown = await page.textContent('.countdown');
  check(/^\d{2}:\d{2}:\d{2}$/.test(countdown), `${label}: countdown format ${countdown}`);
  // One attempt per day: reloading shows results, never the game.
  await page.reload();
  await page.waitForSelector('.share-text');
  check(!(await page.$('.card-pick')), `${label}: daily must not be replayable`);
  return firstPair;
}

async function playDailyGuess(page, label) {
  await page.goto(`${BASE}#/daily/guess`);
  await startDailyScreen(page, `${label} guess`);
  for (let i = 0; i < 5; i++) {
    await page.waitForSelector('.guess-slider:not([disabled])');
    check((await page.textContent('.status')).includes(`Card ${i + 1} of 5`), `${label}: daily guess card ${i + 1}`);
    if (i === 2) {
      // Reload mid-challenge: the same card comes back (answers are saved one by one).
      const before = await page.textContent('.card-text');
      await page.reload();
      await page.waitForSelector('.guess-slider:not([disabled])');
      check((await page.textContent('.card-text')) === before, `${label}: daily guess resumes on reload`);
    }
    await setGuess(page, 20 + i * 15);
    await page.click('.lock');
    await page.waitForSelector('.continue');
    await page.waitForSelector('.crowd');
    await page.click('.continue');
  }
  await page.waitForSelector('.share-text');
  const text = await page.textContent('.share-text');
  check(/^Eyeball Guess \d{4}-\d{2}-\d{2}: \d+\/500\n[🎯🟩🟨🟥]{5}\nhttp/u.test(text), `${label}: daily guess share text: ${JSON.stringify(text)}`);
  await page.waitForSelector('.dist-bars');
  await audit(page, `${label} daily guess results`);
  await page.reload();
  await page.waitForSelector('.share-text');
  check(!(await page.$('.guess-slider')), `${label}: daily guess is not replayable`);
}

async function main() {
  const server = await startServer(PORT);
  const browser = await chromium.launch({ executablePath: EXECUTABLE });
  const errors = [];
  // Every context talks to the fake backend, never to the real one.
  const newContext = async (opts) => {
    const context = await browser.newContext(opts);
    await context.addInitScript({ path: FAKE_SUPABASE });
    return context;
  };
  const watch = (page) => {
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  };
  try {
    const dailyFirstPairs = [];
    for (const [w, h, name] of [[360, 760, 'mobile'], [1280, 800, 'desktop']]) {
      for (const scheme of ['light', 'dark']) {
        const label = `${name}-${scheme}`;
        log(`▶ ${label}`);
        const context = await newContext({ viewport: { width: w, height: h }, colorScheme: scheme, permissions: ['clipboard-read', 'clipboard-write'] });
        const page = await context.newPage();
        watch(page);
        await page.goto(BASE);
        await page.waitForSelector('.home-choice');
        await audit(page, `${label} home`);
        await page.screenshot({ path: join(SHOTS, `${label}-home.png`), fullPage: true });
        check((await page.$$('.home-choice')).length === 2 && Boolean(await page.$('.home-daily')), `${label}: home offers single player, multiplayer and the daily`);
        check(!(await page.$('.cat-tile')) && !(await page.$('.mode-tile')), `${label}: games and categories live inside single player`);
        await page.click('.choice-solo');
        await page.waitForSelector('.cat-tile');
        await audit(page, `${label} single player`);
        check((await page.$$('.mode-tile')).length === 4, `${label}: four games in single player`);
        check((await page.$$('.cat-tile')).length === 13, `${label}: every category is playable in single player`);
        await page.click('[data-sound-toggle]');
        check((await page.getAttribute('[data-sound-toggle]', 'aria-pressed')) === 'true', `${label}: sound toggle mutes`);
        await page.click('[data-sound-toggle]');
        check((await page.getAttribute('[data-sound-toggle]', 'aria-pressed')) === 'false', `${label}: sound toggle unmutes`);
        // Category play: both cards from the chosen category.
        await page.click('.cat-tile >> text=Space');
        await page.waitForSelector('.card-pick');
        const cats = await page.$$eval('.card-cat', (els) => els.map((e) => e.textContent.trim()));
        check(cats.length === 2 && cats.every((c) => c === 'Space'), `${label}: category play keeps to one category (${cats})`);
        check(Boolean(await page.$('.card-a .pie')) && Boolean(await page.$('.card-b .pie')), `${label}: each card has a pie for its percentage`);
        await audit(page, `${label} category round`);
        await page.screenshot({ path: join(SHOTS, `${label}-round.png`), fullPage: true });
        const score = await playEndless(page, label, { keyboard: scheme === 'dark' });
        const best = Number(await page.evaluate(() => localStorage.getItem('percento:best')) || 0);
        check(best >= score, `${label}: personal best saved (${best} vs ${score})`);
        // Entries only join the daily set the day after they are added, so
        // the daily runs two days after the newest addedOn.
        await page.clock.setFixedTime(DAILY_TIME);
        if (label === 'mobile-light') {
          await page.evaluate((seed) => {
            const db = JSON.parse(localStorage.getItem('fake-supabase-db') || 'null') || { users: [], profiles: [], runs: [], daily_results: [], rooms: [], room_players: [], room_guesses: [], seq: 1 };
            localStorage.setItem('fake-supabase-db', JSON.stringify({ ...db, ...seed }));
          }, CROWD_SEED);
        }
        dailyFirstPairs.push(await playDaily(page, context, label));
        await page.waitForSelector('.dist-headline');
        const dist = await page.textContent('.dist-headline');
        if (label === 'mobile-light') {
          check(/Better than \d+% of today's 5 players/.test(dist), `${label}: today's distribution counts everybody (${dist})`);
        } else {
          check(dist.includes('first to finish'), `${label}: first player of the day (${dist})`);
        }
        check((await page.textContent('.streak b')) === '1', `${label}: streak starts at 1`);
        await playDailyGuess(page, label);
        check((await page.textContent('.streak b')) === '1', `${label}: two dailies on one day are still a 1-day streak`);
        check((await page.$$('.daily-tabs .seg')).length === 2, `${label}: tabs between the two dailies`);
        await page.goto(`${BASE}#/sources`);
        await page.waitForSelector('.source-list');
        await audit(page, `${label} sources`);
        const links = await page.$$eval('.source-list a', (as) => as.length);
        check(links > 0, `${label}: sources listed`);
        await context.close();
      }
    }
    check(new Set(dailyFirstPairs.map((p) => JSON.stringify(p))).size === 1, 'daily: identical first pair across separate devices/contexts');

    log('▶ closest guess solo');
    {
      const context = await newContext({ viewport: { width: 380, height: 820 } });
      const page = await context.newPage();
      watch(page);
      await page.goto(`${BASE}#/solo`);
      await page.click('.cat-section .seg:has-text("Closest guess")');
      check((await page.getAttribute('.cat-tile >> nth=0', 'href')).startsWith('#/guess/'), 'home: category tiles switch to closest guess');
      await page.goto(`${BASE}#/guess`);
      let expected = 0;
      for (let i = 0; i < 10; i++) {
        await page.waitForSelector('.guess-slider:not([disabled])');
        if (i === 0) await audit(page, 'guess solo round');
        const guess = (i * 11) % 100;
        await setGuess(page, guess);
        check((await page.textContent('.guess-readout')).startsWith(String(guess)), `guess solo: readout follows the slider (${guess})`);
        await page.click('.lock');
        await page.waitForSelector('.continue');
        const truth = parseFloat((await page.textContent('.card-value')).replace('%', ''));
        expected += Math.max(0, Math.round(100 - 3 * Math.abs(guess - truth)));
        check(Boolean(await page.$('.pin.me')) && Boolean(await page.$('.pin.truth')), 'guess solo: your pin and the real value on the ruler');
        if (i === 0) await audit(page, 'guess solo reveal');
        await page.click('.continue');
      }
      await page.waitForSelector('text=of 1000 points');
      const total = Number(await page.textContent('.big-score span'));
      check(total === expected, `guess solo: total ${total} matches the rule (${expected})`);
      await audit(page, 'guess solo results');
      await page.screenshot({ path: join(SHOTS, 'guess-solo-results.png'), fullPage: true });
      await context.close();
    }

    log('▶ game settings');
    {
      const context = await newContext({ viewport: { width: 360, height: 760 } });
      const page = await context.newPage();
      watch(page);
      await page.goto(`${BASE}#/solo`);
      await page.waitForSelector('.settings-menu');
      check(!(await page.isVisible('.settings-pop')), 'settings: tucked away in a drop-down');
      await page.click('.settings-menu summary');
      await audit(page, 'game settings');
      await page.click('.settings-pop .seg:has-text("No limit")');
      await page.click('.settings-pop .seg:text-is("3")');
      check((await page.textContent('.settings-current')).includes('3♥'), 'settings: the button shows the choice');
      // Three lives: the run goes on after a wrong answer and stops after the third.
      await page.goto(`${BASE}#/endless`);
      await page.waitForSelector('.card-pick');
      check(!(await page.$('.round-timer')), 'settings: no clock without a time limit');
      check((await page.textContent('.pill small')).includes('♥♥♥'), 'settings: three hearts at the start');
      let misses = 0;
      for (let round = 0; round < 80 && misses < 3; round++) {
        await page.waitForSelector('.card-pick:not([disabled])');
        await page.click('.card-a .card-pick');
        const ok = await waitReveal(page);
        if (ok) { await page.waitForSelector('.card-pick:not([disabled])', { timeout: 5000 }).catch(() => {}); continue; }
        misses++;
        check(await page.isVisible('.verdict-banner'), 'settings: a banner after a miss');
        await page.waitForSelector('.verdict-banner', { state: 'detached', timeout: 8000 });
        if (misses < 3) {
          await page.waitForSelector('.card-pick:not([disabled])', { timeout: 5000 });
          check((await page.textContent('.pill small')).includes('♥'.repeat(3 - misses) + '♡'.repeat(misses)), `settings: ${3 - misses} hearts left`);
        }
      }
      await page.waitForSelector('.big-score', { timeout: 5000 });
      check(misses === 3, 'settings: the run ends when the lives run out');
      check(((await page.evaluate(() => localStorage.getItem('percento:runs'))) || '[]') === '[]', 'settings: untimed run kept off the device board');
      // A 10-second clock, also in Closest guess.
      await page.goto(`${BASE}#/solo`);
      await page.click('.settings-menu summary');
      await page.click('.settings-pop .seg:has-text("10s")');
      await page.goto(`${BASE}#/odd`);
      await page.waitForSelector('.odd-grid');
      await page.waitForSelector('.round-timer');
      check((await page.textContent('.round-timer b')) === '10', 'settings: odd one out on a 10-second clock');
      await page.goto(`${BASE}#/guess`);
      await page.waitForSelector('.guess-slider');
      check((await page.textContent('.round-head .sub')).includes('10'), 'settings: closest guess on a 10-second clock');
      await context.close();
    }

    log('▶ match the card and odd one out');
    for (const [w, hgt, name] of [[360, 760, 'mobile'], [1280, 800, 'desktop']]) {
      const context = await newContext({ viewport: { width: w, height: hgt } });
      const page = await context.newPage();
      watch(page);
      await page.goto(`${BASE}#/solo`);
      await page.waitForSelector('.mode-tile');
      check((await page.$$('.mode-tile')).length === 4, `${name}: four games in single player`);
      check((await page.$$('.cat-section .seg')).length === 4, `${name}: category switch offers all four games`);
      await page.click('.cat-section .seg:has-text("Match the card")');
      check((await page.getAttribute('.cat-tile >> nth=0', 'href')).startsWith('#/match/'), `${name}: category tiles switch to match the card`);
      await page.click('.cat-section .seg:has-text("Odd one out")');
      check((await page.getAttribute('.cat-tile >> nth=0', 'href')).startsWith('#/odd/'), `${name}: category tiles switch to odd one out`);

      // Match the card: the shown percentage is exactly one card's value.
      await page.click('.mode-tile:has-text("Match the card")');
      await page.waitForSelector('.target');
      await audit(page, `${name} match round`);
      let streak = 0;
      for (let round = 0; round < 40; round++) {
        await page.waitForSelector('.card-pick:not([disabled])');
        const target = parseFloat((await page.textContent('.target b')).replace('%', ''));
        check((await page.$$eval('.card-value', (els) => els.every((e) => e.textContent.trim() === '?'))), `${name}: match values hidden before the pick`);
        // Pick right a few times, then wrong on purpose.
        const pickA = round % 2 === 0;
        await page.click(pickA ? '.card-a .card-pick' : '.card-b .card-pick');
        const ok = await waitReveal(page);
        const [va, vb] = [await readValue(page, '.card-a'), await readValue(page, '.card-b')];
        check((va === target) !== (vb === target), `${name}: exactly one card is ${target} (${va}, ${vb})`);
        check(ok === ((pickA ? va : vb) === target), `${name}: match feedback agrees with the values`);
        check(Boolean(await page.$(`${va === target ? '.card-a' : '.card-b'}.higher`)), `${name}: matching card highlighted`);
        if (!ok) { await audit(page, `${name} match reveal`); await afterVerdict(page, name, false); break; }
        streak++;
        await afterVerdict(page, name, true);
      }
      await page.waitForSelector('.big-score', { timeout: 5000 });
      check(Number(await page.textContent('.big-score span')) === streak, `${name}: match score is the streak (${streak})`);
      check(Number(await page.evaluate(() => localStorage.getItem('percento:best:match')) || 0) >= streak, `${name}: match best saved`);
      await audit(page, `${name} match over`);

      // Odd one out: four cards, one clear outsider, explained after the pick.
      for (const route of ['#/odd', '#/odd/economy']) {
        await page.goto(`${BASE}${route}`);
        await page.waitForSelector('.odd-grid .card-pick:not([disabled])');
        check((await page.$$('.odd-grid .card')).length === 4, `${name}: odd one out shows four cards`);
        if (route === '#/odd') await audit(page, `${name} odd round`);
        const cats = await page.$$eval('.card-cat', (els) => els.map((e) => e.textContent.trim()));
        if (route === '#/odd') check(new Set(cats).size === 4, `${name}: odd one out mixes categories (${cats})`);
        else check(cats.every((c) => c === 'Economy'), `${name}: odd one out keeps to the category (${cats})`);
        await page.keyboard.press('1');
        const ok = await waitReveal(page);
        const values = [];
        for (let k = 1; k <= 4; k++) values.push(await readValue(page, `.odd-grid .card:nth-child(${k})`));
        const odd = await page.$$eval('.odd-grid .card', (els) => els.findIndex((e) => e.classList.contains('higher')));
        const rest = values.filter((_, k) => k !== odd);
        check(odd >= 0 && Math.max(...rest) - Math.min(...rest) <= 14, `${name}: the other three sit close together (${values})`);
        check(rest.every((v) => Math.abs(v - values[odd]) >= 12), `${name}: the outsider is clearly away (${values})`);
        check(ok === (odd === 0), `${name}: odd feedback agrees with the highlight`);
        check(await page.isVisible('.odd-why'), `${name}: odd one out explains the answer`);
        check((await page.$$('.odd-ruler .pin')).length === 4, `${name}: all four values on the ruler`);
        if (route === '#/odd') { await audit(page, `${name} odd reveal`); await page.screenshot({ path: join(SHOTS, `${name}-odd-reveal.png`), fullPage: true }); }
        if (ok) await page.waitForSelector('.odd-grid .card-pick:not([disabled])', { timeout: 6000 });
        else { await skip(page); await page.waitForSelector('.big-score'); }
      }
      await context.close();
    }

    log('▶ languages');
    for (const [lang, locale] of [['it', 'it-IT'], ['fr', 'fr-FR'], ['es', 'es-ES'], ['de', 'de-DE'], ['pt', 'pt-BR']]) {
      const dict = (await import(join(ROOT, 'src', 'locales', `${lang}.js`))).default;
      const cards = JSON.parse(readFileSync(join(ROOT, 'data', 'i18n', `${lang}.json`), 'utf8'));
      const context = await newContext({ viewport: { width: 360, height: 760 }, locale });
      const page = await context.newPage();
      watch(page);
      await page.goto(`${BASE}#/`);
      await page.waitForSelector('.home-choice');
      check((await page.getAttribute('html', 'lang')) === lang, `${lang}: language picked from the browser`);
      check((await page.textContent('.nav [data-route="play"] span')) === dict.Play, `${lang}: nav translated`);
      check((await page.textContent('.hero .screen-title span')) === dict['One is higher.'], `${lang}: home translated`);
      await audit(page, `${lang} home`);
      await page.screenshot({ path: join(SHOTS, `${lang}-home.png`), fullPage: true });
      await page.goto(`${BASE}#/endless`);
      await page.waitForSelector('.card-pick');
      const texts = await cardTexts(page);
      const translated = new Set(Object.values(cards).map((c) => c[0]));
      check(texts.every((t) => translated.has(t)), `${lang}: cards translated (${texts})`);
      await audit(page, `${lang} round`);
      await page.click('.card-a .card-pick');
      await waitReveal(page);
      const values = await page.$$eval('.card-value', (els) => els.map((e) => e.textContent));
      check(values.every((v) => !/\d\.\d/.test(v)), `${lang}: decimal comma in percentages (${values})`);
      await audit(page, `${lang} reveal`);
      await page.screenshot({ path: join(SHOTS, `${lang}-reveal.png`), fullPage: true });
      await page.goto(`${BASE}#/guess`);
      await page.waitForSelector('.guess-slider');
      await audit(page, `${lang} closest guess`);
      await page.goto(`${BASE}#/match`);
      await page.waitForSelector('.target');
      await audit(page, `${lang} match the card`);
      await page.goto(`${BASE}#/odd`);
      await page.waitForSelector('.odd-grid .card-pick');
      await page.click('.odd-grid .card:nth-child(2) .card-pick');
      await waitReveal(page);
      await page.waitForSelector('.odd-why');
      await audit(page, `${lang} odd one out`);
      await page.goto(`${BASE}#/solo`);
      await page.waitForSelector('.cat-tile');
      await audit(page, `${lang} single player`);
      await page.goto(`${BASE}#/online`);
      await page.waitForSelector('main .screen-title');
      await audit(page, `${lang} online`);
      if (lang === 'it') {
        // Switching language in Settings reloads the game in the new language.
        await page.goto(`${BASE}#/settings`);
        await page.waitForSelector('.lang-select');
        await page.selectOption('.lang-select', 'fr');
        await page.waitForLoadState('load');
        await page.waitForFunction(() => document.documentElement.lang === 'fr');
        check(true, '');
        await page.goto(`${BASE}#/`);
        await page.waitForSelector('.home-choice');
        check((await page.textContent('.nav [data-route="play"] span')) !== dict.Play, 'settings: language switch to French');
      }
      await context.close();
    }

    log('▶ storage blocked');
    {
      const context = await newContext({ viewport: { width: 360, height: 760 } });
      await context.addInitScript(() => {
        Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } });
      });
      const page = await context.newPage();
      watch(page);
      await playEndless(page, 'storage-blocked');
      check(Boolean(await page.$('text=blocks storage')), 'storage-blocked: notice shown');
      await page.clock.setFixedTime(DAILY_TIME);
      await page.goto(`${BASE}#/daily`);
      await startDailyScreen(page, 'storage-blocked');
      await page.waitForSelector('.card-pick');
      await context.close();
    }

    log('▶ reduced motion');
    {
      const context = await newContext({ viewport: { width: 360, height: 760 }, reducedMotion: 'reduce' });
      const page = await context.newPage();
      watch(page);
      await page.goto(`${BASE}#/endless`);
      await page.waitForSelector('.card-pick');
      const t0 = Date.now();
      await page.click('.card-a .card-pick');
      await waitReveal(page);
      check(Date.now() - t0 < 600, `reduced motion: reveal should be instant (${Date.now() - t0}ms)`);
      await context.close();
    }

    log('▶ accounts and friends room');
    {
      const context = await newContext({ viewport: { width: 1280, height: 800 }, permissions: ['clipboard-read', 'clipboard-write'] });
      const p1 = await context.newPage();
      const p2 = await context.newPage();
      watch(p1);
      watch(p2);
      const signUp = async (page, name, email) => {
        await page.waitForSelector('text=Create account');
        await page.click('.actions >> text=Create account');
        await page.waitForSelector('input[name=username]');
        await page.fill('input[name=username]', name);
        await page.fill('input[name=email]', email);
        await page.fill('input[name=password]', 'secret123');
        await page.click('button[type=submit]');
      };
      // Guest asks for friends → account → back to friends, signed in.
      await p1.goto(`${BASE}#/online`);
      await p1.waitForSelector('text=Pick a nickname so the others know');
      await signUp(p1, 'Anna_1', 'anna@example.com');
      await p1.waitForSelector('main >> text=Room with friends');
      check(p1.url().endsWith('#/online'), `room flow: back to the online page after sign-up (${p1.url()})`);
      await p1.waitForFunction(() => document.querySelector('[data-account-label]').textContent === 'Anna_1', null, { timeout: 3000 })
        .then(() => check(true, ''), () => check(false, 'account: nav shows the player name'));
      await audit(p1, 'friends');
      await p1.click('main button:has-text("Create a room")');
      await p1.waitForSelector('text=Private room');
      const code = p1.url().split('#/room/')[1];
      check(/^[A-Z0-9]{6}$/.test(code), `room: code in the URL (${code})`);
      check(await p1.isDisabled('text=Start (needs 2 players)'), 'room: host cannot start alone');
      await audit(p1, 'room lobby');

      // The invite link signs the friend up and drops them in the lobby.
      await p2.goto(`${BASE}#/room/${code}`);
      await p2.waitForSelector(`text=Your friend invited you`);
      await signUp(p2, 'anna_1', 'bob@example.com');
      await p2.waitForSelector('.form-message');
      check((await p2.textContent('.form-message')).includes('taken'), 'account: player names are unique, case-insensitive');
      await p2.fill('input[name=username]', 'Bob');
      await p2.click('button[type=submit]');
      await p2.waitForSelector('text=Waiting for the host');
      await p1.waitForSelector('text=Start the game', { timeout: 8000 });
      check((await p1.textContent('.room-board')).includes('Bob'), 'room: host sees the friend join');
      await p1.click('text=Start the game');
      await p1.waitForSelector('.round-timer');
      await p2.waitForSelector('.round-timer', { timeout: 8000 });
      const t = Number(await p1.textContent('.round-timer b'));
      check(t >= 13 && t <= 15, `room: 15-second clock (${t})`);
      const p1First = await cardTexts(p1);
      check(JSON.stringify(p1First) === JSON.stringify(await cardTexts(p2)), 'room: both players get the same cards');

      // Bob lets the clock run out (counts as wrong); Anna plays until a mistake.
      const bob = (async () => {
        await p2.waitForSelector('text=Time is up', { timeout: 20000 });
        await skip(p2);
        await p2.waitForSelector('.room-board');
        const t2 = await p2.textContent('.screen-title');
        check(/You are out!|wins!|tie/.test(t2), `room: out after the clock runs out (${t2})`);
      })();
      const anna = (async () => {
        let annaScore = 0;
        for (let i = 0; i < 40; i++) {
          await p1.waitForSelector('.card-pick:not([disabled])');
          await p1.click('.card-a .card-pick');
          if (!(await waitReveal(p1))) break;
          annaScore++;
          await p1.waitForSelector('.card-pick:not([disabled])', { timeout: 5000 });
        }
        await skip(p1);
        return annaScore;
      })();
      const [, annaScore] = await Promise.all([bob, anna]);
      await p1.waitForSelector('.screen-title:has-text("🏆")', { timeout: 30000 });
      await p2.waitForSelector('.screen-title:has-text("🏆")', { timeout: 8000 });
      if (annaScore > 0) check((await p1.textContent('.screen-title')).includes('You win!'), 'room: the winner is told so');
      check((await p2.textContent('.room-board')).includes('Anna_1'), 'room: final standings list every player');
      const headline = await p2.textContent('.screen-title');
      check(annaScore > 0 ? headline.includes('Anna_1 wins') : headline.includes("It's a tie"), `room: winner announced (${headline}, Anna scored ${annaScore})`);
      await audit(p1, 'room results');
      await p1.screenshot({ path: join(SHOTS, 'room-results.png'), fullPage: true });

      // Strangers: two players looking for a public game land in the same one,
      // and it starts by itself once a second player is in.
      await p1.goto(`${BASE}#/online`);
      await p1.click('main button:has-text("Find a game")');
      await p1.waitForSelector('text=Finding players');
      check((await p1.textContent('main')).includes('at least one more player'), 'quick match: waits for a second player');
      await p2.goto(`${BASE}#/online`);
      await p2.click('main button:has-text("Find a game")');
      await p2.waitForSelector('text=Finding players');
      check(p1.url() === p2.url(), `quick match: same public game (${p1.url()} vs ${p2.url()})`);
      await p1.waitForSelector('.round-timer', { timeout: 15000 });
      await p2.waitForSelector('.round-timer', { timeout: 15000 });
      check(JSON.stringify(await cardTexts(p1)) === JSON.stringify(await cardTexts(p2)), 'quick match: same cards for both');
      await audit(p2, 'quick match round');

      // Odd one out with a friend, cards from one category: same four cards, on the clock.
      await p1.goto(`${BASE}#/online`);
      await p1.waitForSelector('.cat-chip');
      check((await p1.$$('.mode-tile')).length === 4, 'multiplayer: all four games');
      check((await p1.$$('.cat-chip')).length === 14, 'multiplayer: mixed plus every category');
      await p1.click('.mode-tile:has-text("Odd one out")');
      await p1.click('.cat-chip:has-text("Space")');
      await p1.click('.box .settings-menu summary');
      await p1.click('.settings-pop .seg:has-text("20s")');
      await p1.click('.settings-pop .seg:text-is("3")');
      await audit(p1, 'multiplayer choices');
      await p1.click('main button:has-text("Create a room")');
      await p1.waitForSelector('.kicker:has-text("Odd one out")');
      check((await p1.textContent('main')).includes('20 seconds each') && (await p1.textContent('main')).includes('3 lives each'), 'odd room: the host settings are shown in the lobby');
      const oddRoom = p1.url().split('#/room/')[1];
      await p2.goto(`${BASE}#/room/${oddRoom}`);
      await p2.waitForSelector('text=Waiting for the host');
      await p1.waitForSelector('text=Start the game', { timeout: 8000 });
      await p1.click('text=Start the game');
      await p1.waitForSelector('.odd-grid .card-pick:not([disabled])', { timeout: 10000 });
      await p2.waitForSelector('.odd-grid .card-pick:not([disabled])', { timeout: 10000 });
      check(JSON.stringify(await cardTexts(p1)) === JSON.stringify(await cardTexts(p2)), 'odd room: same four cards for both');
      check((await p1.$$eval('.card-cat', (els) => els.map((e) => e.textContent.trim()))).every((c) => c === 'Space'), 'odd room: cards from the chosen category');
      check((await p1.textContent('.round-timer b')) === '20', 'odd room: 20 seconds per question');
      check((await p1.textContent('.pill small')).includes('♥♥♥'), 'odd room: three lives');
      await audit(p1, 'odd room round');
      await p1.click('.odd-grid .card:nth-child(1) .card-pick');
      if (!(await waitReveal(p1))) {
        await skip(p1);
        await p1.waitForSelector('.odd-grid .card-pick:not([disabled])', { timeout: 5000 });
        check((await p1.textContent('.pill small')).includes('♥♥♡'), 'odd room: a mistake costs one life, the game goes on');
      }
      await p2.waitForSelector('.room-live', { timeout: 5000 });

      // Closest guess with a friend: same card, the guesses meet on a ruler,
      // a guess that is not locked in is sent when the clock runs out.
      await p1.goto(`${BASE}#/online`);
      await p1.click('.mode-tile:has-text("Closest guess")');
      await p1.click('main button:has-text("Create a room")');
      await p1.waitForSelector('text=Closest guess');
      const guessRoom = p1.url().split('#/room/')[1];
      await p2.goto(`${BASE}#/room/${guessRoom}`);
      await p2.waitForSelector('text=Waiting for the host');
      // A guest joins with just a nickname (same nickname as a player: it gets made unique).
      const p3 = await context.newPage();
      watch(p3);
      await p3.goto(`${BASE}#/room/${guessRoom}`);
      await p3.waitForSelector('text=Play as a guest');
      await audit(p3, 'guest join');
      await p3.fill('input[name=nickname]', 'Bob');
      await p3.click('button:has-text("Play as guest")');
      await p3.waitForSelector('text=Waiting for the host');
      check(/^Bob\d{5}$/.test(await p3.textContent('[data-account-label]')), 'guest: nickname made unique and shown in the nav');
      await p1.waitForSelector('.room-board li:nth-child(3)', { timeout: 8000 });
      await p1.waitForSelector('text=Start the game', { timeout: 8000 });
      await p1.click('text=Start the game');
      await p1.waitForSelector('.guess-slider:not([disabled])', { timeout: 10000 });
      await p2.waitForSelector('.guess-slider:not([disabled])', { timeout: 10000 });
      await p3.waitForSelector('.guess-slider:not([disabled])', { timeout: 10000 });
      check((await p1.textContent('.card-text')) === (await p2.textContent('.card-text')), 'guess room: same card for both');
      await audit(p1, 'guess room round');
      await setGuess(p1, 30);
      await p1.click('.lock');
      await setGuess(p2, 70);
      await p1.waitForSelector('.guess-ruler:not([hidden]) .pin:has-text("Bob")', { timeout: 10000 });
      await p2.waitForSelector('.guess-ruler:not([hidden]) .pin:has-text("Anna_1")', { timeout: 10000 });
      check((await p2.textContent('.guess-ruler')).includes('70%'), 'guess room: an unlocked guess is sent when time runs out');
      check(/closest/i.test(await p1.textContent('.guess-status')), 'guess room: the closest player is announced');
      await audit(p1, 'guess room reveal');
      await p1.waitForSelector('.screen-title:has-text("🏆")', { timeout: 40000 });
      await p2.waitForSelector('.screen-title:has-text("🏆")', { timeout: 8000 });
      await p3.waitForSelector('text=Final standings', { timeout: 8000 });

      // The guest keeps their name and records by adding an email.
      await p3.goto(`${BASE}#/account`);
      await p3.waitForSelector('text=Playing online as a guest');
      await audit(p3, 'guest account');
      await p3.fill('input[name=email]', 'carla@example.com');
      await p3.fill('input[name=password]', 'secret123');
      await p3.click('button:has-text("Save my account")');
      await p3.waitForSelector('text=Signed in');
      check((await p3.textContent('.screen-title')).includes('Bob'), 'guest: upgraded account keeps the nickname');
      await p3.close();
      check((await p1.textContent('main')).includes('Final standings'), 'guess room: final standings');
      await p1.screenshot({ path: join(SHOTS, 'guess-room-results.png'), fullPage: true });

      // The world board sums the daily challenges: 7 right pairs (70) + 250 guess points / 5 (50).
      await playEndless(p1, 'signed-in');
      await p1.evaluate((day) => {
        const db = JSON.parse(localStorage.getItem('fake-supabase-db'));
        const anna = db.profiles.find((p) => p.username === 'Anna_1').id;
        db.daily_results.push({ user_id: anna, day, answers: [true, true, true, true, true, true, true, false, false, false], score: 7, guess_points: 250, guess_cards: 5 });
        localStorage.setItem('fake-supabase-db', JSON.stringify(db));
      }, romeDate());
      await p1.goto(`${BASE}#/leaderboard`);
      await p1.waitForSelector('.board li.me');
      check((await p1.textContent('main')).includes('World leaderboard'), 'leaderboard: world board shown');
      const myRow = await p1.textContent('.board li.me');
      check(myRow.includes('Anna_1') && myRow.includes('120'), `leaderboard: daily challenges summed on the world board (${myRow})`);

      // Sign out, wrong password, Google not enabled, then back in.
      await p1.goto(`${BASE}#/account`);
      await p1.click('text=Sign out');
      await p1.waitForSelector('.home-choice');
      await p1.waitForFunction(() => document.querySelector('[data-account-label]').textContent === 'Sign in', null, { timeout: 3000 })
        .then(() => check(true, ''), () => check(false, 'account: signed out'));
      await p1.goto(`${BASE}#/account`);
      await p1.waitForSelector('input[name=email]');
      await audit(p1, 'sign in');
      await p1.click('text=Continue with Google');
      await p1.waitForSelector('.form-message:has-text("Google")');
      await p1.fill('input[name=email]', 'anna@example.com');
      await p1.fill('input[name=password]', 'wrong-pass');
      await p1.click('button[type=submit]');
      await p1.waitForSelector('text=Wrong email or password');
      await p1.fill('input[name=password]', 'secret123');
      await p1.click('button[type=submit]');
      await p1.waitForSelector('text=Hi, Anna_1!');
      await p1.waitForSelector('.stat-row');
      check(Number(await p1.textContent('.stat-row p:nth-child(2) b')) >= 1, 'account: endless games saved to the account');
      await audit(p1, 'profile');
      // Deleting the account asks once more, then removes it and signs out.
      await p1.click('button:has-text("Delete my account")');
      await audit(p1, 'delete account');
      await p1.click('button:has-text("Delete for good")');
      await p1.waitForFunction(() => document.querySelector('[data-account-label]').textContent === 'Sign in', null, { timeout: 5000 })
        .then(() => check(true, ''), () => check(false, 'account: deleted and signed out'));
      check(await p1.evaluate(() => !JSON.parse(localStorage.getItem('fake-supabase-db')).profiles.some((p) => p.username === 'Anna_1')), 'account: profile removed');
      await context.close();
    }

    log('▶ server unreachable');
    {
      const context = await browser.newContext({ viewport: { width: 360, height: 760 } });
      await context.route('**/vendor/supabase-*.js', (r) => r.abort());
      const page = await context.newPage();
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`${BASE}#/account`);
      await page.waitForSelector('text=Accounts are unavailable');
      await page.goto(`${BASE}#/`);
      await page.waitForSelector('.home-choice');
      check(Boolean(await page.$('text=(this device)')), 'offline: leaderboard falls back to this device');
      await context.close();
    }

    log('▶ production build');
    {
      execFileSync(process.execPath, [join(ROOT, 'scripts', 'build.mjs'), '--mode=production', '--out=dist-prod']);
      const prodServer = await startServer(PORT + 1, join(ROOT, 'dist-prod'));
      const { BUILD } = await import(join(ROOT, 'dist-prod', 'src', 'data.js'));
      const context = await newContext({ viewport: { width: 360, height: 760 } });
      const page = await context.newPage();
      watch(page);
      await page.goto(`http://127.0.0.1:${PORT + 1}/#/endless`);
      await page.waitForSelector('.screen-title');
      check(!(await page.$('.dev-banner')), 'production: no dev banner');
      if (BUILD.count < 2) check((await page.textContent('.screen-title')).includes('calibrating'), 'production: calibrating screen when no verified data');
      else check(Boolean(await page.$('.card-pick')), 'production: game playable');
      await page.goto(`http://127.0.0.1:${PORT + 1}/#/review`);
      check(!(await page.textContent('main')).includes('Review mode'), 'production: review mode disabled');
      await context.close();
      prodServer.close();
    }

    check(errors.length === 0, `console/page errors: ${errors.slice(0, 5).join(' | ')}`);
  } finally {
    if (errors.length) console.log('page errors:', errors.slice(0, 5));
    await browser.close();
    server.close();
  }
  log(`\n${passes} checks passed, ${failures.length} failed`);
  if (failures.length) { for (const f of failures) log(` - ${f}`); process.exit(1); }
}

main().catch((err) => { console.error(err); process.exit(1); });
