// PERCENTO app: routing, screens and the round engine shared by both modes.
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
const dailyKey = (date) => `percento:daily:${date}`;
const app = document.getElementById('app');
let cleanup = [];
let keyHandler = null;

// ---------- tiny DOM helper ----------
function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v === null || v === undefined) continue;
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) node.append(c.nodeType ? c : String(c));
  return node;
}

export const formatValue = (v) => `${Number.isInteger(v) ? v : v.toFixed(1)}%`;
const formatReading = (reading, target) => `${Number.isInteger(target) ? Math.round(reading) : reading.toFixed(1)}%`;
const pickFrom = (list, rng = Math.random) => list[Math.floor(rng() * list.length)];

function toast(message) {
  const region = document.getElementById('toast');
  region.textContent = message;
  region.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => region.classList.remove('show'), 2600);
}

function screen(title, ...children) {
  const heading = h('h1', { class: 'screen-title', tabindex: '-1' }, title);
  app.replaceChildren(heading, ...children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false));
  heading.focus({ preventScroll: true });
  window.scrollTo(0, 0);
  return heading;
}

const playable = (pool) => pool.length >= 2 && createPairGenerator(pool, mulberry32(1)).next() !== null;

function calibrating() {
  screen('The Percentometer is calibrating',
    h('p', { class: 'lede' }, 'There are not enough verified statistics to play yet. Every number in PERCENTO has to be checked against its official source before it can appear here.'),
    h('p', {}, h('a', { class: 'btn', href: '#/' }, 'Back home')));
}

// ---------- the round ----------
/**
 * Renders one pair. Options:
 *  pair, headline, status (string), showA (champion value already known),
 *  onAnswer(correct) (called before the reveal, e.g. to persist), onContinue(correct), continueLabel
 */
function renderRound({ pair, headline, status, showA, onAnswer, onContinue, continueLabel = 'Continue' }) {
  const dial = createDial();
  const cards = { a: pair.a, b: pair.b };
  let phase = 'ask';
  let correct = false;
  const dom = {};

  const card = (id) => {
    const e = cards[id];
    const value = h('span', { class: 'card-value', 'aria-live': 'off' }, id === 'a' && showA ? formatValue(e.value) : '?');
    const pick = h('button', {
      class: 'card-pick',
      type: 'button',
      'aria-label': `${id === 'a' ? 'First' : 'Second'} card: ${e.text}${id === 'a' && showA ? `, ${formatValue(e.value)}` : ''}. Pick as higher.`,
      onclick: () => choose(id),
    },
    h('span', { class: 'card-cat' }, `${CATEGORIES[e.category].emoji} ${CATEGORIES[e.category].label}`),
    h('span', { class: 'card-text' }, e.text),
    value,
    h('span', { class: 'card-key', 'aria-hidden': 'true' }, id === 'a' ? '1 · ↑' : '2 · ↓'));
    const source = h('p', { class: 'card-source', hidden: true },
      'Source: ', h('a', { href: e.sourceUrl, target: '_blank', rel: 'noopener' }, e.source), ` · ${e.year}`);
    const wrap = h('div', { class: `card card-${id}` }, pick, source);
    dom[id] = { wrap, pick, value, source };
    return wrap;
  };

  const feedback = h('p', { class: 'feedback', role: 'status', 'aria-live': 'polite' });
  const next = h('button', { class: 'btn btn-primary continue', type: 'button', hidden: true, onclick: () => advance() }, continueLabel);

  screen(headline,
    h('p', { class: 'instruction' }, INSTRUCTION),
    status ? h('p', { class: 'status' }, status) : null,
    h('div', { class: 'arena' }, card('a'), h('div', { class: 'dial-wrap' }, dial.el), card('b')),
    feedback,
    h('div', { class: 'actions' }, next));

  if (showA) dial.show('a', pair.a.value);
  dial.describe(showA ? `Percentometer showing the first card at ${formatValue(pair.a.value)}` : 'Percentometer, waiting for your pick');

  async function choose(id) {
    if (phase !== 'ask') return;
    phase = 'reveal';
    const other = id === 'a' ? 'b' : 'a';
    correct = cards[id].value > cards[other].value;
    onAnswer?.(correct);
    dom.a.pick.disabled = true;
    dom.b.pick.disabled = true;
    dom[id].wrap.classList.add('chosen');
    const swings = [];
    for (const k of ['a', 'b']) {
      if (k === 'a' && showA) continue;
      const target = cards[k].value;
      swings.push(dial.swing(k, target, (r) => { dom[k].value.textContent = formatReading(r, target); }));
    }
    await Promise.all(swings);
    for (const k of ['a', 'b']) {
      dom[k].value.textContent = formatValue(cards[k].value);
      dom[k].source.hidden = false;
    }
    const high = higherOf(pair) === pair.a ? 'a' : 'b';
    dom[high].wrap.classList.add('higher');
    dom[high === 'a' ? 'b' : 'a'].wrap.classList.add('lower');
    dial.describe(`Percentometer: first card ${formatValue(pair.a.value)}, second card ${formatValue(pair.b.value)}`);
    feedback.className = `feedback ${correct ? 'ok' : 'ko'}`;
    feedback.textContent = `${correct ? '✓' : '✗'} ${pickFrom(correct ? RIGHT_QUIPS : WRONG_QUIPS)}`;
    next.hidden = false;
    next.focus({ preventScroll: true });
    phase = 'done';
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

function setKeys(handler) {
  if (keyHandler) document.removeEventListener('keydown', keyHandler);
  keyHandler = handler;
  if (handler) document.addEventListener('keydown', handler);
}

// ---------- endless ----------
// One generator per page session, so pairs never repeat across runs either.
let sessionGen = null;
const headlineRng = Math.random;

function startEndless() {
  if (!playable(ENTRIES)) return calibrating();
  if (!sessionGen) sessionGen = createPairGenerator(ENTRIES, Math.random);
  let champion = null;
  let score = 0;
  let best = load(BEST_KEY, 0) || 0;

  const round = () => {
    const pair = sessionGen.next(champion);
    if (!pair) return endlessOver(score, best, true);
    renderRound({
      pair,
      headline: pickFrom(HEADLINES, headlineRng),
      status: `Score ${score} · Best ${best}`,
      showA: champion !== null && !pair.fresh,
      onContinue: (correct) => {
        if (!correct) return endlessOver(score, best, false);
        score++;
        if (score > best) { best = score; save(BEST_KEY, best); }
        champion = higherOf(pair);
        round();
      },
    });
  };
  round();
}

function endlessOver(score, best, exhausted) {
  setKeys((ev) => { if (ev.key === 'Enter') { ev.preventDefault(); startEndless(); } });
  const newBest = score > 0 && score >= best;
  screen(exhausted ? 'You ran out of statistics!' : 'Game over',
    h('p', { class: 'big-score' }, h('span', {}, String(score)), h('small', {}, score === 1 ? 'correct answer' : 'correct answers')),
    h('p', { class: 'lede' }, exhausted ? 'Every legal pair has been played. The Percentometer needs a nap.' : pickByScore(GAME_OVER_LINES, score, Math.floor(Math.random() * 2))),
    h('p', { class: 'status' }, newBest ? `New personal best: ${best}!` : `Personal best: ${best}`),
    storageAvailable() ? null : h('p', { class: 'note' }, 'Your browser blocks storage, so your best score lasts only until you close this tab.'),
    h('div', { class: 'actions' },
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => startEndless() }, 'Play again'),
      h('a', { class: 'btn', href: '#/daily' }, 'Daily Challenge'),
      h('a', { class: 'btn', href: '#/' }, 'Home')));
}

// ---------- daily ----------
function startDaily() {
  const date = romeDate();
  const pairs = dailyPairs(ENTRIES, date);
  if (pairs.length < RULES.dailyPairs) return calibrating();
  const state = load(dailyKey(date), null) || { answers: [] };
  // Headlines are deterministic too, so every player sees the same challenge.
  const rng = mulberry32(hashString(`percento-headlines:${date}`));
  const headlines = pairs.map(() => pickFrom(HEADLINES, rng));

  const round = (i) => {
    if (i >= pairs.length) return dailyResults(date, pairs, state.answers);
    const pair = pairs[i];
    renderRound({
      pair,
      headline: headlines[i],
      status: `Daily ${date} · Pair ${i + 1} of ${pairs.length}`,
      showA: i > 0 && !pair.fresh,
      continueLabel: i === pairs.length - 1 ? 'See results' : 'Next pair',
      onAnswer: (correct) => {
        state.answers[i] = correct;
        save(dailyKey(date), state);
      },
      onContinue: () => round(i + 1),
    });
  };
  round(state.answers.length);
}

function dailyResults(date, pairs, answers) {
  const score = answers.filter(Boolean).length;
  const url = `${location.origin}${location.pathname}#/daily`;
  const text = shareText({ date, answers, url });
  const countdown = h('span', { class: 'countdown' }, formatCountdown(msUntilNextDaily()));
  const timer = setInterval(() => {
    const left = msUntilNextDaily();
    countdown.textContent = formatCountdown(left);
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

  screen(`Daily ${date}`,
    h('p', { class: 'big-score' }, h('span', {}, `${score}/${answers.length}`), h('small', {}, 'pairs right')),
    h('p', { class: 'grid', 'aria-label': answers.map((a, i) => `Pair ${i + 1} ${a ? 'right' : 'wrong'}`).join(', ') }, answers.map((a) => (a ? '🟩' : '🟥')).join('')),
    h('p', { class: 'lede' }, pickByScore(DAILY_END_LINES, score)),
    h('pre', { class: 'share-text', 'aria-label': 'Share text' }, text),
    h('div', { class: 'actions' },
      h('button', { class: 'btn btn-primary', type: 'button', onclick: doShare }, 'Share result'),
      h('a', { class: 'btn', href: '#/endless' }, 'Play Endless')),
    h('p', { class: 'status' }, 'Next challenge in ', countdown, ' (midnight, Rome time)'),
    h('h2', {}, "Today's pairs"),
    h('ol', { class: 'recap' }, pairs.map((p, i) => h('li', { class: answers[i] ? 'ok' : 'ko' },
      `${answers[i] ? '🟩' : '🟥'} ${p.a.text} (${formatValue(p.a.value)}) vs ${p.b.text} (${formatValue(p.b.value)})`))));
}

// ---------- home, sources, review ----------
function home() {
  const best = load(BEST_KEY, 0) || 0;
  const date = romeDate();
  const daily = load(dailyKey(date), null);
  const dailyDone = daily && daily.answers.length >= RULES.dailyPairs;
  setKeys(null);
  screen('PERCENTO',
    h('p', { class: 'tagline' }, TAGLINE),
    h('p', { class: 'lede' }, 'Two real, verified percentages about things that have nothing to do with each other. Pick the higher one. The Percentometer reveals the truth.'),
    h('div', { class: 'menu' },
      h('a', { class: 'btn btn-primary btn-big', href: '#/endless' }, h('strong', {}, 'Endless'), h('small', {}, best ? `Personal best: ${best}` : 'One wrong answer ends the run')),
      h('a', { class: 'btn btn-big', href: '#/daily' }, h('strong', {}, 'Daily Challenge'), h('small', {}, dailyDone ? `Done today: ${daily.answers.filter(Boolean).length}/${RULES.dailyPairs}` : '10 pairs, same for everyone, once a day')),
      h('a', { class: 'btn btn-big', href: '#/sources' }, h('strong', {}, 'Sources'), h('small', {}, `Every statistic, with link and year`))),
    h('p', { class: 'note' }, 'Keyboard: 1 / ↑ picks the first card, 2 / ↓ the second, Enter continues.'));
}

function sources() {
  setKeys(null);
  const byCat = CATEGORY_IDS.map((c) => [c, ENTRIES.filter((e) => e.category === c).sort((a, b) => a.text.localeCompare(b.text))]).filter(([, l]) => l.length);
  screen('Sources',
    h('p', { class: 'lede' }, `All ${ENTRIES.length} statistics in the game, each from an official statistics office, international agency, space agency, major survey or peer-reviewed study.`),
    ENTRIES.length ? null : h('p', {}, 'No statistics are published yet.'),
    byCat.map(([c, list]) => h('section', { class: 'source-group' },
      h('h2', {}, `${CATEGORIES[c].emoji} ${CATEGORIES[c].label} (${list.length})`),
      h('ul', { class: 'source-list' }, list.map((e) => h('li', {},
        h('span', { class: 'source-text' }, e.text), ' ',
        h('strong', {}, formatValue(e.value)), ' · ',
        h('a', { href: e.sourceUrl, target: '_blank', rel: 'noopener' }, e.source), ` · ${e.year}`,
        e.status === 'unverified' ? h('span', { class: 'badge' }, 'unverified') : null))))));
}

function review() {
  setKeys(null);
  if (BUILD.mode !== 'dev') return home();
  const list = ENTRIES.filter((e) => e.status === 'unverified');
  screen('Review mode',
    h('p', { class: 'lede' }, `Dev build: ${list.length} unverified of ${ENTRIES.length} entries. Production serves verified entries only.`),
    h('ul', { class: 'source-list' }, list.map((e) => h('li', {},
      h('span', { class: 'source-text' }, `[${e.id}] ${e.text}`), ' ', h('strong', {}, formatValue(e.value)), ' · ',
      h('a', { href: e.sourceUrl, target: '_blank', rel: 'noopener' }, e.source), ` · ${e.year}`,
      h('br'), h('small', {}, e.reviewReason)))));
}

// ---------- router ----------
const ROUTES = { '': home, '#/': home, '#/endless': startEndless, '#/daily': startDaily, '#/sources': sources, '#/review': review };

function route() {
  for (const fn of cleanup) fn();
  cleanup = [];
  (ROUTES[location.hash] || home)();
}

if (BUILD.mode === 'dev') {
  document.body.prepend(h('p', { class: 'dev-banner' }, 'DEV BUILD: includes unverified statistics. ', h('a', { href: '#/review' }, 'Review mode')));
}
window.addEventListener('hashchange', route);
route();
