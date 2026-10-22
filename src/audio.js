// Sound effects and background music, synthesised with the Web Audio API
// (no audio files). Browsers only allow sound after a user gesture, so the
// context starts on the first tap or key press. Both are switchable in Settings.
import { load, save } from './storage.js';

const SFX_KEY = 'percento:sfx';
const MUSIC_KEY = 'percento:music';

let ctx = null;
let master = null;
let sfxBus = null;
let musicBus = null;
let sfxOn = load(SFX_KEY, true) !== false;
let musicOn = load(MUSIC_KEY, true) !== false;
let mood = 'calm';
let music = null;

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.9;
  const comp = ctx.createDynamicsCompressor();
  master.connect(comp).connect(ctx.destination);
  sfxBus = ctx.createGain();
  sfxBus.gain.value = 0.55;
  sfxBus.connect(master);
  musicBus = ctx.createGain();
  musicBus.gain.value = 0;
  musicBus.connect(master);
  return ctx;
}

/** Call once at startup: unlocks audio on the first user gesture. */
export function initAudio() {
  const unlock = () => {
    if (!ensure()) return;
    if (ctx.state === 'suspended') ctx.resume();
    if (musicOn) startMusic();
  };
  window.addEventListener('pointerdown', unlock, { once: false, passive: true });
  window.addEventListener('keydown', unlock, { once: false });
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) ctx.suspend(); else ctx.resume();
  });
}

export const soundEnabled = () => sfxOn;
export const musicEnabled = () => musicOn;

export function setSound(on) {
  sfxOn = on;
  save(SFX_KEY, on);
}

export function setMusic(on) {
  musicOn = on;
  save(MUSIC_KEY, on);
  if (on) { if (ensure()) { ctx.resume(); startMusic(); } } else stopMusic();
}

// ---------- effects ----------
function tone({ freq, to = freq, type = 'sine', start = 0, dur = 0.15, vol = 0.3, attack = 0.005, bus = sfxBus, detune = 0 }) {
  const t0 = ctx.currentTime + start;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.detune.value = detune;
  osc.frequency.setValueAtTime(freq, t0);
  if (to !== freq) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(bus);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

function noise({ start = 0, dur = 0.08, vol = 0.2, freq = 3000, q = 1, type = 'bandpass', bus = sfxBus }) {
  const t0 = ctx.currentTime + start;
  const len = Math.ceil(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(bus);
  src.start(t0);
}

const NOTE = (n) => 440 * 2 ** ((n - 69) / 12);

const EFFECTS = {
  tap: () => { tone({ freq: 720, to: 540, type: 'triangle', dur: 0.07, vol: 0.25 }); noise({ dur: 0.03, vol: 0.08, freq: 5000 }); },
  tick: () => tone({ freq: 1600, type: 'square', dur: 0.025, vol: 0.05 }),
  right: () => {
    [72, 76, 79, 84].forEach((n, i) => tone({ freq: NOTE(n), type: 'triangle', start: i * 0.07, dur: 0.32, vol: 0.22 }));
    tone({ freq: NOTE(96), type: 'sine', start: 0.28, dur: 0.5, vol: 0.06 });
  },
  wrong: () => {
    tone({ freq: 220, to: 110, type: 'sawtooth', dur: 0.45, vol: 0.12 });
    tone({ freq: 233, to: 116, type: 'square', dur: 0.45, vol: 0.06 });
    noise({ dur: 0.18, vol: 0.12, freq: 400, type: 'lowpass' });
  },
  timeout: () => [0, 0.16, 0.32].forEach((s) => tone({ freq: 880, type: 'square', start: s, dur: 0.1, vol: 0.08 })),
  hurry: () => tone({ freq: 1320, type: 'square', dur: 0.05, vol: 0.06 }),
  whoosh: () => noise({ dur: 0.35, vol: 0.12, freq: 1200, q: 0.7 }),
  gameover: () => [67, 63, 60, 55].forEach((n, i) => tone({ freq: NOTE(n), type: 'triangle', start: i * 0.16, dur: 0.4, vol: 0.18 })),
  win: () => {
    [60, 64, 67, 72, 67, 72, 76].forEach((n, i) => tone({ freq: NOTE(n), type: 'square', start: i * 0.11, dur: 0.22, vol: 0.09 }));
    [48, 55, 60].forEach((n) => tone({ freq: NOTE(n), type: 'triangle', start: 0.66, dur: 1.1, vol: 0.12 }));
  },
  start: () => [0, 0.5, 1].forEach((s, i) => tone({ freq: i === 2 ? 1320 : 660, type: 'square', start: s, dur: 0.14, vol: 0.08 })),
};

export function sfx(name) {
  if (!sfxOn || !ensure() || ctx.state !== 'running') return;
  EFFECTS[name]?.();
}

// ---------- music ----------
// A small generative loop: chords, bass, arpeggio and soft drums. `mood`
// 'calm' for menus and solo play, 'tense' (faster, busier) for online games.
const PROGRESSION = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]; // Am F C G

function startMusic() {
  if (music || !ctx) return;
  musicBus.gain.cancelScheduledValues(ctx.currentTime);
  musicBus.gain.setTargetAtTime(0.32, ctx.currentTime, 0.8);
  const lowpass = ctx.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = 2600;
  lowpass.connect(musicBus);
  let step = 0;
  let next = ctx.currentTime + 0.1;
  const play = () => {
    const bpm = mood === 'tense' ? 132 : 100;
    const sixteenth = 60 / bpm / 4;
    while (next < ctx.currentTime + 0.25) {
      const bar = Math.floor(step / 16) % PROGRESSION.length;
      const s = step % 16;
      const chord = PROGRESSION[bar];
      const t = next - ctx.currentTime;
      if (s === 0) chord.forEach((n) => tone({ freq: NOTE(n), type: 'triangle', start: t, dur: sixteenth * 15, vol: 0.035, attack: 0.08, bus: lowpass, detune: 6 }));
      if (s % 4 === 0 || (mood === 'tense' && s % 4 === 3)) tone({ freq: NOTE(chord[0] - 24), type: 'sine', start: t, dur: sixteenth * 3, vol: 0.16, bus: lowpass });
      if (s % 2 === 0) {
        const n = chord[(s / 2) % 3] + (s >= 8 ? 12 : 0);
        tone({ freq: NOTE(n + 12), type: 'square', start: t, dur: sixteenth * 1.2, vol: 0.018, bus: lowpass });
      }
      if (s === 0 || s === 8) tone({ freq: 120, to: 45, type: 'sine', start: t, dur: 0.18, vol: 0.22, bus: lowpass });
      if (s === 4 || s === 12) noise({ start: t, dur: 0.12, vol: 0.05, freq: 1800, bus: lowpass });
      if (mood === 'tense' || s % 4 === 2) noise({ start: t, dur: 0.03, vol: 0.025, freq: 8000, type: 'highpass', bus: lowpass });
      next += sixteenth;
      step++;
    }
  };
  const timer = setInterval(play, 60);
  play();
  music = { timer, lowpass };
}

function stopMusic() {
  if (!music) return;
  clearInterval(music.timer);
  musicBus.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
  const old = music;
  setTimeout(() => old.lowpass.disconnect(), 1500);
  music = null;
}

export function setMood(next) {
  mood = next;
}
