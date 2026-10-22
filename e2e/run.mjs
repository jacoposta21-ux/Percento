// End-to-end QA in headless Chromium (no test framework, no runtime deps).
// Runs against dist/ (build it first: `npm run test:e2e` does).
//   - full Endless and Daily games at 360px and desktop widths
//   - no horizontal scroll, no tap target under 44px, WCAG AA text contrast
//   - keyboard play, reduced motion, storage blocked, reload-resume, share/copy
//   - accounts, world leaderboard and a 2-player friends room against an
//     in-browser fake of Supabase (e2e/fake-supabase.js); offline fallback
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { startServer } from '../scripts/serve.mjs';
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

// A right answer must move on by itself; a wrong one must wait for the button.
async function afterVerdict(page, label, correct, { keyboard = false, last = false } = {}) {
  if (correct) {
    check(await page.isHidden('.continue'), `${label}: no Continue button after a right answer`);
    if (!last) await page.waitForSelector('.card-pick:not([disabled])', { timeout: 5000 });
    return;
  }
  await page.waitForSelector('.continue:not([hidden])', { timeout: 3000 });
  await page.waitForTimeout(1900);
  check(await page.isVisible('.continue'), `${label}: wrong answer should wait for the button`);
  if (keyboard) await page.keyboard.press('Enter'); else await page.click('.continue');
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

async function playDaily(page, context, label, { reloadAt = 4 } = {}) {
  await page.goto(`${BASE}#/daily`);
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
    if (!correct && !audited) { await audit(page, `${label} daily reveal`); audited = true; }
    await afterVerdict(page, label, correct, { last: i === 9 });
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
      await p1.goto(`${BASE}#/friends`);
      await p1.waitForSelector('text=Rooms need an account');
      await signUp(p1, 'Anna_1', 'anna@example.com');
      await p1.waitForSelector('main >> text=New room');
      check(p1.url().endsWith('#/friends'), `room flow: back to friends after sign-up (${p1.url()})`);
      await p1.waitForFunction(() => document.querySelector('[data-account-label]').textContent === 'Anna_1', null, { timeout: 3000 })
        .then(() => check(true, ''), () => check(false, 'account: nav shows the player name'));
      await audit(p1, 'friends');
      await p1.click('main button:has-text("Create a room")');
      await p1.waitForSelector('text=Waiting room');
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
        await p2.waitForSelector('.continue:not([hidden])', { timeout: 5000 });
        await p2.click('.continue');
        await p2.waitForSelector('.room-board');
        const t2 = await p2.textContent('.screen-title');
        check(/You are out!|wins!/.test(t2), `room: out after the clock runs out (${t2})`);
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
        await p1.click('.continue');
        return annaScore;
      })();
      const [, annaScore] = await Promise.all([bob, anna]);
      await p1.waitForSelector('.screen-title:has-text("🏆")', { timeout: 30000 });
      await p2.waitForSelector('.screen-title:has-text("🏆")', { timeout: 8000 });
      if (annaScore > 0) check((await p1.textContent('.screen-title')).includes('You win!'), 'room: the winner is told so');
      check((await p2.textContent('.room-board')).includes('Anna_1'), 'room: final standings list every player');
      const headline = await p2.textContent('.screen-title');
      check(annaScore > 0 ? headline.includes('Anna_1 wins') : headline.includes('Anna_1 & Bob wins'), `room: winner announced (${headline}, Anna scored ${annaScore})`);
      await audit(p1, 'room results');
      await p1.screenshot({ path: join(SHOTS, 'room-results.png'), fullPage: true });

      // Solo runs count on the world board once signed in.
      await playEndless(p1, 'signed-in');
      await p1.goto(`${BASE}#/leaderboard`);
      await p1.waitForSelector('.board li.me');
      check((await p1.textContent('main')).includes('World leaderboard'), 'leaderboard: world board shown');
      check((await p1.textContent('.board li.me')).includes('Anna_1'), 'leaderboard: my run is on the world board');

      // Sign out, wrong password, Google not enabled, then back in.
      await p1.goto(`${BASE}#/account`);
      await p1.click('text=Sign out');
      await p1.waitForSelector('.card-pick');
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
      await page.waitForSelector('.card-pick');
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
