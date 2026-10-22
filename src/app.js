// PERCENTO app: routing, screens, side panel and the round engine shared by both modes.
import { ENTRIES, BUILD } from './data.js';
import { CATEGORIES, CATEGORY_IDS, RULES } from './config.js';
import { createPairGenerator, higherOf, mulberry32, hashString, pairKey, pickCards } from './pairs.js';
import {
  DAILY_GUESS_CARDS, dailyPairs, dailyGuessCards, romeDate, msUntilNextDaily, formatCountdown, currentStreak, longestStreak,
} from './daily.js';
import { createDial } from './dial.js';
import { icon } from './icons.js';
import * as audio from './audio.js';
import * as online from './online.js';
import { t, cardText, cardDetail, formatPercent, getLang, LANGS, setLang, initI18n } from './i18n.js';
import { load, save, storageAvailable } from './storage.js';
import { shareResult, shareText } from './share.js';
import {
  TAGLINE, INSTRUCTION, HEADLINES, RIGHT_QUIPS, WRONG_QUIPS, GAME_OVER_LINES, DAILY_END_LINES, pickByScore,
} from './copy.js';

const BEST_KEY = 'percento:best';
const catBestKey = (cat) => `percento:best:${cat}`;
const RUNS_KEY = 'percento:runs';
const DAILY_HISTORY_KEY = 'percento:dailyHistory';
const DAILY_GUESS_HISTORY_KEY = 'percento:dailyGuessHistory';
const dailyGuessKey = (date) => `percento:dailyGuess:${date}`;
const MOTION_KEY = 'percento:reduceMotion';
const TITLE = 'Which percentage is higher?';
const dailyKey = (date) => `percento:daily3:${date}`;
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

export const formatValue = (v) => formatPercent(v);
const formatReading = (reading, target) => formatPercent(Number.isInteger(target) ? Math.round(reading) : reading, Number.isInteger(target) ? 0 : 1);
const pickFrom = (list, rng = Math.random) => list[Math.floor(rng() * list.length)];
const colorOf = (e) => CATEGORIES[e.category].color;
const catLabel = (c) => t(CATEGORIES[c].label);
/** A translated sentence with elements inside: tx('Better than {pct} …', { pct: node }). */
function tx(text, nodes, vars = {}) {
  const str = t(text, vars);
  const out = [];
  let last = 0;
  str.replace(/\{(\w+)\}/g, (m, k, off) => { out.push(str.slice(last, off), nodes[k] ?? m); last = off + m.length; return m; });
  out.push(str.slice(last));
  return out;
}
const shareUrl = () => `${location.origin}${location.pathname}`;

function toast(message) {
  const region = document.getElementById('toast');
  region.textContent = t(message);
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
  if (BUILD.mode === 'dev') nodes.unshift(h('p', { class: 'dev-banner' }, t('Test build with unverified statistics.'), ' ', h('a', { href: '#/review' }, t('Review mode'))));
  app.replaceChildren(...nodes);
  const heading = app.querySelector('.screen-title');
  heading?.setAttribute('tabindex', '-1');
  heading?.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

const playable = (pool, sameCategory = false) => pool.length >= 2 && createPairGenerator(pool, mulberry32(1), { sameCategory }).next() !== null;

function calibrating() {
  mount(h('h1', { class: 'screen-title' }, t('The Percentometer is calibrating')),
    h('p', { class: 'lede' }, t('There are not enough verified statistics to play this yet. Every number has to be checked against its official source first.')),
    h('div', { class: 'actions' }, h('a', { class: 'btn btn-primary', href: '#/' }, t('Play Endless'))));
}

// ---------- local leaderboard ----------
function recordRun(score) {
  online.recordRun(score).catch(() => {});
  const runs = load(RUNS_KEY, []) || [];
  runs.push({ score, date: new Date().toISOString().slice(0, 10) });
  runs.sort((a, b) => b.score - a.score);
  save(RUNS_KEY, runs.slice(0, 10));
}

function leaderboardList(limit, highlightIndex = -1) {
  const runs = (load(RUNS_KEY, []) || []).slice(0, limit);
  if (!runs.length) return h('p', { class: 'board-empty' }, t('No runs yet. Play Endless to set your first record.'));
  return h('ol', { class: 'board' }, runs.map((r, i) => h('li', { class: i === highlightIndex ? 'me' : '' },
    h('span', { class: `rank rank-${i + 1}` }, String(i + 1)),
    h('span', { 'aria-hidden': 'true' }, i < 3 ? '👑' : '•'),
    h('span', { class: 'who' }, i === highlightIndex ? t('This run') : t('You'), h('small', {}, r.date)),
    h('span', { class: 'score' }, String(r.score)))));
}

// ---------- side panel ----------
function boardList(rows, me) {
  if (!rows.length) return h('p', { class: 'board-empty' }, t('Nobody on the board yet. Be the first!'));
  return h('ol', { class: 'board' }, rows.map((r, i) => h('li', { class: r.username === me ? 'me' : '' },
    h('span', { class: `rank rank-${i + 1}` }, String(i + 1)),
    h('span', { 'aria-hidden': 'true' }, i < 3 ? '👑' : '•'),
    h('span', { class: 'who' }, r.username, r.note ? h('small', {}, r.note) : null),
    h('span', { class: 'score' }, String(r.score)))));
}

/** Fills `box` with the world top players, or this device's runs when offline. */
async function worldBoard(box, limit) {
  const rows = online.isOnline() ? await online.topPlayers(limit).catch(() => null) : null;
  if (!box.isConnected) return;
  if (!rows) {
    box.replaceChildren(h('h2', {}, t('Leaderboard'), ' ', h('small', {}, t('(this device)'))), leaderboardList(limit));
    return;
  }
  box.replaceChildren(h('h2', {}, t('World leaderboard')),
    boardList(rows.map((r) => ({ username: r.username, score: r.best })), online.currentUser()?.username));
}

function renderPanel() {
  const board = h('section', { class: 'box' }, h('h2', {}, t('Leaderboard')), leaderboardList(5));
  panel.replaceChildren(
    board,
    h('section', { class: 'box friends' },
      icon('globe', 'icon icon-big'),
      h('h2', {}, t('Play online')),
      h('p', { class: 'muted' }, t('Strangers or friends, up to 10 players. Last one standing, or closest guess over 10 cards.')),
      h('a', { class: 'btn btn-primary', href: '#/online' }, t('Find a game'))));
  online.init().then(() => worldBoard(board, 5));
}

// ---------- what everybody answered ----------
const CROWD_MIN_PLAYS = 3;
/** Resolves to the value of `promise`, or null after `ms`. */
const within = (promise, ms) => Promise.race([promise.catch(() => null), new Promise((res) => setTimeout(() => res(null), ms))]);

function pairCrowdLine(stats) {
  if (!stats) return null;
  if (stats.plays < CROWD_MIN_PLAYS) return h('p', { class: 'crowd' }, t('You are one of the first players to see this pair.'));
  const pct = Math.round((100 * stats.hits) / stats.plays);
  return h('p', { class: 'crowd' }, ...tx(pct < 40 ? '{pct} of players got this one right (a tricky one!).' : '{pct} of players got this one right.', { pct: h('b', {}, formatPercent(pct)) }));
}

function guessCrowdLine(stats) {
  if (!stats) return null;
  if (stats.plays < CROWD_MIN_PLAYS) return h('p', { class: 'crowd' }, t('You are one of the first players to guess this card.'));
  const avg = stats.guess_sum / stats.plays;
  const miss = stats.miss_sum / stats.plays;
  return h('p', { class: 'crowd' }, ...tx('Players guess {avg} on average, usually {miss} points off.', { avg: h('b', {}, formatPercent(Math.round(avg))), miss: h('b', {}, String(Math.round(miss))) }));
}

// ---------- the round ----------
/**
 * Renders one pair. Options: pair, headline, pill {value, label}, progress (node),
 * onAnswer(correct), onContinue(correct), continueLabel, timeLimit (ms, optional).
 * A right answer moves on by itself; a wrong one waits for the button so the
 * player can read the sources. Running out of time counts as wrong.
 */
function renderRound({ pair, headline, pill, progress, onAnswer, onContinue, continueLabel = t('Continue'), timeLimit = 0 }) {
  const dial = createDial();
  const cards = { a: pair.a, b: pair.b };
  let phase = 'ask';
  let correct = false;
  const dom = {};

  // Cells of the 10×10 grid, filled from the bottom row up like a tank.
  const fillOrder = Array.from({ length: 100 }, (_, i) => (9 - Math.floor(i / 10)) * 10 + (i % 10));

  const card = (id) => {
    const e = cards[id];
    const cat = CATEGORIES[e.category];
    const value = h('span', { class: 'card-value' }, '?');
    const cells = Array.from({ length: 100 }, () => h('i'));
    let filled = 0;
    const fill = (reading) => {
      const n = Math.round(reading);
      for (let i = Math.min(n, filled); i < Math.max(n, filled); i++) cells[fillOrder[i]].classList.toggle('on', i < n);
      filled = n;
    };
    const pick = h('button', {
      class: 'card-pick',
      type: 'button',
      'aria-label': t(id === 'a' ? 'Left card: {text}, {detail}. Pick as higher.' : 'Right card: {text}, {detail}. Pick as higher.', { text: cardText(e), detail: cardDetail(e) }),
      onclick: () => choose(id),
    },
    h('span', { class: 'card-top' }, h('span', { class: 'card-cat' }, icon(e.category), catLabel(e.category)), h('span', { class: 'card-side', 'aria-hidden': 'true' }, id === 'a' ? 'L' : 'R')),
    h('span', { class: 'card-text' }, cardText(e)),
    h('span', { class: 'card-detail' }, cardDetail(e)),
    h('span', { class: 'card-foot' }, h('span', { class: 'waffle', 'aria-hidden': 'true' }, cells), value),
    h('span', { class: 'stamp', 'aria-hidden': 'true' }, t('Higher')));
    const source = h('p', { class: 'card-source', hidden: true },
      t('Source:'), ' ', h('a', { href: e.sourceUrl, target: '_blank', rel: 'noopener' }, e.source), ` · ${e.year}`);
    const wrap = h('div', { class: `card card-${id}`, style: `--c:${colorOf(e)}` }, pick, source);
    const answer = h('button', { class: 'answer', type: 'button', onclick: () => choose(id) },
      id === 'a' ? t('← Left') : t('Right →'), h('small', {}, id === 'a' ? t('key 1') : t('key 2')));
    dom[id] = { wrap, pick, value, source, answer, fill };
    return wrap;
  };

  const feedback = h('p', { class: 'feedback', role: 'status', 'aria-live': 'polite' }, t('Pick a card. The Percentometer will reveal the truth.'));
  const next = h('button', { class: 'btn btn-primary continue', type: 'button', hidden: true, onclick: () => advance() }, continueLabel);
  const clock = timeLimit ? h('div', { class: 'round-timer', role: 'timer', 'aria-label': t('Time left') },
    h('span', { class: 'round-timer-bar', style: `--t:${timeLimit}ms` }), h('b', {}, String(Math.ceil(timeLimit / 1000)))) : null;
  const duel = h('div', { class: 'duel' }, card('a'), h('div', { class: 'vs', 'aria-hidden': 'true' }, t('or')), card('b'));
  dial.el.style.setProperty('--ca', colorOf(pair.a));
  // Same-category pairs keep the right pin in paper so the two stay apart.
  if (colorOf(pair.b) !== colorOf(pair.a)) dial.el.style.setProperty('--cb', colorOf(pair.b));

  mount(
    h('header', { class: 'round-head' },
      h('div', {}, h('p', { class: 'kicker' }, headline), h('h1', { class: 'screen-title' }, t(TITLE)), h('p', { class: 'sub' }, t(INSTRUCTION))),
      pill ? h('div', { class: 'pill' }, icon('bolt', 'icon bolt'), h('span', {}, h('b', {}, String(pill.value)), h('small', {}, pill.label))) : null),
    clock,
    duel,
    h('div', { class: 'answers' }, dom.a.answer, dom.b.answer),
    h('div', { class: 'reveal' }, dial.el, h('div', { class: 'reveal-side' }, feedback, next)),
    progress);

  dial.describe(t('Percentometer, waiting for your pick'));

  let countdown = null;
  if (timeLimit) {
    const deadline = Date.now() + timeLimit;
    countdown = setInterval(() => {
      const left = deadline - Date.now();
      const secs = Math.max(0, Math.ceil(left / 1000));
      if (secs <= 5 && secs > 0 && clock.querySelector('b').textContent !== String(secs)) audio.sfx('hurry');
      clock.querySelector('b').textContent = String(secs);
      clock.classList.toggle('hurry', left <= 5000);
      if (left <= 0) choose(null);
    }, 200);
    cleanup.push(() => clearInterval(countdown));
  }

  // id is null when the clock runs out.
  async function choose(id) {
    if (phase !== 'ask') return;
    phase = 'reveal';
    clearInterval(countdown);
    clock?.classList.add('stopped');
    correct = id !== null && cards[id].value > cards[id === 'a' ? 'b' : 'a'].value;
    audio.sfx(id ? 'tap' : 'timeout');
    onAnswer?.(correct);
    // Ask what everybody else answered while the Percentometer swings.
    const key = pairKey(pair.a, pair.b);
    const crowd = online.answerStats(key).catch(() => null);
    for (const k of ['a', 'b']) { dom[k].pick.disabled = true; dom[k].answer.disabled = true; }
    if (id) dom[id].wrap.classList.add('chosen');
    feedback.textContent = id ? t('Measuring…') : t('⏱ Time is up! Measuring…');
    const swings = [];
    for (const k of ['a', 'b']) {
      const target = cards[k].value;
      let lastTick = 0;
      swings.push(dial.swing(k, target, (r) => {
        dom[k].value.textContent = formatReading(r, target);
        dom[k].answer.textContent = formatReading(r, target);
        dom[k].fill(r);
        if (k === 'a' && Math.abs(r - lastTick) >= 8) { lastTick = r; audio.sfx('tick'); }
      }));
    }
    await Promise.all(swings);
    const high = higherOf(pair) === pair.a ? 'a' : 'b';
    for (const k of ['a', 'b']) {
      dom[k].value.textContent = formatValue(cards[k].value);
      dom[k].answer.textContent = formatValue(cards[k].value);
      dom[k].answer.classList.add(k === high ? 'win' : 'lose');
      dom[k].fill(cards[k].value);
      dom[k].source.hidden = false;
    }
    dom[high].wrap.classList.add('higher');
    dom[high === 'a' ? 'b' : 'a'].wrap.classList.add('lower');
    dial.describe(t('Percentometer: left card {a}, right card {b}', { a: formatValue(pair.a.value), b: formatValue(pair.b.value) }));
    feedback.className = `feedback ${correct ? 'ok' : 'ko'}`;
    audio.sfx(correct ? 'right' : 'wrong');
    within(crowd, 900).then((stats) => {
      const line = pairCrowdLine(stats);
      if (line && feedback.isConnected) feedback.after(line);
      if (id) online.recordPair(key, correct).catch(() => {});
    });
    feedback.textContent = id ? `${correct ? '✓' : '✗'} ${t(pickFrom(correct ? RIGHT_QUIPS : WRONG_QUIPS))}` : t('⏱ Time is up! 15 seconds per card.');
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

// ---------- home ----------
const MIN_CATEGORY_CARDS = 12;
const categoryPool = (cat) => ENTRIES.filter((e) => e.category === cat);

function home() {
  setKeys(null);
  const best = load(BEST_KEY, 0) || 0;
  const cats = CATEGORY_IDS.filter((c) => categoryPool(c).length >= MIN_CATEGORY_CARDS);
  mount(
    h('section', { class: 'hero' },
      h('p', { class: 'kicker' }, t(TAGLINE)),
      h('h1', { class: 'screen-title' }, t('Two numbers.'), ' ', h('span', {}, t('One is higher.'))),
      h('p', { class: 'lede' }, t('Real statistics about things that have nothing in common. Pick the bigger percentage and keep your streak alive.')),
      h('div', { class: 'actions' },
        h('a', { class: 'btn btn-primary btn-big', href: '#/endless' }, t('Play mixed')),
        h('a', { class: 'btn', href: '#/guess' }, t('Closest guess')),
        h('a', { class: 'btn', href: '#/online' }, icon('globe'), t('Play online')),
        h('a', { class: 'btn', href: '#/daily' }, t('Daily challenge'))),
      h('p', { class: 'hero-meta' },
        streak().current ? h('a', { class: 'streak-chip', href: '#/daily' }, `🔥 ${t('{n}-day streak', { n: streak().current })}`) : null,
        h('span', {}, t('Best streak {n}', { n: best })), h('span', {}, t('{n} statistics', { n: ENTRIES.length })), h('span', {}, t('{n} categories', { n: cats.length })))),
    cats.length ? categorySection(cats) : null);
}

// Category tiles, for either game: "higher or lower" or "closest guess".
function categorySection(cats) {
  const KEY = 'percento:homeMode';
  const grid = h('ul', { class: 'cat-grid' });
  const note = h('p', { class: 'muted' });
  const buttons = [['endless', t('Higher or lower')], ['guess', t('Closest guess')]].map(([id, label]) =>
    h('button', { class: 'seg', type: 'button', 'data-mode': id, onclick: () => show(id) }, label));
  const show = (mode) => {
    save(KEY, mode);
    for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
    note.textContent = mode === 'guess' ? t('Ten cards from one topic. Guess each percentage.') : t('Every pair from one topic. Harder than it looks.');
    grid.replaceChildren(...cats.map((c) => h('li', {},
      h('a', { class: 'cat-tile', href: `#/${mode}/${c}`, style: `--c:${CATEGORIES[c].color}` },
        icon(c), h('strong', {}, catLabel(c)),
        h('small', {}, t('{n} stats · best {best}', { n: categoryPool(c).length, best: load(mode === 'guess' ? guessBestKey(c) : catBestKey(c), 0) || 0 }))))));
  };
  show(load(KEY, 'endless') === 'guess' ? 'guess' : 'endless');
  return h('section', { class: 'cat-section' },
    h('div', { class: 'section-head' }, h('h2', {}, t('Play by category')), h('div', { class: 'segmented', role: 'group', 'aria-label': t('Game for the categories') }, buttons)),
    note, grid);
}

// ---------- endless ----------
// One generator per mode and page session, so pairs never repeat across runs either.
const sessionGens = new Map();

function startEndless(cat = null) {
  const pool = cat ? categoryPool(cat) : ENTRIES;
  if (!playable(pool, Boolean(cat))) return calibrating();
  if (!sessionGens.has(cat)) sessionGens.set(cat, createPairGenerator(pool, Math.random, { sameCategory: Boolean(cat) }));
  const gen = sessionGens.get(cat);
  const key = cat ? catBestKey(cat) : BEST_KEY;
  const label = cat ? catLabel(cat) : t('Mixed');
  let score = 0;
  let best = load(key, 0) || 0;

  const round = () => {
    const pair = gen.next();
    if (!pair) return endlessOver({ cat, score, best, exhausted: true });
    renderRound({
      pair,
      headline: cat ? `${t('{category} only', { category: label })} · ${t(pickFrom(HEADLINES))}` : t(pickFrom(HEADLINES)),
      pill: { value: score, label: t('Streak · best {n}', { n: best }) },
      progress: h('div', { class: 'progress' }, h('span', {}, `${label} · ${t('score {n}', { n: score })}`), h('span', {}, t('Personal best {n}', { n: best }))),
      onContinue: (correct) => {
        if (!correct) return endlessOver({ cat, score, best, exhausted: false });
        score++;
        if (score > best) { best = score; save(key, best); }
        round();
      },
    });
  };
  round();
}

function endlessOver({ cat, score, best, exhausted }) {
  // The world board and the device top 10 rank mixed play only.
  if (!cat) recordRun(score);
  renderPanel();
  const runs = load(RUNS_KEY, []) || [];
  const myIndex = cat ? -1 : runs.findIndex((r) => r.score === score);
  const again = () => startEndless(cat);
  setKeys((ev) => { if (ev.key === 'Enter') { ev.preventDefault(); again(); } });
  const newBest = score > 0 && score >= best;
  audio.sfx(newBest ? 'win' : 'gameover');
  mount(
    h('p', { class: 'kicker' }, cat ? t('{category} only', { category: catLabel(cat) }) : t('Mixed')),
    h('h1', { class: 'screen-title' }, exhausted ? t('You ran out of statistics!') : t('Game over')),
    h('p', { class: 'big-score' }, h('span', {}, String(score)), h('small', {}, score === 1 ? t('correct answer') : t('correct answers'))),
    h('p', { class: 'lede' }, exhausted ? t('Every pair has been played. The Percentometer needs a nap.') : t(pickByScore(GAME_OVER_LINES, score, Math.floor(Math.random() * 2)))),
    h('p', { class: 'muted' }, newBest ? t('New personal best: {n}!', { n: best }) : t('Personal best: {n}', { n: best })),
    storageAvailable() ? null : h('p', { class: 'note' }, t('Your browser blocks storage, so your scores last only until you close this tab.')),
    h('div', { class: 'actions' },
      h('button', { class: 'btn btn-primary', type: 'button', onclick: again }, t('Play again')),
      h('a', { class: 'btn', href: '#/' }, cat ? t('Other categories') : t('Play by category')),
      h('a', { class: 'btn', href: '#/online' }, t('Play online'))),
    cat ? null : h('section', { class: 'box' }, h('h2', {}, t('Your best runs')), leaderboardList(5, myIndex)));
}

// ---------- closest guess ----------
// One card per round; set the percentage you think it is. 100 points for a
// bull's-eye, 3 fewer for every point off. Solo here, online in room().
const GUESS_ROUNDS = 10;
const GUESS_TIME_MS = 15000;
const guessPoints = (guess, value) => Math.max(0, Math.round(100 - 3 * Math.abs(guess - value)));
const guessBestKey = (cat) => (cat ? `percento:guessBest:${cat}` : 'percento:guessBest');

// Labels near the ends of the ruler lean inwards so they stay on screen.
const edge = (v) => (v < 8 ? ' edge-l' : v > 92 ? ' edge-r' : '');
const FILL_ORDER = Array.from({ length: 100 }, (_, i) => (9 - Math.floor(i / 10)) * 10 + (i % 10));

/**
 * Renders one guessing round and returns a controller:
 *   reveal({ pins: [{ name, guess, me }], message }) → Promise (animates the truth in)
 * Options: entry, headline, pill, progress, deadline (local ms), onLock(guess, touched).
 * The guess locks with the button, Enter, or by itself when the clock runs out.
 */
function renderGuess({ entry, headline, pill, progress, deadline, onLock }) {
  const color = colorOf(entry);
  let guess = 50;
  let touched = false;
  let locked = false;
  const cells = Array.from({ length: 100 }, () => h('i'));
  const paint = (cls, n) => FILL_ORDER.forEach((c, k) => cells[c].classList.toggle(cls, k < n));
  const value = h('span', { class: 'card-value' }, '?');
  const readout = h('output', { class: 'guess-readout', 'aria-live': 'off' }, '50', h('small', {}, '%'));
  const slider = h('input', { class: 'guess-slider', type: 'range', min: 0, max: 100, step: 1, value: 50, 'aria-label': t('Your guess for: {text}', { text: cardText(entry) }) });
  const set = (v) => {
    guess = Math.max(0, Math.min(100, Math.round(v)));
    touched = true;
    slider.value = String(guess);
    readout.firstChild.textContent = String(guess);
    slider.style.setProperty('--p', `${guess}%`);
    paint('g', guess);
  };
  slider.addEventListener('input', () => set(Number(slider.value)));
  const nudge = (d) => h('button', { class: 'btn nudge', type: 'button', 'aria-label': t(d > 0 ? 'Up one point' : 'Down one point'), onclick: () => !locked && set(guess + d) }, d > 0 ? '+' : '−');
  const lockBtn = h('button', { class: 'btn btn-primary lock', type: 'button', onclick: () => lock() }, t('Lock in'));
  const status = h('p', { class: 'guess-status', role: 'status', 'aria-live': 'polite' }, t('Drag to set your percentage, then lock it in.'));
  const clockB = h('b', {}, '15');
  const clock = h('div', { class: 'round-timer', role: 'timer', 'aria-label': t('Time left') },
    h('span', { class: 'round-timer-bar', style: `--t:${Math.max(0, deadline - Date.now())}ms` }), clockB);
  const ruler = h('div', { class: 'guess-ruler', hidden: true, 'aria-hidden': 'true' });
  const card = h('div', { class: 'card guess-card', style: `--c:${color}` },
    h('div', { class: 'card-pick' },
      h('span', { class: 'card-top' }, h('span', { class: 'card-cat' }, icon(entry.category), catLabel(entry.category)), h('span', { class: 'card-side' }, t('How much?'))),
      h('span', { class: 'card-text' }, cardText(entry)),
      h('span', { class: 'card-detail' }, cardDetail(entry)),
      h('span', { class: 'card-foot' }, h('span', { class: 'waffle', 'aria-hidden': 'true' }, cells), value)),
    h('p', { class: 'card-source', hidden: true }, t('Source:'), ' ', h('a', { href: entry.sourceUrl, target: '_blank', rel: 'noopener' }, entry.source), ` · ${entry.year}`));
  const controls = h('div', { class: 'guess-controls' }, readout, slider,
    h('div', { class: 'guess-buttons' }, nudge(-1), nudge(+1), lockBtn));

  mount(
    h('header', { class: 'round-head' },
      h('div', {}, h('p', { class: 'kicker' }, headline), h('h1', { class: 'screen-title' }, t('Guess the percentage')), h('p', { class: 'sub' }, t('Closest wins. 15 seconds.'))),
      pill ? h('div', { class: 'pill' }, icon('bolt', 'icon bolt'), h('span', {}, h('b', {}, String(pill.value)), h('small', {}, pill.label))) : null),
    clock,
    h('div', { class: 'guess-stage' }, card, h('div', { class: 'guess-side' }, controls, status, ruler)),
    progress);
  slider.style.setProperty('--p', '50%');
  paint('g', 50);
  touched = false;

  let lastSec = null;
  const timer = setInterval(() => {
    const left = deadline - Date.now();
    const secs = Math.max(0, Math.ceil(left / 1000));
    if (secs !== lastSec) {
      if (secs <= 5 && secs > 0 && !locked) audio.sfx('hurry');
      clockB.textContent = String(secs);
      lastSec = secs;
    }
    clock.classList.toggle('hurry', left <= 5000);
    // Lock a moment early so the guess reaches the server before its clock stops.
    if (left <= 300 && !locked) lock(true);
  }, 100);
  cleanup.push(() => clearInterval(timer));

  function lock(auto = false) {
    if (locked) return;
    locked = true;
    slider.disabled = true;
    for (const b of controls.querySelectorAll('button')) b.disabled = true;
    audio.sfx(auto ? 'timeout' : 'tap');
    status.textContent = touched ? t('Locked in at {guess}. Waiting for the reveal…', { guess: formatPercent(guess) }) : t('Time is up: no guess this round.');
    crowd = online.answerStats(entry.id).catch(() => null);
    onLock?.(guess, touched);
  }
  let crowd = Promise.resolve(null);

  setKeys((ev) => {
    if (locked) return;
    if (ev.key === 'Enter') { ev.preventDefault(); lock(); }
    else if (ev.target !== slider && (ev.key === 'ArrowRight' || ev.key === 'ArrowUp')) { ev.preventDefault(); set(guess + 1); }
    else if (ev.target !== slider && (ev.key === 'ArrowLeft' || ev.key === 'ArrowDown')) { ev.preventDefault(); set(guess - 1); }
  });

  return {
    get locked() { return locked; },
    lock,
    /** Shows the true value, every guess on a ruler and a message. */
    async reveal({ pins, message }) {
      lock(true);
      clearInterval(timer);
      clock.classList.add('stopped');
      paint('g', 0);
      const truth = entry.value;
      const dial = createDial();
      await dial.swing('a', truth, (r) => { value.textContent = formatReading(r, truth); paint('on', Math.round(r)); });
      value.textContent = formatValue(truth);
      paint('on', Math.round(truth));
      card.querySelector('.card-source').hidden = false;
      card.classList.add('revealed');
      ruler.hidden = false;
      ruler.replaceChildren(
        h('span', { class: `pin truth${edge(truth)}`, style: `left:${truth}%` }, h('b', {}, formatValue(truth))),
        ...pins.filter((p) => p.guess !== null).map((p, k) => h('span', { class: `pin${p.me ? ' me' : ''}${k % 2 ? ' low' : ''}${edge(p.guess)}`, style: `left:${p.guess}%` },
          h('b', {}, p.name), h('small', {}, formatPercent(p.guess)))));
      status.textContent = message;
      status.classList.add('done');
      const line = guessCrowdLine(await within(crowd, 900));
      if (line && status.isConnected) status.after(line);
      if (touched) online.recordGuess(entry.id, guess, Math.round(Math.abs(guess - truth) * 10) / 10).catch(() => {});
    },
  };
}

function startGuess(cat = null) {
  const pool = cat ? categoryPool(cat) : ENTRIES;
  if (pool.length < 2) return calibrating();
  const cards = pickCards(pool, Math.random, GUESS_ROUNDS);
  const label = cat ? catLabel(cat) : t('Mixed');
  const results = [];
  let total = 0;

  const dots = (i) => h('span', { class: 'dots', 'aria-hidden': 'true' },
    cards.map((_, k) => h('span', { class: k < results.length ? (results[k].points >= 70 ? 'ok' : results[k].points > 0 ? 'mid' : 'ko') : (k === i ? 'now' : '') })));

  const round = (i) => {
    if (i >= cards.length) return guessOver({ cat, total, results });
    const entry = cards[i];
    let ctl = null;
    ctl = renderGuess({
      entry,
      headline: `${t('Closest guess')} · ${label} · ${t('card {i} of {n}', { i: i + 1, n: cards.length })}`,
      pill: { value: total, label: t('Points') },
      progress: h('div', { class: 'progress' }, h('span', { class: 'status' }, t('Card {i} of {n}', { i: i + 1, n: cards.length })), dots(i)),
      deadline: Date.now() + GUESS_TIME_MS,
      onLock: (guess, touched) => {
        const points = touched ? guessPoints(guess, entry.value) : 0;
        total += points;
        results.push({ entry, guess: touched ? guess : null, points });
        // Let the lock sound land before the reveal starts.
        setTimeout(async () => {
          const off = touched ? Math.abs(guess - entry.value) : null;
          await ctl.reveal({
            pins: touched ? [{ name: t('You'), guess, me: true }] : [],
            message: off === null ? t('No guess, no points.') : off < 0.5 ? t("Bull's-eye! +{points}", { points }) : t('{off} points off · +{points}', { off: Number.isInteger(off) ? off : off.toFixed(1), points }),
          });
          audio.sfx(points >= 70 ? 'right' : points > 0 ? 'tick' : 'wrong');
          const next = h('button', { class: 'btn btn-primary continue', type: 'button', onclick: () => go() }, i === cards.length - 1 ? t('See results') : t('Next card'));
          app.querySelector('.guess-side').append(next);
          next.focus({ preventScroll: true });
          let gone = false;
          const go = () => { if (!gone) { gone = true; round(i + 1); } };
          const auto = setTimeout(go, 4000);
          cleanup.push(() => clearTimeout(auto));
          setKeys((ev) => { if (ev.key === 'Enter') { ev.preventDefault(); go(); } });
        }, 250);
      },
    });
  };
  round(0);
}

function guessOver({ cat, total, results }) {
  const key = guessBestKey(cat);
  const best = load(key, 0) || 0;
  const newBest = total > best;
  if (newBest) save(key, total);
  audio.sfx(newBest ? 'win' : 'gameover');
  setKeys((ev) => { if (ev.key === 'Enter') { ev.preventDefault(); startGuess(cat); } });
  mount(
    h('p', { class: 'kicker' }, `${t('Closest guess')} · ${cat ? catLabel(cat) : t('Mixed')}`),
    h('h1', { class: 'screen-title' }, total >= 800 ? t('Human calculator.') : total >= 550 ? t('Sharp eye.') : total >= 300 ? t('Not bad at all.') : t('The numbers fooled you.')),
    h('p', { class: 'big-score' }, h('span', {}, String(total)), h('small', {}, t('of {n} points', { n: results.length * 100 }))),
    h('p', { class: 'muted' }, newBest ? t('New personal best: {n}!', { n: total }) : t('Personal best: {n}', { n: Math.max(best, total) })),
    h('div', { class: 'actions' },
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => startGuess(cat) }, t('Play again')),
      h('a', { class: 'btn', href: '#/online' }, t('Guess against friends')),
      h('a', { class: 'btn', href: '#/' }, t('Home'))),
    h('section', { class: 'box' }, h('h2', {}, t('Your guesses')),
      h('ol', { class: 'board guess-recap' }, results.map((r, k) => h('li', {},
        h('span', { class: 'rank' }, String(k + 1)), h('span', {}, ''),
        h('span', { class: 'who' }, cardText(r.entry), h('small', {}, r.guess === null ? t('no guess · real {value}', { value: formatValue(r.entry.value) }) : t('you {guess} · real {value}', { guess: formatPercent(r.guess), value: formatValue(r.entry.value) }))),
        h('span', { class: 'score' }, `+${r.points}`))))));
}

// ---------- daily ----------
// ---------- daily habit: streaks, tabs, everybody's scores ----------
function playedDays() {
  return [...Object.keys(load(DAILY_HISTORY_KEY, {}) || {}), ...Object.keys(load(DAILY_GUESS_HISTORY_KEY, {}) || {})];
}
const streak = () => ({ current: currentStreak(playedDays(), romeDate()), best: longestStreak(playedDays()) });

function streakBox() {
  const { current, best } = streak();
  return h('div', { class: 'streak' },
    h('span', { class: 'streak-flame', 'aria-hidden': 'true' }, '🔥'),
    h('p', {}, h('b', {}, String(current)), h('small', {}, current === 1 ? t('day in a row') : t('days in a row'))),
    h('p', {}, h('b', {}, String(best)), h('small', {}, t('best streak'))),
    h('p', { class: 'streak-note' }, t('Play either daily challenge every day to keep the flame alive.')));
}

/** Tabs between the two daily challenges, with a tick on the ones done today. */
function dailyTabs(active) {
  const date = romeDate();
  const done = {
    pairs: (load(dailyKey(date), null)?.answers?.length ?? 0) >= RULES.dailyPairs,
    guess: (load(dailyGuessKey(date), null)?.answers?.length ?? 0) >= DAILY_GUESS_CARDS,
  };
  return h('nav', { class: 'segmented daily-tabs', 'aria-label': t('Daily challenges') },
    [['pairs', '#/daily', t('Higher or lower')], ['guess', '#/daily/guess', t('Closest guess')]].map(([id, href, label]) =>
      h('a', { class: 'seg', href, 'aria-current': id === active ? 'page' : null, 'aria-pressed': String(id === active) }, t(label), done[id] ? ' ✓' : '')));
}

/**
 * Today's score distribution, Wordle-style. Records this player's score once
 * (state.recorded), then shows where it sits among everybody's.
 */
function distributionBox({ date, game, score, state, stateKey }) {
  const box = h('section', { class: 'box dist' }, h('h2', {}, t("Everybody today")), h('p', { class: 'muted' }, t('Loading…')));
  const buckets = game === 'pairs'
    ? Array.from({ length: 11 }, (_, k) => ({ label: String(k), lo: k, hi: k }))
    : Array.from({ length: 10 }, (_, k) => ({ label: `${k * 50}+`, lo: k * 50, hi: k === 9 ? 500 : k * 50 + 49 }));
  (async () => {
    const ok = await online.init();
    if (ok && !state.recorded) {
      await online.recordDaily(date, game, score).then(() => { state.recorded = true; save(stateKey, state); }).catch(() => {});
    }
    const rows = ok ? await online.dailyCounts(date, game).catch(() => null) : null;
    if (!box.isConnected) return;
    if (!rows) { box.replaceChildren(box.firstChild, h('p', { class: 'board-empty' }, t('Everybody\'s scores are offline right now.'))); return; }
    const total = rows.reduce((n, r) => n + r.players, 0);
    const below = rows.filter((r) => r.score < score).reduce((n, r) => n + r.players, 0);
    const counts = buckets.map((b) => rows.filter((r) => r.score >= b.lo && r.score <= b.hi).reduce((n, r) => n + r.players, 0));
    const max = Math.max(1, ...counts);
    box.replaceChildren(box.firstChild,
      h('p', { class: 'dist-headline' }, total <= 1 ? t('You are the first to finish today. Set the bar!')
        : h('span', {}, ...tx("Better than {pct} of today's {n} players.", { pct: h('b', {}, formatPercent(Math.round((100 * below) / total))) }, { n: total }))),
      h('ol', { class: 'dist-bars', 'aria-label': t('Players per score today') }, buckets.map((b, k) => h('li', { class: score >= b.lo && score <= b.hi ? 'me' : '' },
        h('span', { class: 'dist-label' }, b.label),
        h('span', { class: 'dist-bar', style: `--w:${Math.max(2, (100 * counts[k]) / max)}%` }, h('span', {}, String(counts[k])))))));
  })();
  return box;
}

function startDaily() {
  const date = romeDate();
  const pairs = dailyPairs(ENTRIES, date);
  if (pairs.length < RULES.dailyPairs) {
    mount(dailyTabs('pairs'), h('h1', { class: 'screen-title' }, t("Today's challenge is warming up")),
      h('p', { class: 'lede' }, t('New statistics join the Daily Challenge the day after they are added, so everyone gets the same set. Come back after midnight (Rome time).')),
      h('div', { class: 'actions' }, h('a', { class: 'btn btn-primary', href: '#/' }, t('Play Endless meanwhile'))));
    return;
  }
  const state = load(dailyKey(date), null) || { answers: [] };
  // Signed in: progress made on another device wins if it went further.
  if (online.currentUser() && !startDaily.synced) {
    startDaily.synced = true;
    online.loadDaily(date).then((answers) => {
      if (answers && answers.length > state.answers.length && location.hash === '#/daily') {
        save(dailyKey(date), { answers });
        startDaily();
      }
    }).catch(() => {}).finally(() => { startDaily.synced = false; });
  }
  // Headlines are deterministic too, so every player sees the same challenge.
  const rng = mulberry32(hashString(`percento-headlines:${date}`));
  const headlines = pairs.map(() => t(pickFrom(HEADLINES, rng)));

  const dots = (i) => h('span', { class: 'dots', 'aria-hidden': 'true' },
    pairs.map((_, k) => h('span', { class: k < state.answers.length ? (state.answers[k] ? 'ok' : 'ko') : (k === i ? 'now' : '') })));

  const round = (i) => {
    if (i >= pairs.length) return dailyResults(date, pairs, state.answers);
    const pair = pairs[i];
    renderRound({
      pair,
      headline: headlines[i],
      pill: { value: state.answers.filter(Boolean).length, label: t('Correct today') },
      progress: h('div', { class: 'progress' }, h('span', { class: 'status' }, `${t('Daily {date}', { date })} · ${t('Pair {i} of {n}', { i: i + 1, n: pairs.length })}`), dots(i)),
      continueLabel: i === pairs.length - 1 ? t('See results') : t('Next pair'),
      onAnswer: (correct) => {
        state.answers[i] = correct;
        save(dailyKey(date), state);
        online.saveDaily(date, state.answers).catch(() => {});
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

function shareFlow(text) {
  const doShare = async () => {
    const result = await shareResult(text);
    if (result === 'copied') toast('Result copied to clipboard. Go brag (politely).');
    else if (result === 'shared') toast('Shared!');
    else if (result === 'failed') toast('Could not copy automatically. Select the text above and copy it.');
  };
  setKeys((ev) => { if (ev.key === 'Enter' && document.activeElement?.tagName !== 'A') { ev.preventDefault(); doShare(); } });
  return doShare;
}

function nextDailyCountdown(date, onNewDay) {
  const countdown = h('span', { class: 'countdown' }, formatCountdown(msUntilNextDaily()));
  const timer = setInterval(() => {
    countdown.textContent = formatCountdown(msUntilNextDaily());
    if (romeDate() !== date) { clearInterval(timer); onNewDay(); }
  }, 1000);
  cleanup.push(() => clearInterval(timer));
  return h('p', { class: 'muted' }, ...tx('Next challenges in {time} (midnight, Rome time)', { time: countdown }));
}

function dailyResults(date, pairs, answers) {
  const score = answers.filter(Boolean).length;
  const state = load(dailyKey(date), null) || { answers };
  const text = shareText({ date, answers, url: `${shareUrl()}#/daily` });
  const doShare = shareFlow(text);
  const otherDone = (load(dailyGuessKey(date), null)?.answers?.length ?? 0) >= DAILY_GUESS_CARDS;
  mount(
    dailyTabs('pairs'),
    h('p', { class: 'kicker' }, t('Daily · Higher or lower')),
    h('h1', { class: 'screen-title' }, t('Daily {date}', { date })),
    h('p', { class: 'big-score' }, h('span', {}, `${score}/${answers.length}`), h('small', {}, t('pairs right'))),
    h('p', { class: 'grid', 'aria-label': answers.map((a, i) => t(a ? 'Pair {i} right' : 'Pair {i} wrong', { i: i + 1 })).join(', ') }, answers.map((a) => (a ? '🟩' : '🟥')).join('')),
    h('p', { class: 'lede' }, t(pickByScore(DAILY_END_LINES, score))),
    streakBox(),
    h('pre', { class: 'share-text', 'aria-label': t('Share text') }, text),
    h('div', { class: 'actions' },
      h('button', { class: 'btn btn-primary', type: 'button', onclick: doShare }, t('Share result')),
      otherDone ? h('a', { class: 'btn', href: '#/' }, t('Play Endless')) : h('a', { class: 'btn', href: '#/daily/guess' }, t("Today's Closest guess"))),
    nextDailyCountdown(date, startDaily),
    distributionBox({ date, game: 'pairs', score, state, stateKey: dailyKey(date) }),
    h('section', { class: 'box', style: 'margin-top:16px' }, h('h2', {}, t("Today's pairs")),
      h('ol', { class: 'recap' }, pairs.map((p, i) => h('li', {},
        `${answers[i] ? '🟩' : '🟥'} ${p.a.emoji} ${cardText(p.a)} (${formatValue(p.a.value)}) ${t('vs')} ${p.b.emoji} ${cardText(p.b)} (${formatValue(p.b.value)})`)))));
}

// ---------- daily closest guess ----------
const guessSquare = (points) => (points >= 90 ? '🎯' : points >= 60 ? '🟩' : points >= 30 ? '🟨' : '🟥');

function startDailyGuess() {
  const date = romeDate();
  const cards = dailyGuessCards(ENTRIES, date);
  if (cards.length < DAILY_GUESS_CARDS) {
    mount(dailyTabs('guess'), h('h1', { class: 'screen-title' }, t("Today's challenge is warming up")),
      h('p', { class: 'lede' }, t('New statistics join the daily challenges the day after they are added, so everyone gets the same cards. Come back after midnight (Rome time).')),
      h('div', { class: 'actions' }, h('a', { class: 'btn btn-primary', href: '#/guess' }, t('Practise Closest guess'))));
    return;
  }
  // Answers are saved one by one: a reload resumes, it never replays a card.
  const state = load(dailyGuessKey(date), null) || { answers: [] };
  const total = () => state.answers.reduce((n, a) => n + a.points, 0);
  const dots = (i) => h('span', { class: 'dots', 'aria-hidden': 'true' },
    cards.map((_, k) => h('span', { class: k < state.answers.length ? (state.answers[k].points >= 60 ? 'ok' : state.answers[k].points > 0 ? 'mid' : 'ko') : (k === i ? 'now' : '') })));

  const round = (i) => {
    if (i >= cards.length) return dailyGuessResults(date, cards, state);
    const entry = cards[i];
    const ctl = renderGuess({
      entry,
      headline: `${t('Daily closest guess')} · ${t('card {i} of {n}', { i: i + 1, n: cards.length })}`,
      pill: { value: total(), label: t('Points today') },
      progress: h('div', { class: 'progress' }, h('span', { class: 'status' }, `${t('Daily {date}', { date })} · ${t('Card {i} of {n}', { i: i + 1, n: cards.length })}`), dots(i)),
      deadline: Date.now() + GUESS_TIME_MS,
      onLock: (guess, touched) => {
        const points = touched ? guessPoints(guess, entry.value) : 0;
        state.answers[i] = { guess: touched ? guess : null, points };
        save(dailyGuessKey(date), state);
        if (state.answers.length === cards.length) {
          const history = load(DAILY_GUESS_HISTORY_KEY, {}) || {};
          history[date] = total();
          save(DAILY_GUESS_HISTORY_KEY, history);
        }
        setTimeout(async () => {
          const off = touched ? Math.abs(guess - entry.value) : null;
          await ctl.reveal({
            pins: touched ? [{ name: t('You'), guess, me: true }] : [],
            message: off === null ? t('No guess, no points.') : off < 0.5 ? t("Bull's-eye! +{points}", { points }) : t('{off} points off · +{points}', { off: Number.isInteger(off) ? off : off.toFixed(1), points }),
          });
          audio.sfx(points >= 60 ? 'right' : points > 0 ? 'tick' : 'wrong');
          const next = h('button', { class: 'btn btn-primary continue', type: 'button', onclick: () => go() }, i === cards.length - 1 ? t('See results') : t('Next card'));
          app.querySelector('.guess-side')?.append(next);
          next.focus({ preventScroll: true });
          let gone = false;
          const go = () => { if (!gone) { gone = true; round(i + 1); } };
          setKeys((ev) => { if (ev.key === 'Enter') { ev.preventDefault(); go(); } });
        }, 250);
      },
    });
  };
  round(state.answers.length);
}

function dailyGuessResults(date, cards, state) {
  const score = state.answers.reduce((n, a) => n + a.points, 0);
  const grid = state.answers.map((a) => guessSquare(a.points)).join('');
  const text = `PERCENTO Guess ${date}: ${score}/${cards.length * 100}\n${grid}\n${shareUrl()}#/daily/guess`;
  const doShare = shareFlow(text);
  const otherDone = (load(dailyKey(date), null)?.answers?.length ?? 0) >= RULES.dailyPairs;
  mount(
    dailyTabs('guess'),
    h('p', { class: 'kicker' }, t('Daily · Closest guess')),
    h('h1', { class: 'screen-title' }, t('Daily {date}', { date })),
    h('p', { class: 'big-score' }, h('span', {}, String(score)), h('small', {}, `of ${cards.length * 100} points`)),
    h('p', { class: 'grid', 'aria-label': state.answers.map((a, i) => t('Card {i}: {points} points', { i: i + 1, points: a.points })).join(', ') }, grid),
    streakBox(),
    h('pre', { class: 'share-text', 'aria-label': t('Share text') }, text),
    h('div', { class: 'actions' },
      h('button', { class: 'btn btn-primary', type: 'button', onclick: doShare }, t('Share result')),
      otherDone ? h('a', { class: 'btn', href: '#/guess' }, t('Practise more')) : h('a', { class: 'btn', href: '#/daily' }, t("Today's Higher or lower"))),
    nextDailyCountdown(date, startDailyGuess),
    distributionBox({ date, game: 'guess', score, state, stateKey: dailyGuessKey(date) }),
    h('section', { class: 'box', style: 'margin-top:16px' }, h('h2', {}, t("Today's cards")),
      h('ol', { class: 'board guess-recap' }, cards.map((e, k) => h('li', {},
        h('span', { class: 'rank' }, guessSquare(state.answers[k].points)), h('span', {}, ''),
        h('span', { class: 'who' }, cardText(e), h('small', {}, state.answers[k].guess === null ? t('no guess · real {value}', { value: formatValue(e.value) }) : t('you {guess} · real {value}', { guess: formatPercent(state.answers[k].guess), value: formatValue(e.value) }))),
        h('span', { class: 'score' }, `+${state.answers[k].points}`))))));
}

// ---------- other screens ----------
function leaderboard() {
  setKeys(null);
  const history = Object.entries(load(DAILY_HISTORY_KEY, {}) || {}).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  const world = h('section', { class: 'box' }, h('h2', {}, t('World leaderboard')), h('p', { class: 'muted' }, t('Loading…')));
  const today = romeDate();
  const daily = h('section', { class: 'box', style: 'margin-top:16px' }, h('h2', {}, t("Today's Daily ({date})", { date: today })), h('p', { class: 'muted' }, t('Loading…')));
  mount(
    h('h1', { class: 'screen-title' }, t('Leaderboard')),
    h('p', { class: 'lede' }, online.currentUser()
      ? t('Playing as {name}. Your scores count on the world board.', { name: online.currentUser().username })
      : h('span', {}, ...tx('Guests only appear on this device. {link} to join the world board.', { link: h('a', { href: '#/account' }, t('Create an account')) }))),
    world, daily,
    h('section', { class: 'box', style: 'margin-top:16px' }, h('h2', {}, t('This device: best Endless runs')), leaderboardList(10)),
    h('section', { class: 'box', style: 'margin-top:16px' }, h('h2', {}, t('This device: Daily history')),
      history.length
        ? h('ol', { class: 'board' }, history.slice(0, 14).map(([d, sc]) => h('li', {},
          h('span', { class: 'rank' }, '📅'), h('span', {}, ''), h('span', { class: 'who' }, d), h('span', { class: 'score' }, `${sc}/10`))))
        : h('p', { class: 'board-empty' }, t('No Daily Challenge played yet.'))),
    h('div', { class: 'actions' }, h('a', { class: 'btn btn-primary', href: '#/' }, t('Play Endless')), h('a', { class: 'btn', href: '#/daily' }, t('Daily Challenge'))));
  online.init().then(async (ok) => {
    const me = online.currentUser()?.username;
    const top = ok ? await online.topPlayers(10).catch(() => null) : null;
    const day = ok ? await online.dailyBoard(today).catch(() => null) : null;
    const offline = h('p', { class: 'board-empty' }, t('The world board is offline right now. Your games still count on this device.'));
    world.replaceChildren(world.firstChild, top ? boardList(top.map((r) => ({ username: r.username, score: r.best, note: t('{n} runs', { n: r.runs }) })), me) : offline);
    daily.replaceChildren(daily.firstChild, day ? boardList(day.map((r) => ({ username: r.username, score: `${r.score}/10` })), me) : offline.cloneNode(true));
  });
}

function sources(focusCategory) {
  setKeys(null);
  const byCat = CATEGORY_IDS.map((c) => [c, ENTRIES.filter((e) => e.category === c).sort((a, b) => a.text.localeCompare(b.text))]).filter(([, l]) => l.length);
  mount(
    h('h1', { class: 'screen-title' }, t('Sources')),
    h('p', { class: 'lede' }, t('All {n} statistics in the game, each from a statistics office, an international agency, a space agency, a major survey or a peer-reviewed study.', { n: ENTRIES.length })),
    byCat.map(([c, list]) => h('section', { class: 'source-group', id: `cat-${c}` },
      h('h2', { style: `--c:${CATEGORIES[c].color}` }, icon(c), `${CATEGORIES[c].label} (${list.length})`),
      h('ul', { class: 'source-list' }, list.map((e) => h('li', {},
        `${e.emoji} ${cardText(e)} `, h('strong', {}, formatValue(e.value)),
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
    motionBtn.textContent = on ? t('On') : t('Off');
  } }, reduce() ? t('On') : t('Off'));
  const toggle = (get, set) => {
    const btn = h('button', { class: 'btn switch', type: 'button', 'aria-pressed': String(get()), onclick: () => {
      set(!get());
      btn.setAttribute('aria-pressed', String(get()));
      btn.textContent = get() ? t('On') : t('Off');
      updateSoundButton();
    } }, get() ? t('On') : t('Off'));
    return btn;
  };
  mount(
    h('h1', { class: 'screen-title' }, t('Settings')),
    h('section', { class: 'box' },
      h('div', { class: 'setting' }, h('p', {}, t('Language'), h('small', {}, t('Cards and menus in your language.'))),
        h('select', { class: 'input lang-select', 'aria-label': t('Language'), onchange: (ev) => { setLang(ev.target.value); location.reload(); } },
          Object.entries(LANGS).map(([code, name]) => h('option', { value: code, selected: code === getLang() }, name)))),
      h('div', { class: 'setting' }, h('p', {}, t('Sound effects'), h('small', {}, t('Taps, ticks, right and wrong.'))), toggle(audio.soundEnabled, audio.setSound)),
      h('div', { class: 'setting' }, h('p', {}, t('Music'), h('small', {}, t('A soft loop while you play, faster in online games.'))), toggle(audio.musicEnabled, audio.setMusic)),
      h('div', { class: 'setting' }, h('p', {}, t('Reduce motion'), h('small', {}, t('The Percentometer jumps straight to the answer.'))), motionBtn),
      h('div', { class: 'setting' }, h('p', {}, t('Reset my records'), h('small', {}, t('Clears personal best and the local leaderboard.'))),
        h('button', { class: 'btn', type: 'button', onclick: () => {
          save(BEST_KEY, 0); save(RUNS_KEY, []); renderPanel(); toast('Records cleared.');
        } }, t('Reset'))),
      h('div', { class: 'setting' }, h('p', {}, t('About the numbers'), h('small', {}, `${t(TAGLINE)} ${t('Every number is real; the pairings are absurd on purpose.')}`)),
        h('a', { class: 'btn', href: '#/sources' }, t('Sources')))));
}

function review() {
  setKeys(null);
  if (BUILD.mode !== 'dev') return startEndless();
  const list = ENTRIES.filter((e) => e.status === 'unverified');
  mount(
    h('h1', { class: 'screen-title' }, t('Review mode')),
    h('p', { class: 'lede' }, t('Test build: {n} unverified of {total} statistics. The public version serves verified statistics only.', { n: list.length, total: ENTRIES.length })),
    h('ul', { class: 'source-list' }, list.map((e) => h('li', {},
      `[${e.id}] ${e.text} `, h('strong', {}, formatValue(e.value)),
      h('span', { class: 'source-detail' }, e.detail, ' · ', h('a', { href: e.sourceUrl, target: '_blank', rel: 'noopener' }, e.source), ` · ${e.year} · ${e.reviewReason}`)))));
}

// ---------- account ----------
const RETURN_KEY = 'percento:returnTo';
// sessionStorage throws when the browser blocks storage; a lost return address is harmless.
const session = {
  get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* ignore */ } },
  remove: (k) => { try { sessionStorage.removeItem(k); } catch { /* ignore */ } },
};

function offlineNotice() {
  return h('p', { class: 'note' }, t('Accounts are unavailable right now (no connection to the PERCENTO server). You can keep playing as a guest.'));
}

function field(label, attrs) {
  const input = h('input', { class: 'input', ...attrs });
  return [h('label', { class: 'field' }, h('span', {}, label), input), input];
}

async function account(tab = 'signin') {
  setKeys(null);
  mount(h('h1', { class: 'screen-title' }, t('Account')), h('p', { class: 'muted' }, t('Loading…')));
  const ok = await online.init();
  if (!location.hash.startsWith('#/account')) return;
  const me = online.currentUser();
  if (!ok) return mount(h('h1', { class: 'screen-title' }, t('Account')), offlineNotice(), settingsLink());
  if (me) return profileScreen(me);

  const message = h('p', { class: 'form-message', role: 'alert' });
  const busy = (form, on) => form.querySelectorAll('button, input').forEach((el) => { el.disabled = on; });
  const done = () => {
    const back = session.get(RETURN_KEY);
    session.remove(RETURN_KEY);
    // The auth listener may already have taken the player back where they were going.
    if (!location.hash.startsWith('#/account')) return;
    location.hash = back || '#/account';
    if (!back) account();
  };

  let form;
  if (tab === 'signup') {
    const [nameField, name] = field(t('Player name'), { name: 'username', autocomplete: 'nickname', required: true, minlength: 3, maxlength: 20, pattern: '[A-Za-z0-9_]+', placeholder: t('e.g. Jacopo_21') });
    const [mailField, mail] = field(t('Email'), { type: 'email', name: 'email', autocomplete: 'email', required: true });
    const [passField, pass] = field(t('Password'), { type: 'password', name: 'password', autocomplete: 'new-password', required: true, minlength: 6 });
    form = h('form', { class: 'box form', novalidate: true, onsubmit: async (ev) => {
      ev.preventDefault();
      message.className = 'form-message';
      if (!/^[A-Za-z0-9_]{3,20}$/.test(name.value)) { message.textContent = t('Player name: 3 to 20 letters, numbers or _.'); return; }
      if (!mail.validity.valid || !mail.value) { message.textContent = t('Enter a valid email.'); return; }
      if (pass.value.length < 6) { message.textContent = t('Password: at least 6 characters.'); return; }
      busy(form, true);
      if (await online.usernameTaken(name.value).catch(() => false)) {
        busy(form, false);
        message.textContent = t('That player name is taken. Try another one.');
        return;
      }
      const res = await online.signUp({ email: mail.value.trim(), password: pass.value, username: name.value });
      busy(form, false);
      if (res.error) { message.textContent = res.error; return; }
      if (res.confirm) {
        message.className = 'form-message ok';
        message.textContent = t('Almost there! We sent a link to {email}. Open it to activate your account.', { email: mail.value.trim() });
        return;
      }
      done();
    } }, nameField, mailField, passField, message, h('button', { class: 'btn btn-primary', type: 'submit' }, t('Create account')));
  } else {
    const [mailField, mail] = field(t('Email'), { type: 'email', name: 'email', autocomplete: 'email', required: true });
    const [passField, pass] = field(t('Password'), { type: 'password', name: 'password', autocomplete: 'current-password', required: true });
    form = h('form', { class: 'box form', novalidate: true, onsubmit: async (ev) => {
      ev.preventDefault();
      message.className = 'form-message';
      if (!mail.value || !pass.value) { message.textContent = t('Enter your email and password.'); return; }
      busy(form, true);
      const res = await online.signIn({ email: mail.value.trim(), password: pass.value });
      busy(form, false);
      if (res.error) { message.textContent = res.error; return; }
      done();
    } }, mailField, passField, message, h('button', { class: 'btn btn-primary', type: 'submit' }, t('Sign in')));
  }

  const google = h('button', { class: 'btn btn-google', type: 'button', onclick: async () => {
    const res = await online.signInWithGoogle();
    if (res.error) { message.textContent = res.error; }
  } }, h('span', { 'aria-hidden': 'true' }, 'G'), t('Continue with Google'));

  mount(
    h('h1', { class: 'screen-title' }, tab === 'signup' ? t('Create your account') : t('Sign in')),
    h('p', { class: 'lede' }, t('Save your records on every device, climb the world leaderboard and play with friends. Or just keep playing as a guest.')),
    h('div', { class: 'tabs', role: 'tablist' },
      h('a', { href: '#/account', role: 'tab', 'aria-selected': String(tab !== 'signup'), class: tab !== 'signup' ? 'active' : '' }, t('Sign in')),
      h('a', { href: '#/account/new', role: 'tab', 'aria-selected': String(tab === 'signup'), class: tab === 'signup' ? 'active' : '' }, t('Create account'))),
    form,
    h('div', { class: 'or' }, h('span', {}, 'or')),
    google,
    h('div', { class: 'actions' }, h('a', { class: 'btn', href: '#/' }, t('Keep playing as guest'))),
    settingsLink());
}

const settingsLink = () => h('p', { class: 'muted small-links' }, h('a', { href: '#/settings' }, t('Settings')), ' · ', h('a', { href: '#/sources' }, t('Sources')));

async function profileScreen(me) {
  const stats = h('section', { class: 'box' }, h('h2', {}, t('Your records')), h('p', { class: 'muted' }, t('Loading…')));
  const message = h('p', { class: 'form-message', role: 'alert' });
  const [nameField, name] = field(t('Player name'), { name: 'username', value: me.username, required: true, minlength: 3, maxlength: 20, pattern: '[A-Za-z0-9_]+' });
  mount(
    h('p', { class: 'kicker' }, me.guest ? t('Playing online as a guest') : t('Signed in')),
    h('h1', { class: 'screen-title' }, `Hi, ${me.username}!`),
    h('p', { class: 'lede' }, me.guest
      ? t('Your games are saved on this browser only. Add an email and password to keep them on every device; your name and records stay.')
      : t('Your Endless runs and Daily Challenges are saved to your account.')),
    me.guest ? upgradeForm() : null,
    stats,
    h('form', { class: 'box form', style: 'margin-top:16px', onsubmit: async (ev) => {
      ev.preventDefault();
      if (!/^[A-Za-z0-9_]{3,20}$/.test(name.value)) { message.textContent = t('Player name: 3 to 20 letters, numbers or _.'); return; }
      const res = await online.rename(name.value);
      message.className = res.error ? 'form-message' : 'form-message ok';
      message.textContent = res.error || t('Saved.');
      updateAccountLink();
    } }, nameField, message, h('button', { class: 'btn', type: 'submit' }, t('Save name'))),
    h('div', { class: 'actions' },
      h('a', { class: 'btn btn-primary', href: '#/online' }, t('Play with friends')),
      h('button', { class: 'btn', type: 'button', onclick: async () => {
        if (me.guest && !window.confirm(t('Leave guest mode? Without an email you cannot come back to this name and its records.'))) return;
        await online.signOut();
        toast('Signed out. Playing offline as a guest.');
        location.hash = '#/';
      } }, me.guest ? t('Leave guest mode') : t('Sign out'))),
    settingsLink());
  const data = await online.myStats().catch(() => null);
  if (!stats.isConnected) return;
  if (!data) { stats.replaceChildren(stats.firstChild, h('p', { class: 'board-empty' }, t('Could not load your records right now.'))); return; }
  const best = Math.max(data.runs[0]?.score ?? 0, load(BEST_KEY, 0) || 0);
  stats.replaceChildren(stats.firstChild,
    h('div', { class: 'stat-row' },
      h('p', {}, h('b', {}, String(best)), h('small', {}, t('Best Endless'))),
      h('p', {}, h('b', {}, String(data.games)), h('small', {}, t('Endless games'))),
      h('p', {}, h('b', {}, String(data.daily.filter((d) => d.answers.length === 10).length)), h('small', {}, t('Dailies played')))),
    data.daily.length ? h('ol', { class: 'board' }, data.daily.map((d) => h('li', {},
      h('span', { class: 'rank' }, '📅'), h('span', {}, ''), h('span', { class: 'who' }, d.day),
      h('span', { class: 'score' }, `${d.score}/${d.answers.length}`)))) : h('p', { class: 'board-empty' }, t('No Daily Challenge saved yet.')));
}

function upgradeForm() {
  const message = h('p', { class: 'form-message', role: 'alert' });
  const [mailField, mail] = field(t('Email'), { type: 'email', name: 'email', autocomplete: 'email', required: true });
  const [passField, pass] = field(t('Password'), { type: 'password', name: 'password', autocomplete: 'new-password', required: true, minlength: 6 });
  const form = h('form', { class: 'box form', novalidate: true, onsubmit: async (ev) => {
    ev.preventDefault();
    message.className = 'form-message';
    if (!mail.validity.valid || !mail.value) { message.textContent = t('Enter a valid email.'); return; }
    if (pass.value.length < 6) { message.textContent = t('Password: at least 6 characters.'); return; }
    form.querySelectorAll('button, input').forEach((el) => { el.disabled = true; });
    const res = await online.upgradeGuest({ email: mail.value.trim(), password: pass.value });
    form.querySelectorAll('button, input').forEach((el) => { el.disabled = false; });
    if (res.error) { message.textContent = res.error; return; }
    if (res.confirm) {
      message.className = 'form-message ok';
      message.textContent = t('Almost there! Open the link we sent to {email} to finish.', { email: mail.value.trim() });
      return;
    }
    toast('Account saved. Welcome!');
    account();
  } }, h('h2', {}, t('Keep your progress')), mailField, passField, message, h('button', { class: 'btn btn-primary', type: 'submit' }, t('Save my account')));
  return form;
}

function updateAccountLink() {
  const me = online.currentUser();
  for (const el of document.querySelectorAll('[data-account-label]')) el.textContent = me ? me.username : t('Sign in');
}

/** Online without an account: pick a nickname and play as a guest, or sign in. Then back to `hash`. */
function needAccount(hash, title, why) {
  session.set(RETURN_KEY, hash);
  const message = h('p', { class: 'form-message', role: 'alert' });
  const [nickField, nick] = field(t('Your nickname'), { name: 'nickname', autocomplete: 'nickname', maxlength: 20, placeholder: t('e.g. Jacopo_21') });
  const form = h('form', { class: 'box box-feature form guest-form', novalidate: true, onsubmit: async (ev) => {
    ev.preventDefault();
    message.className = 'form-message';
    const name = nick.value.trim().replace(/\s+/g, '_');
    if (!/^[A-Za-z0-9_]{3,20}$/.test(name)) { message.textContent = t('Nickname: 3 to 20 letters, numbers or _.'); return; }
    form.querySelectorAll('button, input').forEach((el) => { el.disabled = true; });
    const res = await online.signInAsGuest(name);
    form.querySelectorAll('button, input').forEach((el) => { el.disabled = false; });
    if (res.error) { message.textContent = res.error; return; }
    session.remove(RETURN_KEY);
    if (location.hash === hash) route(); else location.hash = hash;
  } }, h('h2', {}, t('Play as a guest')), h('p', { class: 'muted' }, t('No email, no password. Just a name the others will see.')),
  nickField, message, h('button', { class: 'btn btn-primary btn-big', type: 'submit' }, t('Play as guest')));
  mount(h('h1', { class: 'screen-title' }, title), h('p', { class: 'lede' }, why),
    form,
    h('p', { class: 'muted' }, t('Have an account, or want one to keep your records everywhere?')),
    h('div', { class: 'actions' },
      h('a', { class: 'btn', href: '#/account' }, t('Sign in')),
      h('a', { class: 'btn', href: '#/account/new' }, t('Create account'))));
  nick.focus({ preventScroll: true });
}

// ---------- friends: rooms ----------
const ROOM_TIME_MS = 15000;

async function friends() {
  setKeys(null);
  mount(h('h1', { class: 'screen-title' }, t('Play online')), h('p', { class: 'muted' }, t('Loading…')));
  const ok = await online.init();
  if (location.hash !== '#/online') return;
  if (!ok) return mount(h('h1', { class: 'screen-title' }, t('Play online')), offlineNotice());
  if (!online.currentUser()) {
    return needAccount('#/online', t('Play online'), t('Pick a nickname so the others know who is who.'));
  }
  const message = h('p', { class: 'form-message', role: 'alert' });
  const [codeField, code] = field(t('Room code'), { name: 'code', autocomplete: 'off', maxlength: 6, placeholder: 'ABC123', style: 'text-transform:uppercase' });
  const category = h('select', { class: 'input', name: 'category' },
    h('option', { value: '' }, t('All categories, mixed')),
    CATEGORY_IDS.filter((c) => categoryPool(c).length >= MIN_CATEGORY_CARDS).map((c) => h('option', { value: c }, CATEGORIES[c].label)));
  const busy = async (btn, action) => {
    btn.disabled = true;
    const res = await action();
    if (res.error) { message.textContent = res.error; btn.disabled = false; return; }
    location.hash = `#/room/${res.code}`;
  };
  const MODE_KEY = 'percento:onlineMode';
  const MODES = {
    standing: [t('Last one standing'), t('Up to 10 players get the same pairs in the same order. 15 seconds per pair. One mistake and you are out: whoever goes furthest wins.')],
    guess: [t('Closest guess'), t('One card at a time, the same for everyone. 15 seconds to set the percentage you think it is. 10 cards; the closest guesses score most.')],
  };
  let mode = MODES[load(MODE_KEY, 'standing')] ? load(MODE_KEY, 'standing') : 'standing';
  const title = h('h1', { class: 'screen-title' });
  const lede = h('p', { class: 'lede' });
  const modeButtons = Object.entries(MODES).map(([id, [label]]) => h('button', { class: 'seg', type: 'button', 'data-mode': id, onclick: () => setMode(id) }, label));
  const setMode = (id) => {
    mode = id;
    save(MODE_KEY, id);
    title.textContent = MODES[id][0];
    lede.textContent = MODES[id][1];
    for (const b of modeButtons) b.setAttribute('aria-pressed', String(b.dataset.mode === id));
  };
  setMode(mode);
  mount(
    h('p', { class: 'kicker' }, t('Online')),
    title,
    h('div', { class: 'segmented', role: 'group', 'aria-label': t('Game mode') }, modeButtons),
    lede,
    h('div', { class: 'online-grid' },
      h('section', { class: 'box box-feature' },
        icon('globe', 'icon icon-big'),
        h('h2', {}, t('Play with strangers')),
        h('p', { class: 'muted' }, t('Jump into the next public game. It starts 20 seconds after a second player joins, or at once with 10.')),
        h('button', { class: 'btn btn-primary btn-big', type: 'button', onclick: (ev) => busy(ev.currentTarget, () => online.quickMatch(mode)) }, t('Find a game'))),
      h('section', { class: 'box form' },
        h('h2', {}, t('Room with friends')),
        h('p', { class: 'muted' }, t('Create a private room, send the link, start when everybody is in.')),
        h('label', { class: 'field' }, h('span', {}, t('Cards from')), category),
        h('button', { class: 'btn', type: 'button', onclick: (ev) => busy(ev.currentTarget, () => online.createRoom(category.value || null, mode)) }, t('Create a room'))),
      h('form', { class: 'box form', onsubmit: (ev) => {
        ev.preventDefault();
        const c = code.value.trim().toUpperCase();
        if (!/^[A-Z0-9]{6}$/.test(c)) { message.textContent = t('Room codes have 6 letters or numbers.'); return; }
        location.hash = `#/room/${c}`;
      } }, h('h2', {}, t('Join with a code')), codeField, h('button', { class: 'btn', type: 'submit' }, t('Join')))),
    message);
}

async function room(code) {
  setKeys(null);
  const hash = `#/room/${code}`;
  mount(h('h1', { class: 'screen-title' }, t('Room {code}', { code })), h('p', { class: 'muted' }, t('Connecting…')));
  const ok = await online.init();
  if (location.hash !== hash) return;
  if (!ok) return mount(h('h1', { class: 'screen-title' }, t('Room {code}', { code })), offlineNotice());
  const me = online.currentUser();
  if (!me) return needAccount(hash, t('Join room {code}', { code }), t('Your friend invited you to a PERCENTO game. Pick a nickname to join.'));

  let data = await online.fetchRoom(code);
  if (location.hash !== hash) return;
  if (!data) return mount(h('h1', { class: 'screen-title' }, t('Room not found')), h('p', { class: 'lede' }, t('There is no room {code}. Check the code with your friend.', { code })), h('div', { class: 'actions' }, h('a', { class: 'btn btn-primary', href: '#/online' }, t('Back'))));
  if (!data.players.some((p) => p.user_id === me.id) && data.room.status === 'lobby') {
    const res = await online.joinRoom(code);
    if (res.error) return mount(h('h1', { class: 'screen-title' }, t('Room {code}', { code })), h('p', { class: 'lede' }, res.error), h('div', { class: 'actions' }, h('a', { class: 'btn btn-primary', href: '#/online' }, t('Back'))));
    data = await online.fetchRoom(code);
  }

  let view = null; // 'lobby' | 'playing' | 'standings'
  let standingsBox = null;
  const mine = () => data.players.find((p) => p.user_id === me.id);

  const ranking = () => [...data.players].sort((a, b) => b.score - a.score || Number(b.alive) - Number(a.alive));
  const standings = (compact) => h('ol', { class: 'board room-board' }, ranking().slice(0, compact ? 4 : 10).map((p, i) => h('li', { class: p.user_id === me.id ? 'me' : '' },
    h('span', { class: `rank rank-${i + 1}` }, String(i + 1)),
    h('span', { 'aria-hidden': 'true' }, p.alive && data.room.status === 'playing' ? '🔥' : (i === 0 && data.room.status === 'finished' ? '🏆' : '•')),
    h('span', { class: 'who' }, p.username, h('small', {}, { lobby: p.user_id === data.room.host_id ? 'host' : 'ready', playing: p.alive ? t('still playing') : 'out', finished: t('final score') }[data.room.status])),
    h('span', { class: 'score' }, String(p.score)))));

  const refresh = async () => {
    const next = await online.fetchRoom(code).catch(() => null);
    if (!next || location.hash !== hash) return;
    data = next;
    render();
  };
  cleanup.push(online.watchRoom(data.room.id, refresh));
  audio.setMood('tense');
  // Presence: a heartbeat keeps this player in the room and lets the server
  // start public games on time; leaving the screen leaves a lobby.
  const beat = setInterval(() => {
    if (data.room.status === 'finished') return;
    online.heartbeat(code).then(() => { if (data.room.status === 'lobby') refresh(); }).catch(() => {});
  }, 4000);
  online.heartbeat(code).catch(() => {});
  let tick = null;
  cleanup.push(() => {
    clearInterval(beat);
    clearInterval(tick);
    if (data.room.status === 'lobby') online.leaveRoom(code).catch(() => {});
  });

  function render() {
    const status = data.room.status;
    const player = mine();
    // Mid-game, updates only refresh the live standings; the round is never interrupted.
    if (view === 'playing') { standingsBox?.replaceChildren(standings(true)); return; }
    if (view === 'guess') return; // the guessing game runs on its own clock
    if (status === 'lobby') return lobby();
    if (data.room.mode === 'guess') return guessGame();
    if (status === 'playing' && player?.alive && !out) return play();
    view = 'standings';
    results();
  }

  function lobby() {
    view = 'lobby';
    const isPublic = data.room.is_public;
    const isHost = data.room.host_id === me.id;
    const link = `${shareUrl()}#/room/${code}`;
    const n = data.players.length;
    const countdown = h('span', { class: 'countdown' });
    const updateCountdown = () => {
      const left = data.room.starts_at ? Math.max(0, Math.ceil((Date.parse(data.room.starts_at) - Date.now()) / 1000)) : null;
      countdown.textContent = left === null ? '' : left > 0 ? t('{n}s', { n: left }) : t('now');
    };
    clearInterval(tick);
    tick = setInterval(updateCountdown, 500);
    updateCountdown();
    const cat = data.room.category ? CATEGORIES[data.room.category]?.label : null;
    const guessMode = data.room.mode === 'guess';
    mount(
      h('p', { class: 'kicker' }, isPublic ? t('Public game') : t('Private room'), ` · ${t(guessMode ? 'Closest guess' : 'Last one standing')}`, cat ? ` · ${t('{category} only', { category: cat })}` : ''),
      h('h1', { class: 'screen-title' }, isPublic ? t('Finding players…') : t('Room {code}', { code })),
      h('p', { class: 'lede' }, isPublic
        ? (n < 2 ? t('Waiting for at least one more player. The game starts 20 seconds after the second player joins, or at once with 10.') : h('span', {}, ...tx('Game starts in {time}. {n} of {max} players.', { time: countdown }, { n, max: online.ROOM_SIZE })))
        : `${t('{n} of {max} players.', { n, max: online.ROOM_SIZE })} ${guessMode ? t('{rounds} cards, {seconds} seconds each to set your percentage. Closest scores most.', { rounds: data.room.rounds, seconds: data.room.round_seconds }) : t('Same cards for everyone, 15 seconds each, last one standing wins.')}`),
      h('div', { class: 'actions' },
        h('button', { class: isPublic ? 'btn' : 'btn btn-primary', type: 'button', onclick: async () => {
          const r = await shareResult(t('Join my PERCENTO game {code}: which percentage is higher? {link}', { code, link }));
          if (r === 'copied') toast('Invite link copied!'); else if (r === 'failed') toast(t('Room code: {code}', { code }));
        } }, t('Invite friends')),
        isPublic ? null : isHost ? h('button', { class: 'btn', type: 'button', disabled: n < 2, onclick: async (ev) => {
          ev.currentTarget.disabled = true;
          const res = await online.startRoom(code);
          if (res.error) toast(res.error);
          refresh();
        } }, n < 2 ? t('Start (needs 2 players)') : t('Start the game')) : h('p', { class: 'muted' }, t('Waiting for the host to start…'))),
      h('section', { class: 'box' }, h('h2', {}, t('Players')), standings(false)));
  }

  let out = false;
  let pending = Promise.resolve();
  const leave = () => { out = true; view = 'standings'; results(); pending.finally(refresh); };

  function play() {
    view = 'playing';
    clearInterval(tick);
    audio.sfx('start');
    const cat = data.room.category && categoryPool(data.room.category).length >= MIN_CATEGORY_CARDS ? data.room.category : null;
    const gen = createPairGenerator(cat ? categoryPool(cat) : ENTRIES, mulberry32(Number(data.room.seed)), { sameCategory: Boolean(cat) });
    let score = mine().score;
    // Resume after a reload: skip the pairs already answered.
    for (let i = 0; i < score; i++) gen.next();
    const round = () => {
      const pair = gen.next();
      if (!pair) { pending = online.reportScore(code, score, false); leave(); return; }
      standingsBox = h('div', { class: 'box room-live' }, standings(true));
      renderRound({
        pair,
        headline: `${t('Room {code}', { code })} · ${t('last one standing wins')}`,
        pill: { value: score, label: t('Your score') },
        progress: standingsBox,
        timeLimit: ROOM_TIME_MS,
        onAnswer: (correct) => {
          if (correct) score++;
          pending = online.reportScore(code, score, correct).catch(() => {});
        },
        onContinue: (correct) => (correct ? round() : leave()),
        continueLabel: t('See standings'),
      });
    };
    round();
  }

  // ---- closest guess, online: rounds follow the server clock ----
  async function guessGame() {
    view = 'guess';
    clearInterval(tick);
    const r = data.room;
    const offset = await online.serverOffset().catch(() => 0);
    if (location.hash !== hash) return;
    const roundMs = r.round_seconds * 1000;
    const period = (r.round_seconds + r.reveal_seconds) * 1000;
    const start = Date.parse(r.started_at);
    const cat = r.category && categoryPool(r.category).length >= MIN_CATEGORY_CARDS ? r.category : null;
    const cards = pickCards(cat ? categoryPool(cat) : ENTRIES, mulberry32(Number(r.seed)), r.rounds);
    const now = () => Date.now() + offset;
    let shown = -1;
    let phase = null;
    let ctl = null;
    let guesses = [];
    let board = null;

    const name = (id) => data.players.find((p) => p.user_id === id)?.username ?? '?';
    const totals = (upTo) => {
      const sum = new Map(data.players.map((p) => [p.user_id, 0]));
      for (const g of guesses) if (g.round <= upTo && cards[g.round]) sum.set(g.user_id, (sum.get(g.user_id) || 0) + guessPoints(Number(g.guess), cards[g.round].value));
      return [...sum.entries()].map(([id, pts]) => ({ id, name: name(id), pts })).sort((a, b) => b.pts - a.pts);
    };
    const table = (upTo) => h('ol', { class: 'board room-board' }, totals(upTo).slice(0, 10).map((row, k) => h('li', { class: row.id === me.id ? 'me' : '' },
      h('span', { class: `rank rank-${k + 1}` }, String(k + 1)), h('span', {}, ''),
      h('span', { class: 'who' }, row.name), h('span', { class: 'score' }, String(row.pts)))));
    const refreshGuesses = async () => { guesses = await online.fetchGuesses(r.id).catch(() => guesses); };

    const ask = (i) => {
      shown = i;
      phase = 'ask';
      board = h('div', { class: 'box room-live' }, h('h2', {}, t('Points')), table(i - 1));
      ctl = renderGuess({
        entry: cards[i],
        headline: `${r.is_public ? t('Public game') : t('Room {code}', { code })} · ${t('card {i} of {n}', { i: i + 1, n: r.rounds })}`,
        pill: { value: totals(i - 1).find((row) => row.id === me.id)?.pts ?? 0, label: t('Your points') },
        progress: board,
        deadline: start + i * period + roundMs - offset,
        onLock: (guess, touched) => { if (touched) online.submitGuess(code, i, guess).catch(() => {}); },
      });
    };

    const reveal = async (i) => {
      if (shown !== i) ask(i); // joined or reloaded during the reveal
      phase = 'reveal';
      ctl.lock(true);
      // Give last-second guesses time to land, then show everyone's.
      await new Promise((res) => setTimeout(res, 700));
      await refreshGuesses();
      if (shown !== i || location.hash !== hash) return;
      const round = guesses.filter((g) => g.round === i);
      const value = cards[i].value;
      const dist = (g) => Math.abs(Number(g.guess) - value);
      const bestDist = round.length ? Math.min(...round.map(dist)) : null;
      const winners = round.filter((g) => dist(g) === bestDist).map((g) => g.user_id);
      const mine = round.find((g) => g.user_id === me.id);
      await ctl.reveal({
        pins: round.map((g) => ({ name: g.user_id === me.id ? t('You') : name(g.user_id), guess: Number(g.guess), me: g.user_id === me.id })),
        message: !round.length ? t('Nobody guessed this one.')
          : winners.includes(me.id) ? t('You were closest! +{points}', { points: guessPoints(Number(mine.guess), value) })
            : `${t(winners.length > 1 ? '{names} were closest.' : '{names} was closest.', { names: winners.map(name).join(' & ') })} ${mine ? t('You: +{points}', { points: guessPoints(Number(mine.guess), value) }) : t('You did not guess.')}`,
      });
      audio.sfx(winners.includes(me.id) ? 'right' : 'tick');
      board?.replaceChildren(h('h2', {}, t('Points')), table(i));
    };

    const final = async () => {
      phase = 'final';
      clearInterval(loop);
      await refreshGuesses();
      if (location.hash !== hash) return;
      const ranking = totals(r.rounds - 1);
      const top = ranking[0]?.pts ?? 0;
      const winners = ranking.filter((row) => row.pts === top);
      const iWon = winners.some((row) => row.id === me.id);
      audio.sfx(iWon ? 'win' : 'gameover');
      mount(
        h('p', { class: 'kicker' }, `${r.is_public ? t('Public game') : t('Room {code}', { code })} · ${t('Closest guess')}`),
        h('h1', { class: 'screen-title' }, winners.length > 1 ? `🏆 ${t("It's a tie: {names}!", { names: winners.map((w) => w.name).join(' & ') })}` : iWon ? t('🏆 You win!') : `🏆 ${t('{name} wins!', { name: winners[0]?.name ?? '?' })}`),
        h('p', { class: 'big-score' }, h('span', {}, String(ranking.find((row) => row.id === me.id)?.pts ?? 0)), h('small', {}, t('of {n} points', { n: r.rounds * 100 }))),
        h('section', { class: 'box' }, h('h2', {}, t('Final standings')), table(r.rounds - 1)),
        h('div', { class: 'actions' },
          h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
            const res = r.is_public ? await online.quickMatch('guess') : await online.createRoom(r.category, 'guess');
            if (res.error) toast(res.error); else location.hash = `#/room/${res.code}`;
          } }, r.is_public ? t('Find another game') : t('New room')),
          h('a', { class: 'btn', href: '#/guess' }, t('Practise solo'))));
    };

    const ready = h('span', { class: 'countdown' });
    const step = () => {
      if (location.hash !== hash) return;
      const elapsed = now() - start;
      if (elapsed < 0) {
        if (phase !== 'ready') {
          phase = 'ready';
          audio.sfx('start');
          mount(h('p', { class: 'kicker' }, t('Closest guess')), h('h1', { class: 'screen-title' }, t('Get ready…')),
            h('p', { class: 'big-score' }, ready, h('small', {}, t('{rounds} cards · {seconds} seconds each', { rounds: r.rounds, seconds: r.round_seconds }))));
        }
        ready.textContent = String(Math.ceil(-elapsed / 1000));
        return;
      }
      const i = Math.floor(elapsed / period);
      if (i >= r.rounds) { if (phase !== 'final') final(); return; }
      const inRound = elapsed - i * period < roundMs;
      if (inRound && (shown !== i || phase !== 'ask')) ask(i);
      else if (!inRound && (shown !== i || phase === 'ask')) reveal(i);
    };
    const loop = setInterval(step, 200);
    cleanup.push(() => clearInterval(loop));
    await refreshGuesses();
    step();
  }

  let fanfare = false;
  function results() {
    const status = data.room.status;
    const top = ranking();
    const winners = status === 'finished' ? top.filter((p) => p.score === top[0].score) : [];
    const iWon = winners.some((p) => p.user_id === me.id);
    if (status === 'finished' && !fanfare) { fanfare = true; audio.sfx(iWon ? 'win' : 'gameover'); }
    mount(
      h('p', { class: 'kicker' }, t('Room {code}', { code })),
      h('h1', { class: 'screen-title' }, status !== 'finished' ? t('You are out!')
        : winners.length > 1 ? `🏆 ${t("It's a tie: {names}!", { names: winners.map((p) => p.username).join(' & ') })}`
          : iWon ? t('🏆 You win!') : `🏆 ${t('{name} wins!', { name: winners[0].username })}`),
      h('p', { class: 'big-score' }, h('span', {}, String(mine()?.score ?? 0)), h('small', {}, t('your score'))),
      h('p', { class: 'lede' }, status === 'finished' ? t('Game over for everyone.') : t('The others are still playing. Watch the standings live.')),
      h('section', { class: 'box' }, h('h2', {}, t('Standings')), standings(false)),
      h('div', { class: 'actions' },
        h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
          const res = data.room.is_public ? await online.quickMatch('standing') : await online.createRoom(data.room.category, 'standing');
          if (res.error) toast(res.error); else location.hash = `#/room/${res.code}`;
        } }, data.room.is_public ? t('Find another game') : t('New room')),
        h('a', { class: 'btn', href: '#/' }, t('Play solo'))));
  }

  render();
}

// ---------- router ----------
const ROUTES = {
  '': ['play', home], '#/': ['play', home], '#/endless': ['play', () => startEndless()], '#/guess': ['play', () => startGuess()], '#/friends': ['online', () => { location.hash = '#/online'; }],
  '#/daily': ['daily', startDaily], '#/daily/guess': ['daily', startDailyGuess], '#/leaderboard': ['leaderboard', leaderboard],
  '#/sources': ['sources', () => sources()], '#/settings': ['account', settings], '#/review': ['sources', review],
  '#/account': ['account', () => account()], '#/account/new': ['account', () => account('signup')], '#/online': ['online', friends],
};

function route() {
  for (const fn of cleanup) fn();
  cleanup = [];
  audio.setMood('calm');
  const hash = location.hash;
  let entry = ROUTES[hash];
  if (!entry && hash.startsWith('#/sources/')) entry = ['sources', () => sources(hash.slice(10))];
  if (!entry && /^#\/room\/[A-Za-z0-9]{6}$/.test(hash)) entry = ['online', () => room(hash.slice(7).toUpperCase())];
  if (!entry && /^#\/endless\/[a-z]+$/.test(hash) && CATEGORIES[hash.slice(10)]) entry = ['play', () => startEndless(hash.slice(10))];
  if (!entry && /^#\/guess\/[a-z]+$/.test(hash) && CATEGORIES[hash.slice(8)]) entry = ['play', () => startGuess(hash.slice(8))];
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

// One button mutes or unmutes everything; Settings has the separate switches.
function updateSoundButton() {
  const on = audio.soundEnabled() || audio.musicEnabled();
  for (const btn of document.querySelectorAll('[data-sound-toggle]')) {
    btn.replaceChildren(icon(on ? 'soundOn' : 'soundOff'));
    btn.setAttribute('aria-label', on ? t('Mute sound and music') : t('Turn sound and music on'));
    btn.setAttribute('aria-pressed', String(!on));
  }
}
for (const btn of document.querySelectorAll('[data-sound-toggle]')) {
  btn.addEventListener('click', () => {
    const on = !(audio.soundEnabled() || audio.musicEnabled());
    audio.setSound(on);
    audio.setMusic(on);
    updateSoundButton();
  });
}
// Static text in index.html, marked with data-i18n (text) and data-i18n-label (aria-label).
function translatePage() {
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-label]')) el.setAttribute('aria-label', t(el.dataset.i18nLabel));
  document.title = `PERCENTO: ${t(TAGLINE).replace(/\.$/, '').toLowerCase()}`;
}

audio.initAudio();
// The language loads first (a small file), then the first screen appears.
await initI18n();
translatePage();
updateSoundButton();
window.addEventListener('hashchange', route);
route();
// Online features load in the background; the game never waits for them.
online.onAuthChange(() => {
  updateAccountLink();
  const best = load(BEST_KEY, 0) || 0;
  online.myStats().then((d) => { if (d?.runs[0]?.score > best) save(BEST_KEY, d.runs[0].score); }).catch(() => {});
  // Back from an email link or Google: finish where the player was heading.
  const back = session.get(RETURN_KEY);
  if (online.currentUser() && back && location.hash.startsWith('#/account')) { session.remove(RETURN_KEY); location.hash = back; }
});
online.init().then(updateAccountLink);
