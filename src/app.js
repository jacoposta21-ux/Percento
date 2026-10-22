// PERCENTO app: routing, screens, side panel and the round engine shared by both modes.
import { ENTRIES, BUILD } from './data.js';
import { CATEGORIES, CATEGORY_IDS, RULES } from './config.js';
import { createPairGenerator, higherOf, mulberry32, hashString } from './pairs.js';
import { dailyPairs, romeDate, msUntilNextDaily, formatCountdown } from './daily.js';
import { createDial } from './dial.js';
import { load, save, storageAvailable } from './storage.js';
import { shareResult, shareText } from './share.js';
import {
  TAGLINE, INSTRUCTION, HEADLINES, RIGHT_QUIPS, WRONG_QUIPS, GAME_OVER_LINES, DAILY_END_LINES, pickByScore,
} from './copy.js';

const BEST_KEY = 'percento:best';
const RUNS_KEY = 'percento:runs';
const DAILY_HISTORY_KEY = 'percento:dailyHistory';
const MOTION_KEY = 'percento:reduceMotion';
const TITLE = 'Which percentage is higher?';
const dailyKey = (date) => `percento:daily2:${date}`;
// Pause on a right answer before the next pair appears by itself.
const AUTO_NEXT_MS = 1600;
const app = document.getElementById('app');
const panel = document.getElementById('panel');
let cleanup = [];
let keyHandler = null;

// ---------- helpers ----------
function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v === null || v === undefined) continue;
    if (k === 'class') node.className = v;
    else if (k === 'style') node.setAttribute('style', v);
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) if (c !== null && c !== undefined && c !== false) node.append(c.nodeType ? c : String(c));
  return node;
}

export const formatValue = (v) => `${Number.isInteger(v) ? v : v.toFixed(1)}%`;
const formatReading = (reading, target) => `${Number.isInteger(target) ? Math.round(reading) : reading.toFixed(1)}%`;
const pickFrom = (list, rng = Math.random) => list[Math.floor(rng() * list.length)];
const colorOf = (e) => CATEGORIES[e.category].color;
const shareUrl = () => `${location.origin}${location.pathname}`;

function toast(message) {
  const region = document.getElementById('toast');
  region.textContent = message;
  region.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => region.classList.remove('show'), 2600);
}

function setKeys(handler) {
  if (keyHandler) document.removeEventListener('keydown', keyHandler);
  keyHandler = handler;
  if (handler) document.addEventListener('keydown', handler);
}

/** Replaces the main area; the first child gets focus for screen readers. */
function mount(...children) {
  const nodes = children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false);
  if (BUILD.mode === 'dev') nodes.unshift(h('p', { class: 'dev-banner' }, 'Test build with unverified statistics. ', h('a', { href: '#/review' }, 'Review mode')));
  app.replaceChildren(...nodes);
  const heading = app.querySelector('.screen-title');
  heading?.setAttribute('tabindex', '-1');
  heading?.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

const playable = (pool) => pool.length >= 2 && createPairGenerator(pool, mulberry32(1)).next() !== null;

function calibrating() {
  mount(h('h1', { class: 'screen-title' }, 'The Percentometer is calibrating'),
    h('p', { class: 'lede' }, 'There are not enough verified statistics to play this yet. Every number has to be checked against its official source first.'),
    h('div', { class: 'actions' }, h('a', { class: 'btn btn-primary', href: '#/' }, 'Play Endless')));
}

// ---------- local leaderboard ----------
function recordRun(score) {
  const runs = load(RUNS_KEY, []) || [];
  runs.push({ score, date: new Date().toISOString().slice(0, 10) });
  runs.sort((a, b) => b.score - a.score);
  save(RUNS_KEY, runs.slice(0, 10));
}

function leaderboardList(limit, highlightIndex = -1) {
  const runs = (load(RUNS_KEY, []) || []).slice(0, limit);
  if (!runs.length) return h('p', { class: 'board-empty' }, 'No runs yet. Play Endless to set your first record.');
  return h('ol', { class: 'board' }, runs.map((r, i) => h('li', { class: i === highlightIndex ? 'me' : '' },
    h('span', { class: `rank rank-${i + 1}` }, String(i + 1)),
    h('span', { 'aria-hidden': 'true' }, i < 3 ? '👑' : '•'),
    h('span', { class: 'who' }, i === highlightIndex ? 'This run' : 'You', h('small', {}, r.date)),
    h('span', { class: 'score' }, String(r.score)))));
}

// ---------- side panel ----------
function renderPanel() {
  panel.replaceChildren(
    h('section', { class: 'box' },
      h('h2', {}, 'Leaderboard ', h('small', {}, '(this device)')),
      leaderboardList(5)),
    h('section', { class: 'box friends' },
      h('span', { class: 'friends-icon', 'aria-hidden': 'true' }, '👥'),
      h('h2', {}, 'Play with friends'),
      h('p', { class: 'muted' }, 'Same Daily Challenge for everyone. Compare your grids.'),
      h('button', { class: 'btn btn-primary btn-ghost', type: 'button', onclick: invite }, 'Invite')));
}

async function invite() {
  const result = await shareResult(`Which percentage is higher? Try PERCENTO: ${shareUrl()}`);
  if (result === 'copied') toast('Link copied. Send it to your friends!');
  else if (result === 'shared') toast('Shared!');
  else if (result === 'failed') toast(`Copy this link: ${shareUrl()}`);
}

// ---------- the round ----------
/**
 * Renders one pair. Options: pair, headline, pill {value, label}, progress (node),
 * onAnswer(correct), onContinue(correct), continueLabel. A right answer moves on
 * by itself; a wrong one waits for the button so the player can read the sources.
 */
function renderRound({ pair, headline, pill, progress, onAnswer, onContinue, continueLabel = 'Continue' }) {
  const dial = createDial();
  const cards = { a: pair.a, b: pair.b };
  let phase = 'ask';
  let correct = false;
  const dom = {};

  const card = (id) => {
    const e = cards[id];
    const value = h('span', { class: 'card-value' }, '?');
    const pick = h('button', {
      class: 'card-pick',
      type: 'button',
      'aria-label': `${id === 'a' ? 'Left' : 'Right'} card: ${e.text}, ${e.detail}. Pick as higher.`,
      onclick: () => choose(id),
    },
    h('span', { class: 'card-badge' }, h('i', { 'aria-hidden': 'true' }, CATEGORIES[e.category].emoji), h('span', {}, CATEGORIES[e.category].label)),
    h('span', { class: 'card-art', 'aria-hidden': 'true' }, e.emoji),
    h('span', { class: 'card-text' }, e.text),
    h('span', { class: 'card-detail' }, e.detail),
    value);
    const source = h('p', { class: 'card-source', hidden: true },
      'Source: ', h('a', { href: e.sourceUrl, target: '_blank', rel: 'noopener' }, e.source), ` · ${e.year}`);
    const wrap = h('div', { class: `card card-${id}`, style: `--c:${colorOf(e)}` }, pick, source);
    const answer = h('button', { class: 'answer', type: 'button', onclick: () => choose(id) },
      id === 'a' ? '← This one' : 'This one →', h('small', {}, id === 'a' ? 'key 1' : 'key 2'));
    dom[id] = { wrap, pick, value, source, answer };
    return wrap;
  };

  const feedback = h('p', { class: 'feedback', role: 'status', 'aria-live': 'polite' }, 'Pick a card. The Percentometer will reveal the truth.');
  const next = h('button', { class: 'btn btn-primary continue', type: 'button', hidden: true, onclick: () => advance() }, continueLabel);
  const duel = h('div', { class: 'duel' }, card('a'), h('div', { class: 'vs', 'aria-hidden': 'true' }, 'VS'), card('b'));
  dial.el.style.setProperty('--ca', colorOf(pair.a));
  dial.el.style.setProperty('--cb', colorOf(pair.b));

  mount(
    h('header', { class: 'round-head' },
      h('div', {}, h('p', { class: 'kicker' }, headline), h('h1', { class: 'screen-title' }, TITLE), h('p', { class: 'sub' }, INSTRUCTION)),
      pill ? h('div', { class: 'pill' }, h('span', { class: 'bolt', 'aria-hidden': 'true' }, '⚡'), h('span', {}, h('b', {}, String(pill.value)), h('small', {}, pill.label))) : null),
    duel,
    h('div', { class: 'answers' }, dom.a.answer, dom.b.answer),
    h('div', { class: 'reveal' }, dial.el, h('div', { class: 'reveal-side' }, feedback, next)),
    progress);

  dial.describe('Percentometer, waiting for your pick');

  async function choose(id) {
    if (phase !== 'ask') return;
    phase = 'reveal';
    const other = id === 'a' ? 'b' : 'a';
    correct = cards[id].value > cards[other].value;
    onAnswer?.(correct);
    for (const k of ['a', 'b']) { dom[k].pick.disabled = true; dom[k].answer.disabled = true; }
    dom[id].wrap.classList.add('chosen');
    feedback.textContent = 'Measuring…';
    const swings = [];
    for (const k of ['a', 'b']) {
      const target = cards[k].value;
      swings.push(dial.swing(k, target, (r) => {
        dom[k].value.textContent = formatReading(r, target);
        dom[k].answer.textContent = formatReading(r, target);
      }));
    }
    await Promise.all(swings);
    const high = higherOf(pair) === pair.a ? 'a' : 'b';
    for (const k of ['a', 'b']) {
      dom[k].value.textContent = formatValue(cards[k].value);
      dom[k].answer.textContent = formatValue(cards[k].value);
      dom[k].answer.classList.add(k === high ? 'win' : 'lose');
      dom[k].source.hidden = false;
    }
    dom[high].wrap.classList.add('higher');
    dom[high === 'a' ? 'b' : 'a'].wrap.classList.add('lower');
    dial.describe(`Percentometer: left card ${formatValue(pair.a.value)}, right card ${formatValue(pair.b.value)}`);
    feedback.className = `feedback ${correct ? 'ok' : 'ko'}`;
    feedback.textContent = `${correct ? '✓' : '✗'} ${pickFrom(correct ? RIGHT_QUIPS : WRONG_QUIPS)}`;
    phase = 'done';
    if (correct) {
      feedback.append(h('span', { class: 'auto-next', style: `--t:${AUTO_NEXT_MS}ms`, 'aria-hidden': 'true' }));
      const timer = setTimeout(advance, AUTO_NEXT_MS);
      cleanup.push(() => clearTimeout(timer));
    } else {
      next.hidden = false;
      next.focus({ preventScroll: true });
    }
  }

  function advance() {
    if (phase !== 'done') return;
    phase = 'gone';
    onContinue(correct);
  }

  setKeys((ev) => {
    if (ev.key === '1' || ev.key === 'ArrowUp' || ev.key === 'ArrowLeft') { ev.preventDefault(); choose('a'); }
    else if (ev.key === '2' || ev.key === 'ArrowDown' || ev.key === 'ArrowRight') { ev.preventDefault(); choose('b'); }
    else if (ev.key === 'Enter' && phase === 'done') { ev.preventDefault(); advance(); }
  });
}

// ---------- endless ----------
// One generator per page session, so pairs never repeat across runs either.
let sessionGen = null;

function startEndless() {
  if (!playable(ENTRIES)) return calibrating();
  if (!sessionGen) sessionGen = createPairGenerator(ENTRIES, Math.random);
  let score = 0;
  let best = load(BEST_KEY, 0) || 0;

  const round = () => {
    const pair = sessionGen.next();
    if (!pair) return endlessOver(score, best, true);
    renderRound({
      pair,
      headline: pickFrom(HEADLINES),
      pill: { value: score, label: `Streak · best ${best}` },
      progress: h('div', { class: 'progress' }, h('span', {}, `Score ${score}`), h('span', {}, `Personal best ${best}`)),
      onContinue: (correct) => {
        if (!correct) return endlessOver(score, best, false);
        score++;
        if (score > best) { best = score; save(BEST_KEY, best); }
        round();
      },
    });
  };
  round();
}

function endlessOver(score, best, exhausted) {
  recordRun(score);
  renderPanel();
  const runs = load(RUNS_KEY, []) || [];
  const myIndex = runs.findIndex((r) => r.score === score);
  setKeys((ev) => { if (ev.key === 'Enter') { ev.preventDefault(); startEndless(); } });
  const newBest = score > 0 && score >= best;
  mount(
    h('h1', { class: 'screen-title' }, exhausted ? 'You ran out of statistics!' : 'Game over'),
    h('p', { class: 'big-score' }, h('span', {}, String(score)), h('small', {}, score === 1 ? 'correct answer' : 'correct answers')),
    h('p', { class: 'lede' }, exhausted ? 'Every pair has been played. The Percentometer needs a nap.' : pickByScore(GAME_OVER_LINES, score, Math.floor(Math.random() * 2))),
    h('p', { class: 'muted' }, newBest ? `New personal best: ${best}!` : `Personal best: ${best}`),
    storageAvailable() ? null : h('p', { class: 'note' }, 'Your browser blocks storage, so your scores last only until you close this tab.'),
    h('div', { class: 'actions' },
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => startEndless() }, 'Play again'),
      h('a', { class: 'btn', href: '#/daily' }, 'Daily Challenge'),
      h('button', { class: 'btn', type: 'button', onclick: invite }, 'Challenge a friend')),
    h('section', { class: 'box' }, h('h2', {}, 'Your best runs'), leaderboardList(5, myIndex)));
}

// ---------- daily ----------
function startDaily() {
  const date = romeDate();
  const pairs = dailyPairs(ENTRIES, date);
  if (pairs.length < RULES.dailyPairs) {
    mount(h('h1', { class: 'screen-title' }, "Today's challenge is warming up"),
      h('p', { class: 'lede' }, 'New statistics join the Daily Challenge the day after they are added, so everyone gets the same set. Come back after midnight (Rome time).'),
      h('div', { class: 'actions' }, h('a', { class: 'btn btn-primary', href: '#/' }, 'Play Endless meanwhile')));
    return;
  }
  const state = load(dailyKey(date), null) || { answers: [] };
  // Headlines are deterministic too, so every player sees the same challenge.
  const rng = mulberry32(hashString(`percento-headlines:${date}`));
  const headlines = pairs.map(() => pickFrom(HEADLINES, rng));

  const dots = (i) => h('span', { class: 'dots', 'aria-hidden': 'true' },
    pairs.map((_, k) => h('span', { class: k < state.answers.length ? (state.answers[k] ? 'ok' : 'ko') : (k === i ? 'now' : '') })));

  const round = (i) => {
    if (i >= pairs.length) return dailyResults(date, pairs, state.answers);
    const pair = pairs[i];
    renderRound({
      pair,
      headline: headlines[i],
      pill: { value: state.answers.filter(Boolean).length, label: 'Correct today' },
      progress: h('div', { class: 'progress' }, h('span', { class: 'status' }, `Daily ${date} · Pair ${i + 1} of ${pairs.length}`), dots(i)),
      continueLabel: i === pairs.length - 1 ? 'See results' : 'Next pair',
      onAnswer: (correct) => {
        state.answers[i] = correct;
        save(dailyKey(date), state);
        if (state.answers.length === pairs.length) {
          const history = load(DAILY_HISTORY_KEY, {}) || {};
          history[date] = state.answers.filter(Boolean).length;
          save(DAILY_HISTORY_KEY, history);
        }
      },
      onContinue: () => round(i + 1),
    });
  };
  round(state.answers.length);
}

function dailyResults(date, pairs, answers) {
  const score = answers.filter(Boolean).length;
  const text = shareText({ date, answers, url: `${shareUrl()}#/daily` });
  const countdown = h('span', { class: 'countdown' }, formatCountdown(msUntilNextDaily()));
  const timer = setInterval(() => {
    countdown.textContent = formatCountdown(msUntilNextDaily());
    if (romeDate() !== date) { clearInterval(timer); startDaily(); }
  }, 1000);
  cleanup.push(() => clearInterval(timer));

  const doShare = async () => {
    const result = await shareResult(text);
    if (result === 'copied') toast('Result copied to clipboard. Go brag (politely).');
    else if (result === 'shared') toast('Shared!');
    else if (result === 'failed') toast('Could not copy automatically. Select the text above and copy it.');
  };
  setKeys((ev) => { if (ev.key === 'Enter' && document.activeElement?.tagName !== 'A') { ev.preventDefault(); doShare(); } });

  mount(
    h('p', { class: 'kicker' }, 'Daily Challenge'),
    h('h1', { class: 'screen-title' }, `Daily ${date}`),
    h('p', { class: 'big-score' }, h('span', {}, `${score}/${answers.length}`), h('small', {}, 'pairs right')),
    h('p', { class: 'grid', 'aria-label': answers.map((a, i) => `Pair ${i + 1} ${a ? 'right' : 'wrong'}`).join(', ') }, answers.map((a) => (a ? '🟩' : '🟥')).join('')),
    h('p', { class: 'lede' }, pickByScore(DAILY_END_LINES, score)),
    h('pre', { class: 'share-text', 'aria-label': 'Share text' }, text),
    h('div', { class: 'actions' },
      h('button', { class: 'btn btn-primary', type: 'button', onclick: doShare }, 'Share result'),
      h('a', { class: 'btn', href: '#/' }, 'Play Endless')),
    h('p', { class: 'muted' }, 'Next challenge in ', countdown, ' (midnight, Rome time)'),
    h('section', { class: 'box' }, h('h2', {}, "Today's pairs"),
      h('ol', { class: 'recap' }, pairs.map((p, i) => h('li', {},
        `${answers[i] ? '🟩' : '🟥'} ${p.a.emoji} ${p.a.text} (${formatValue(p.a.value)}) vs ${p.b.emoji} ${p.b.text} (${formatValue(p.b.value)})`)))));
}

// ---------- other screens ----------
function leaderboard() {
  setKeys(null);
  const history = Object.entries(load(DAILY_HISTORY_KEY, {}) || {}).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  mount(
    h('h1', { class: 'screen-title' }, 'Leaderboard'),
    h('p', { class: 'lede' }, 'Your records on this device. PERCENTO has no accounts and stores nothing online.'),
    h('section', { class: 'box' }, h('h2', {}, 'Best Endless runs'), leaderboardList(10)),
    h('section', { class: 'box', style: 'margin-top:16px' }, h('h2', {}, 'Daily Challenge history'),
      history.length
        ? h('ol', { class: 'board' }, history.slice(0, 14).map(([d, s]) => h('li', {},
          h('span', { class: 'rank' }, '📅'), h('span', {}, ''), h('span', { class: 'who' }, d), h('span', { class: 'score' }, `${s}/10`))))
        : h('p', { class: 'board-empty' }, 'No Daily Challenge played yet.')),
    h('div', { class: 'actions' }, h('a', { class: 'btn btn-primary', href: '#/' }, 'Play Endless'), h('a', { class: 'btn', href: '#/daily' }, 'Daily Challenge')));
}

function sources(focusCategory) {
  setKeys(null);
  const byCat = CATEGORY_IDS.map((c) => [c, ENTRIES.filter((e) => e.category === c).sort((a, b) => a.text.localeCompare(b.text))]).filter(([, l]) => l.length);
  mount(
    h('h1', { class: 'screen-title' }, 'Sources'),
    h('p', { class: 'lede' }, `All ${ENTRIES.length} statistics in the game, each from a statistics office, an international agency, a space agency, a major survey or a peer-reviewed study.`),
    byCat.map(([c, list]) => h('section', { class: 'source-group', id: `cat-${c}` },
      h('h2', {}, `${CATEGORIES[c].emoji} ${CATEGORIES[c].label} (${list.length})`),
      h('ul', { class: 'source-list' }, list.map((e) => h('li', {},
        `${e.emoji} ${e.text} `, h('strong', {}, formatValue(e.value)),
        h('span', { class: 'source-detail' }, e.detail, ' · ', h('a', { href: e.sourceUrl, target: '_blank', rel: 'noopener' }, e.source), ` · ${e.year}`,
          e.status === 'unverified' ? h('span', { class: 'badge' }, 'unverified') : null)))))));
  if (focusCategory) document.getElementById(`cat-${focusCategory}`)?.scrollIntoView();
}

function settings() {
  setKeys(null);
  const reduce = () => document.documentElement.classList.contains('reduce-motion');
  const motionBtn = h('button', { class: 'btn switch', type: 'button', 'aria-pressed': String(reduce()), onclick: () => {
    const on = !reduce();
    document.documentElement.classList.toggle('reduce-motion', on);
    save(MOTION_KEY, on);
    motionBtn.setAttribute('aria-pressed', String(on));
    motionBtn.textContent = on ? 'On' : 'Off';
  } }, reduce() ? 'On' : 'Off');
  mount(
    h('h1', { class: 'screen-title' }, 'Settings'),
    h('section', { class: 'box' },
      h('div', { class: 'setting' }, h('p', {}, 'Reduce motion', h('small', {}, 'The Percentometer jumps straight to the answer.')), motionBtn),
      h('div', { class: 'setting' }, h('p', {}, 'Reset my records', h('small', {}, 'Clears personal best and the local leaderboard.')),
        h('button', { class: 'btn', type: 'button', onclick: () => {
          save(BEST_KEY, 0); save(RUNS_KEY, []); renderPanel(); toast('Records cleared.');
        } }, 'Reset')),
      h('div', { class: 'setting' }, h('p', {}, 'About the numbers', h('small', {}, `${TAGLINE} Every number is real; the pairings are absurd on purpose.`)),
        h('a', { class: 'btn', href: '#/sources' }, 'Sources'))));
}

function review() {
  setKeys(null);
  if (BUILD.mode !== 'dev') return startEndless();
  const list = ENTRIES.filter((e) => e.status === 'unverified');
  mount(
    h('h1', { class: 'screen-title' }, 'Review mode'),
    h('p', { class: 'lede' }, `Test build: ${list.length} unverified of ${ENTRIES.length} statistics. The public version serves verified statistics only.`),
    h('ul', { class: 'source-list' }, list.map((e) => h('li', {},
      `[${e.id}] ${e.text} `, h('strong', {}, formatValue(e.value)),
      h('span', { class: 'source-detail' }, e.detail, ' · ', h('a', { href: e.sourceUrl, target: '_blank', rel: 'noopener' }, e.source), ` · ${e.year} · ${e.reviewReason}`)))));
}

// ---------- router ----------
const ROUTES = {
  '': ['play', startEndless], '#/': ['play', startEndless], '#/endless': ['play', startEndless],
  '#/daily': ['daily', startDaily], '#/leaderboard': ['leaderboard', leaderboard],
  '#/sources': ['sources', () => sources()], '#/settings': ['settings', settings], '#/review': ['sources', review],
};

function route() {
  for (const fn of cleanup) fn();
  cleanup = [];
  const hash = location.hash;
  let entry = ROUTES[hash];
  if (!entry && hash.startsWith('#/sources/')) entry = ['sources', () => sources(hash.slice(10))];
  entry ||= ROUTES[''];
  for (const a of document.querySelectorAll('.nav a')) {
    const active = a.dataset.route === entry[0];
    a.classList.toggle('active', active);
    if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  renderPanel();
  entry[1]();
}

if (load(MOTION_KEY, false)) document.documentElement.classList.add('reduce-motion');
for (const btn of document.querySelectorAll('[data-invite]')) btn.addEventListener('click', invite);
window.addEventListener('hashchange', route);
route();
