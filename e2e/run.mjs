// End-to-end QA in headless Chromium (no test framework, no runtime deps).
// Runs against dist/ (build it first: `npm run test:e2e` does).
//   - full Endless and Daily games at 360px and desktop widths
//   - no horizontal scroll, no tap target under 44px, WCAG AA text contrast
//   - keyboard play, reduced motion, storage blocked, reload-resume, share/copy
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { startServer } from '../scripts/serve.mjs';
import { ROOT } from '../scripts/lib/data.mjs';

const PORT = 8097;
const BASE = `http://127.0.0.1:${PORT}/`;
const SHOTS = join(ROOT, 'e2e', 'screenshots');
const EXECUTABLE = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
mkdirSync(SHOTS, { recursive: true });

const { ENTRIES } = await import(join(ROOT, 'dist', 'src', 'data.js'));
const newest = ENTRIES.map((e) => (e.verifiedOn && e.verifiedOn > e.addedOn ? e.verifiedOn : e.addedOn)).sort().pop();
const DAILY_TIME = new Date(Date.parse(`${newest}T12:00:00Z`) + 2 * 86400000);

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

async function waitReveal(page) {
  await page.waitForSelector('.continue:not([hidden])', { timeout: 8000 });
}

// ---------- scenarios ----------
async function playEndless(page, label, { keyboard = false } = {}) {
  await page.goto(`${BASE}#/endless`);
  await page.waitForSelector('.card-pick');
  await audit(page, `${label} endless round`);
  let rounds = 0;
  let correctStreak = 0;
  let lastHigher = null;
  while (rounds < 60) {
    const texts = await cardTexts(page);
    // A champion with nothing higher left is retired: the round starts fresh with both values hidden.
    const fresh = (await page.textContent('.card-a .card-value')).trim() === '?';
    if (lastHigher && !fresh) check(texts[0] === lastHigher, `${label}: higher card should stay on top (round ${rounds})`);
    // Alternate inputs; after a few rounds answer wrong on purpose to end.
    const pickA = rounds % 2 === 0;
    if (keyboard) await page.keyboard.press(pickA ? '1' : 'ArrowDown');
    else await page.click(pickA ? '.card-a .card-pick' : '.card-b .card-pick');
    await waitReveal(page);
    if (rounds === 0) await audit(page, `${label} endless reveal`);
    const [va, vb] = [await readValue(page, '.card-a'), await readValue(page, '.card-b')];
    const correct = pickA ? va > vb : vb > va;
    check(Math.abs(va - vb) >= 3, `${label}: pair values ${va} and ${vb} closer than 3 points`);
    const ok = await page.$('.feedback.ok');
    check(Boolean(ok) === correct, `${label}: feedback does not match answer`);
    const sources = await page.$$eval('.card-source:not([hidden]) a', (as) => as.map((a) => a.href));
    check(sources.length === 2, `${label}: both sources shown after reveal`);
    rounds++;
    if (!correct) {
      if (keyboard) await page.keyboard.press('Enter'); else await page.click('.continue');
      break;
    }
    correctStreak++;
    lastHigher = va > vb ? texts[0] : texts[1];
    if (keyboard) await page.keyboard.press('Enter'); else await page.click('.continue');
    await page.waitForSelector('.card-pick:not([disabled])');
  }
  await page.waitForSelector('.big-score', { timeout: 5000 });
  const score = Number(await page.textContent('.big-score span'));
  check(score === correctStreak, `${label}: game-over score ${score} != ${correctStreak}`);
  await audit(page, `${label} game over`);
  await page.screenshot({ path: join(SHOTS, `${label}-gameover.png`), fullPage: true });
  return score;
}

async function playDaily(page, context, label, { reloadAt = 4 } = {}) {
  await page.goto(`${BASE}#/daily`);
  await page.waitForSelector('.card-pick');
  const firstPair = await cardTexts(page);
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
    await waitReveal(page);
    if (i === 0) await audit(page, `${label} daily reveal`);
    await page.click('.continue');
    if (i < 9) await page.waitForSelector('.card-pick:not([disabled])');
  }
  await page.waitForSelector('.share-text');
  const grid = await page.textContent('.grid');
  check([...grid].filter((c) => c === '🟩' || c === '🟥').length === 10, `${label}: grid should have 10 squares`);
  const text = await page.textContent('.share-text');
  check(/^PERCENTO Daily \d{4}-\d{2}-\d{2}: \d+\/10\n[🟩🟥]{10}\nhttp/u.test(text), `${label}: share text format: ${JSON.stringify(text)}`);
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

async function main() {
  const server = await startServer(PORT);
  const browser = await chromium.launch({ executablePath: EXECUTABLE });
  const errors = [];
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
        const context = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, permissions: ['clipboard-read', 'clipboard-write'] });
        const page = await context.newPage();
        watch(page);
        await page.goto(BASE);
        await page.waitForSelector('.card-pick');
        await audit(page, `${label} home`);
        await page.screenshot({ path: join(SHOTS, `${label}-home.png`), fullPage: true });
        const score = await playEndless(page, label, { keyboard: scheme === 'dark' });
        const best = Number(await page.evaluate(() => localStorage.getItem('percento:best')) || 0);
        check(best >= score, `${label}: personal best saved (${best} vs ${score})`);
        // Entries only join the daily set the day after they are added, so
        // the daily runs two days after the newest addedOn.
        await page.clock.setFixedTime(DAILY_TIME);
        dailyFirstPairs.push(await playDaily(page, context, label));
        await page.goto(`${BASE}#/sources`);
        await page.waitForSelector('.source-list');
        await audit(page, `${label} sources`);
        const links = await page.$$eval('.source-list a', (as) => as.length);
        check(links > 0, `${label}: sources listed`);
        await context.close();
      }
    }
    check(new Set(dailyFirstPairs.map((p) => JSON.stringify(p))).size === 1, 'daily: identical first pair across separate devices/contexts');

    log('▶ storage blocked');
    {
      const context = await browser.newContext({ viewport: { width: 360, height: 760 } });
      await context.addInitScript(() => {
        Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } });
      });
      const page = await context.newPage();
      watch(page);
      await playEndless(page, 'storage-blocked');
      check(Boolean(await page.$('text=blocks storage')), 'storage-blocked: notice shown');
      await page.clock.setFixedTime(DAILY_TIME);
      await page.goto(`${BASE}#/daily`);
      await page.waitForSelector('.card-pick');
      await context.close();
    }

    log('▶ reduced motion');
    {
      const context = await browser.newContext({ viewport: { width: 360, height: 760 }, reducedMotion: 'reduce' });
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

    log('▶ production build');
    {
      execFileSync(process.execPath, [join(ROOT, 'scripts', 'build.mjs'), '--mode=production', '--out=dist-prod']);
      const prodServer = await startServer(PORT + 1, join(ROOT, 'dist-prod'));
      const { BUILD } = await import(join(ROOT, 'dist-prod', 'src', 'data.js'));
      const context = await browser.newContext({ viewport: { width: 360, height: 760 } });
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
    await browser.close();
    server.close();
  }
  log(`\n${passes} checks passed, ${failures.length} failed`);
  if (failures.length) { for (const f of failures) log(` - ${f}`); process.exit(1); }
}

main().catch((err) => { console.error(err); process.exit(1); });
