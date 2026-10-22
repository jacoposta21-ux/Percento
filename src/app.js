// PERCENTO app: routing, screens, side panel and the round engine shared by both modes.
import { ENTRIES, BUILD } from './data.js';
import { CATEGORIES, CATEGORY_IDS, RULES } from './config.js';
import { createPairGenerator, higherOf, mulberry32, hashString } from './pairs.js';
import { dailyPairs, romeDate, msUntilNextDaily, formatCountdown } from './daily.js';
import { createDial } from './dial.js';
import * as online from './online.js';
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
  online.recordRun(score).catch(() => {});
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
function boardList(rows, me) {
  if (!rows.length) return h('p', { class: 'board-empty' }, 'Nobody on the board yet. Be the first!');
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
    box.replaceChildren(h('h2', {}, 'Leaderboard ', h('small', {}, '(this device)')), leaderboardList(limit));
    return;
  }
  box.replaceChildren(h('h2', {}, 'World leaderboard'),
    boardList(rows.map((r) => ({ username: r.username, score: r.best })), online.currentUser()?.username));
}

function renderPanel() {
  const board = h('section', { class: 'box' }, h('h2', {}, 'Leaderboard'), leaderboardList(5));
  panel.replaceChildren(
    board,
    h('section', { class: 'box friends' },
      h('span', { class: 'friends-icon', 'aria-hidden': 'true' }, '👥'),
      h('h2', {}, 'Play with friends'),
      h('p', { class: 'muted' }, 'Up to 10 players, same cards, 15 seconds each. Last one standing wins.'),
      h('a', { class: 'btn btn-primary', href: '#/friends' }, 'Create a room')));
  online.init().then(() => worldBoard(board, 5));
}

// ---------- the round ----------
/**
 * Renders one pair. Options: pair, headline, pill {value, label}, progress (node),
 * onAnswer(correct), onContinue(correct), continueLabel, timeLimit (ms, optional).
 * A right answer moves on by itself; a wrong one waits for the button so the
 * player can read the sources. Running out of time counts as wrong.
 */
function renderRound({ pair, headline, pill, progress, onAnswer, onContinue, continueLabel = 'Continue', timeLimit = 0 }) {
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
  const clock = timeLimit ? h('div', { class: 'round-timer', role: 'timer', 'aria-label': 'Time left' },
    h('span', { class: 'round-timer-bar', style: `--t:${timeLimit}ms` }), h('b', {}, String(Math.ceil(timeLimit / 1000)))) : null;
  const duel = h('div', { class: 'duel' }, card('a'), h('div', { class: 'vs', 'aria-hidden': 'true' }, 'VS'), card('b'));
  dial.el.style.setProperty('--ca', colorOf(pair.a));
  dial.el.style.setProperty('--cb', colorOf(pair.b));

  mount(
    h('header', { class: 'round-head' },
      h('div', {}, h('p', { class: 'kicker' }, headline), h('h1', { class: 'screen-title' }, TITLE), h('p', { class: 'sub' }, INSTRUCTION)),
      pill ? h('div', { class: 'pill' }, h('span', { class: 'bolt', 'aria-hidden': 'true' }, '⚡'), h('span', {}, h('b', {}, String(pill.value)), h('small', {}, pill.label))) : null),
    clock,
    duel,
    h('div', { class: 'answers' }, dom.a.answer, dom.b.answer),
    h('div', { class: 'reveal' }, dial.el, h('div', { class: 'reveal-side' }, feedback, next)),
    progress);

  dial.describe('Percentometer, waiting for your pick');

  let countdown = null;
  if (timeLimit) {
    const deadline = Date.now() + timeLimit;
    countdown = setInterval(() => {
      const left = deadline - Date.now();
      clock.querySelector('b').textContent = String(Math.max(0, Math.ceil(left / 1000)));
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
    onAnswer?.(correct);
    for (const k of ['a', 'b']) { dom[k].pick.disabled = true; dom[k].answer.disabled = true; }
    if (id) dom[id].wrap.classList.add('chosen');
    feedback.textContent = id ? 'Measuring…' : '⏱ Time is up! Measuring…';
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
    feedback.textContent = id ? `${correct ? '✓' : '✗'} ${pickFrom(correct ? RIGHT_QUIPS : WRONG_QUIPS)}` : '⏱ Time is up! 15 seconds per card.';
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
      h('a', { class: 'btn', href: '#/friends' }, 'Challenge friends')),
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
  const world = h('section', { class: 'box' }, h('h2', {}, 'World leaderboard'), h('p', { class: 'muted' }, 'Loading…'));
  const today = romeDate();
  const daily = h('section', { class: 'box', style: 'margin-top:16px' }, h('h2', {}, `Today's Daily (${today})`), h('p', { class: 'muted' }, 'Loading…'));
  mount(
    h('h1', { class: 'screen-title' }, 'Leaderboard'),
    h('p', { class: 'lede' }, online.currentUser()
      ? `Playing as ${online.currentUser().username}. Your scores count on the world board.`
      : h('span', {}, 'Guests only appear on this device. ', h('a', { href: '#/account' }, 'Create an account'), ' to join the world board.')),
    world, daily,
    h('section', { class: 'box', style: 'margin-top:16px' }, h('h2', {}, 'This device: best Endless runs'), leaderboardList(10)),
    h('section', { class: 'box', style: 'margin-top:16px' }, h('h2', {}, 'This device: Daily history'),
      history.length
        ? h('ol', { class: 'board' }, history.slice(0, 14).map(([d, sc]) => h('li', {},
          h('span', { class: 'rank' }, '📅'), h('span', {}, ''), h('span', { class: 'who' }, d), h('span', { class: 'score' }, `${sc}/10`))))
        : h('p', { class: 'board-empty' }, 'No Daily Challenge played yet.')),
    h('div', { class: 'actions' }, h('a', { class: 'btn btn-primary', href: '#/' }, 'Play Endless'), h('a', { class: 'btn', href: '#/daily' }, 'Daily Challenge')));
  online.init().then(async (ok) => {
    const me = online.currentUser()?.username;
    const top = ok ? await online.topPlayers(10).catch(() => null) : null;
    const day = ok ? await online.dailyBoard(today).catch(() => null) : null;
    const offline = h('p', { class: 'board-empty' }, 'The world board is offline right now. Your games still count on this device.');
    world.replaceChildren(world.firstChild, top ? boardList(top.map((r) => ({ username: r.username, score: r.best, note: `${r.runs} runs` })), me) : offline);
    daily.replaceChildren(daily.firstChild, day ? boardList(day.map((r) => ({ username: r.username, score: `${r.score}/10` })), me) : offline.cloneNode(true));
  });
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

// ---------- account ----------
const RETURN_KEY = 'percento:returnTo';
// sessionStorage throws when the browser blocks storage; a lost return address is harmless.
const session = {
  get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* ignore */ } },
  remove: (k) => { try { sessionStorage.removeItem(k); } catch { /* ignore */ } },
};

function offlineNotice() {
  return h('p', { class: 'note' }, 'Accounts are unavailable right now (no connection to the PERCENTO server). You can keep playing as a guest.');
}

function field(label, attrs) {
  const input = h('input', { class: 'input', ...attrs });
  return [h('label', { class: 'field' }, h('span', {}, label), input), input];
}

async function account(tab = 'signin') {
  setKeys(null);
  mount(h('h1', { class: 'screen-title' }, 'Account'), h('p', { class: 'muted' }, 'Loading…'));
  const ok = await online.init();
  if (!location.hash.startsWith('#/account')) return;
  const me = online.currentUser();
  if (!ok) return mount(h('h1', { class: 'screen-title' }, 'Account'), offlineNotice(), settingsLink());
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
    const [nameField, name] = field('Player name', { name: 'username', autocomplete: 'nickname', required: true, minlength: 3, maxlength: 20, pattern: '[A-Za-z0-9_]+', placeholder: 'e.g. Jacopo_21' });
    const [mailField, mail] = field('Email', { type: 'email', name: 'email', autocomplete: 'email', required: true });
    const [passField, pass] = field('Password', { type: 'password', name: 'password', autocomplete: 'new-password', required: true, minlength: 6 });
    form = h('form', { class: 'box form', novalidate: true, onsubmit: async (ev) => {
      ev.preventDefault();
      message.className = 'form-message';
      if (!/^[A-Za-z0-9_]{3,20}$/.test(name.value)) { message.textContent = 'Player name: 3 to 20 letters, numbers or _.'; return; }
      if (!mail.validity.valid || !mail.value) { message.textContent = 'Enter a valid email.'; return; }
      if (pass.value.length < 6) { message.textContent = 'Password: at least 6 characters.'; return; }
      busy(form, true);
      if (await online.usernameTaken(name.value).catch(() => false)) {
        busy(form, false);
        message.textContent = 'That player name is taken. Try another one.';
        return;
      }
      const res = await online.signUp({ email: mail.value.trim(), password: pass.value, username: name.value });
      busy(form, false);
      if (res.error) { message.textContent = res.error; return; }
      if (res.confirm) {
        message.className = 'form-message ok';
        message.textContent = `Almost there! We sent a link to ${mail.value.trim()}. Open it to activate your account.`;
        return;
      }
      done();
    } }, nameField, mailField, passField, message, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Create account'));
  } else {
    const [mailField, mail] = field('Email', { type: 'email', name: 'email', autocomplete: 'email', required: true });
    const [passField, pass] = field('Password', { type: 'password', name: 'password', autocomplete: 'current-password', required: true });
    form = h('form', { class: 'box form', novalidate: true, onsubmit: async (ev) => {
      ev.preventDefault();
      message.className = 'form-message';
      if (!mail.value || !pass.value) { message.textContent = 'Enter your email and password.'; return; }
      busy(form, true);
      const res = await online.signIn({ email: mail.value.trim(), password: pass.value });
      busy(form, false);
      if (res.error) { message.textContent = res.error; return; }
      done();
    } }, mailField, passField, message, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Sign in'));
  }

  const google = h('button', { class: 'btn btn-google', type: 'button', onclick: async () => {
    const res = await online.signInWithGoogle();
    if (res.error) { message.textContent = res.error; }
  } }, h('span', { 'aria-hidden': 'true' }, 'G'), 'Continue with Google');

  mount(
    h('h1', { class: 'screen-title' }, tab === 'signup' ? 'Create your account' : 'Sign in'),
    h('p', { class: 'lede' }, 'Save your records on every device, climb the world leaderboard and play with friends. Or just keep playing as a guest.'),
    h('div', { class: 'tabs', role: 'tablist' },
      h('a', { href: '#/account', role: 'tab', 'aria-selected': String(tab !== 'signup'), class: tab !== 'signup' ? 'active' : '' }, 'Sign in'),
      h('a', { href: '#/account/new', role: 'tab', 'aria-selected': String(tab === 'signup'), class: tab === 'signup' ? 'active' : '' }, 'Create account')),
    form,
    h('div', { class: 'or' }, h('span', {}, 'or')),
    google,
    h('div', { class: 'actions' }, h('a', { class: 'btn', href: '#/' }, 'Keep playing as guest')),
    settingsLink());
}

const settingsLink = () => h('p', { class: 'muted small-links' }, h('a', { href: '#/settings' }, 'Settings'), ' · ', h('a', { href: '#/sources' }, 'Sources'));

async function profileScreen(me) {
  const stats = h('section', { class: 'box' }, h('h2', {}, 'Your records'), h('p', { class: 'muted' }, 'Loading…'));
  const message = h('p', { class: 'form-message', role: 'alert' });
  const [nameField, name] = field('Player name', { name: 'username', value: me.username, required: true, minlength: 3, maxlength: 20, pattern: '[A-Za-z0-9_]+' });
  mount(
    h('p', { class: 'kicker' }, 'Signed in'),
    h('h1', { class: 'screen-title' }, `Hi, ${me.username}!`),
    h('p', { class: 'lede' }, 'Your Endless runs and Daily Challenges are saved to your account.'),
    stats,
    h('form', { class: 'box form', style: 'margin-top:16px', onsubmit: async (ev) => {
      ev.preventDefault();
      if (!/^[A-Za-z0-9_]{3,20}$/.test(name.value)) { message.textContent = 'Player name: 3 to 20 letters, numbers or _.'; return; }
      const res = await online.rename(name.value);
      message.className = res.error ? 'form-message' : 'form-message ok';
      message.textContent = res.error || 'Saved.';
      updateAccountLink();
    } }, nameField, message, h('button', { class: 'btn', type: 'submit' }, 'Save name')),
    h('div', { class: 'actions' },
      h('a', { class: 'btn btn-primary', href: '#/friends' }, 'Play with friends'),
      h('button', { class: 'btn', type: 'button', onclick: async () => { await online.signOut(); toast('Signed out. Playing as guest.'); location.hash = '#/'; } }, 'Sign out')),
    settingsLink());
  const data = await online.myStats().catch(() => null);
  if (!stats.isConnected) return;
  if (!data) { stats.replaceChildren(stats.firstChild, h('p', { class: 'board-empty' }, 'Could not load your records right now.')); return; }
  const best = Math.max(data.runs[0]?.score ?? 0, load(BEST_KEY, 0) || 0);
  stats.replaceChildren(stats.firstChild,
    h('div', { class: 'stat-row' },
      h('p', {}, h('b', {}, String(best)), h('small', {}, 'Best Endless')),
      h('p', {}, h('b', {}, String(data.games)), h('small', {}, 'Endless games')),
      h('p', {}, h('b', {}, String(data.daily.filter((d) => d.answers.length === 10).length)), h('small', {}, 'Dailies played'))),
    data.daily.length ? h('ol', { class: 'board' }, data.daily.map((d) => h('li', {},
      h('span', { class: 'rank' }, '📅'), h('span', {}, ''), h('span', { class: 'who' }, d.day),
      h('span', { class: 'score' }, `${d.score}/${d.answers.length}`)))) : h('p', { class: 'board-empty' }, 'No Daily Challenge saved yet.'));
}

function updateAccountLink() {
  const me = online.currentUser();
  for (const el of document.querySelectorAll('[data-account-label]')) el.textContent = me ? me.username : 'Sign in';
}

/** Sends a guest to sign in, then back to `hash`. */
function needAccount(hash, title, why) {
  session.set(RETURN_KEY, hash);
  mount(h('h1', { class: 'screen-title' }, title), h('p', { class: 'lede' }, why),
    h('div', { class: 'actions' },
      h('a', { class: 'btn btn-primary', href: '#/account/new' }, 'Create account'),
      h('a', { class: 'btn', href: '#/account' }, 'Sign in'),
      h('a', { class: 'btn', href: '#/' }, 'Play solo as guest')));
}

// ---------- friends: rooms ----------
const ROOM_TIME_MS = 15000;

async function friends() {
  setKeys(null);
  mount(h('h1', { class: 'screen-title' }, 'Play with friends'), h('p', { class: 'muted' }, 'Loading…'));
  const ok = await online.init();
  if (location.hash !== '#/friends') return;
  if (!ok) return mount(h('h1', { class: 'screen-title' }, 'Play with friends'), offlineNotice());
  if (!online.currentUser()) {
    return needAccount('#/friends', 'Play with friends', 'Rooms need an account so everyone sees who is who. It takes 20 seconds.');
  }
  const message = h('p', { class: 'form-message', role: 'alert' });
  const [codeField, code] = field('Room code', { name: 'code', autocomplete: 'off', maxlength: 6, placeholder: 'ABC123', style: 'text-transform:uppercase' });
  mount(
    h('h1', { class: 'screen-title' }, 'Play with friends'),
    h('p', { class: 'lede' }, 'Up to 10 players get the same cards in the same order. 15 seconds per card. One mistake and you are out: whoever goes furthest wins.'),
    h('section', { class: 'box' },
      h('h2', {}, 'New room'),
      h('p', { class: 'muted' }, 'Create a room, send the link, start when everybody is in.'),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: async (ev) => {
        ev.currentTarget.disabled = true;
        const res = await online.createRoom();
        if (res.error) { message.textContent = res.error; ev.target.disabled = false; return; }
        location.hash = `#/room/${res.code}`;
      } }, 'Create a room')),
    h('form', { class: 'box form', style: 'margin-top:16px', onsubmit: (ev) => {
      ev.preventDefault();
      const c = code.value.trim().toUpperCase();
      if (!/^[A-Z0-9]{6}$/.test(c)) { message.textContent = 'Room codes have 6 letters or numbers.'; return; }
      location.hash = `#/room/${c}`;
    } }, h('h2', {}, 'Join a room'), codeField, h('button', { class: 'btn', type: 'submit' }, 'Join')),
    message);
}

async function room(code) {
  setKeys(null);
  const hash = `#/room/${code}`;
  mount(h('h1', { class: 'screen-title' }, `Room ${code}`), h('p', { class: 'muted' }, 'Connecting…'));
  const ok = await online.init();
  if (location.hash !== hash) return;
  if (!ok) return mount(h('h1', { class: 'screen-title' }, `Room ${code}`), offlineNotice());
  const me = online.currentUser();
  if (!me) return needAccount(hash, `Join room ${code}`, 'Your friend invited you to a PERCENTO room. Sign in or create an account to join.');

  let data = await online.fetchRoom(code);
  if (location.hash !== hash) return;
  if (!data) return mount(h('h1', { class: 'screen-title' }, 'Room not found'), h('p', { class: 'lede' }, `There is no room ${code}. Check the code with your friend.`), h('div', { class: 'actions' }, h('a', { class: 'btn btn-primary', href: '#/friends' }, 'Back')));
  if (!data.players.some((p) => p.user_id === me.id) && data.room.status === 'lobby') {
    const res = await online.joinRoom(code);
    if (res.error) return mount(h('h1', { class: 'screen-title' }, `Room ${code}`), h('p', { class: 'lede' }, res.error), h('div', { class: 'actions' }, h('a', { class: 'btn btn-primary', href: '#/friends' }, 'Back')));
    data = await online.fetchRoom(code);
  }

  let view = null; // 'lobby' | 'playing' | 'standings'
  let standingsBox = null;
  const mine = () => data.players.find((p) => p.user_id === me.id);

  const ranking = () => [...data.players].sort((a, b) => b.score - a.score || Number(b.alive) - Number(a.alive));
  const standings = (compact) => h('ol', { class: 'board room-board' }, ranking().slice(0, compact ? 4 : 10).map((p, i) => h('li', { class: p.user_id === me.id ? 'me' : '' },
    h('span', { class: `rank rank-${i + 1}` }, String(i + 1)),
    h('span', { 'aria-hidden': 'true' }, p.alive && data.room.status === 'playing' ? '🔥' : (i === 0 && data.room.status === 'finished' ? '🏆' : '•')),
    h('span', { class: 'who' }, p.username, h('small', {}, { lobby: p.user_id === data.room.host_id ? 'host' : 'ready', playing: p.alive ? 'still playing' : 'out', finished: 'final score' }[data.room.status])),
    h('span', { class: 'score' }, String(p.score)))));

  const refresh = async () => {
    const next = await online.fetchRoom(code).catch(() => null);
    if (!next || location.hash !== hash) return;
    data = next;
    render();
  };
  cleanup.push(online.watchRoom(data.room.id, refresh));

  function render() {
    const status = data.room.status;
    const player = mine();
    // Mid-game, updates only refresh the live standings; the round is never interrupted.
    if (view === 'playing') { standingsBox?.replaceChildren(standings(true)); return; }
    if (status === 'lobby') return lobby();
    if (status === 'playing' && player?.alive && !out) return play();
    view = 'standings';
    results();
  }

  function lobby() {
    view = 'lobby';
    const isHost = data.room.host_id === me.id;
    const link = `${shareUrl()}#/room/${code}`;
    mount(
      h('p', { class: 'kicker' }, 'Waiting room'),
      h('h1', { class: 'screen-title' }, `Room ${code}`),
      h('p', { class: 'lede' }, `${data.players.length} of ${online.ROOM_SIZE} players. Same cards for everyone, 15 seconds each, last one standing wins.`),
      h('div', { class: 'actions' },
        h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
          const r = await shareResult(`Join my PERCENTO room ${code}: which percentage is higher? ${link}`);
          if (r === 'copied') toast('Invite link copied!'); else if (r === 'failed') toast(`Room code: ${code}`);
        } }, 'Invite friends'),
        isHost ? h('button', { class: 'btn', type: 'button', disabled: data.players.length < 2, onclick: async (ev) => {
          ev.currentTarget.disabled = true;
          const res = await online.startRoom(code);
          if (res.error) toast(res.error);
          refresh();
        } }, data.players.length < 2 ? 'Start (needs 2 players)' : 'Start the game') : h('p', { class: 'muted' }, 'Waiting for the host to start…')),
      h('section', { class: 'box' }, h('h2', {}, 'Players'), standings(false)));
  }

  let out = false;
  let pending = Promise.resolve();
  const leave = () => { out = true; view = 'standings'; results(); pending.finally(refresh); };

  function play() {
    view = 'playing';
    const gen = createPairGenerator(ENTRIES, mulberry32(Number(data.room.seed)));
    let score = mine().score;
    // Resume after a reload: skip the pairs already answered.
    for (let i = 0; i < score; i++) gen.next();
    const round = () => {
      const pair = gen.next();
      if (!pair) { pending = online.reportScore(code, score, false); leave(); return; }
      standingsBox = h('div', { class: 'box room-live' }, standings(true));
      renderRound({
        pair,
        headline: `Room ${code} · last one standing wins`,
        pill: { value: score, label: 'Your score' },
        progress: standingsBox,
        timeLimit: ROOM_TIME_MS,
        onAnswer: (correct) => {
          if (correct) score++;
          pending = online.reportScore(code, score, correct).catch(() => {});
        },
        onContinue: (correct) => (correct ? round() : leave()),
        continueLabel: 'See standings',
      });
    };
    round();
  }

  function results() {
    const status = data.room.status;
    const top = ranking();
    const winners = status === 'finished' ? top.filter((p) => p.score === top[0].score) : [];
    const iWon = winners.some((p) => p.user_id === me.id);
    mount(
      h('p', { class: 'kicker' }, `Room ${code}`),
      h('h1', { class: 'screen-title' }, status === 'finished' ? (iWon ? '🏆 You win!' : `🏆 ${winners.map((p) => p.username).join(' & ')} wins!`) : 'You are out!'),
      h('p', { class: 'big-score' }, h('span', {}, String(mine()?.score ?? 0)), h('small', {}, 'your score')),
      h('p', { class: 'lede' }, status === 'finished' ? 'Game over for everyone.' : 'The others are still playing. Watch the standings live.'),
      h('section', { class: 'box' }, h('h2', {}, 'Standings'), standings(false)),
      h('div', { class: 'actions' },
        h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
          const res = await online.createRoom();
          if (res.error) toast(res.error); else location.hash = `#/room/${res.code}`;
        } }, 'New room'),
        h('a', { class: 'btn', href: '#/' }, 'Play solo')));
  }

  render();
}

// ---------- router ----------
const ROUTES = {
  '': ['play', startEndless], '#/': ['play', startEndless], '#/endless': ['play', startEndless],
  '#/daily': ['daily', startDaily], '#/leaderboard': ['leaderboard', leaderboard],
  '#/sources': ['sources', () => sources()], '#/settings': ['account', settings], '#/review': ['sources', review],
  '#/account': ['account', () => account()], '#/account/new': ['account', () => account('signup')], '#/friends': ['friends', friends],
};

function route() {
  for (const fn of cleanup) fn();
  cleanup = [];
  const hash = location.hash;
  let entry = ROUTES[hash];
  if (!entry && hash.startsWith('#/sources/')) entry = ['sources', () => sources(hash.slice(10))];
  if (!entry && /^#\/room\/[A-Za-z0-9]{6}$/.test(hash)) entry = ['friends', () => room(hash.slice(7).toUpperCase())];
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
