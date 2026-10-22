// Online layer: accounts, saved progress, global leaderboards and friend rooms,
// backed by Supabase. Everything here is optional: if the client cannot load
// or the network is down, the game keeps working as a guest on this device.
import { SUPABASE_URL, SUPABASE_KEY, SUPABASE_SCRIPT } from './online-config.js';
import { load, save } from './storage.js';
import { t } from './i18n.js';

let client = null;
let ready = null;
let user = null;
let profile = null;
const listeners = new Set();

// Auth storage on top of the safe storage wrapper, so a blocked localStorage
// still allows a session for the lifetime of the tab.
const authStorage = {
  getItem: (k) => load(k, null),
  setItem: (k, v) => save(k, v),
  removeItem: (k) => save(k, null),
};

function loadScript(src) {
  if (window.supabase) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load the online client'));
    document.head.append(s);
  });
}

async function refreshProfile() {
  profile = null;
  if (user) {
    const { data } = await client.from('profiles').select('id, username').eq('id', user.id).maybeSingle();
    profile = data;
  }
  for (const fn of listeners) fn();
}

/** Loads the client and the current session. Resolves to true when online works. */
export function init() {
  ready ||= (async () => {
    try {
      await loadScript(SUPABASE_SCRIPT);
      client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { flowType: 'pkce', storage: authStorage, persistSession: true, detectSessionInUrl: true },
      });
      const { data } = await client.auth.getSession();
      user = data.session?.user ?? null;
      await refreshProfile();
      client.auth.onAuthStateChange((_event, session) => {
        const next = session?.user ?? null;
        if (next?.id === user?.id) return;
        user = next;
        // Outside the callback: supabase-js forbids awaiting its own calls in here.
        setTimeout(refreshProfile, 0);
      });
      // Remove the one-time ?code= of an email or Google sign-in from the address bar.
      if (new URLSearchParams(location.search).has('code')) history.replaceState(null, '', location.pathname + location.hash);
      return true;
    } catch {
      client = null;
      return false;
    }
  })();
  return ready;
}

export const isOnline = () => client !== null;
export const currentUser = () => (user && profile ? { id: user.id, email: user.email, username: profile.username, guest: Boolean(user.is_anonymous) } : null);
export function onAuthChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const fail = (error) => {
  if (!error) return null;
  const m = error.message || String(error);
  if (/provider is not enabled|Unsupported provider/i.test(m)) return t('Google sign-in is not switched on yet. Use email and password for now.');
  if (/anonymous sign-ins are disabled/i.test(m)) return t('Guest play is not switched on yet. Create an account for now.');
  if (/Invalid login credentials/i.test(m)) return t('Wrong email or password.');
  if (/Email not confirmed/i.test(m)) return t('Confirm your email first: check your inbox for our link.');
  if (/already registered/i.test(m)) return t('This email already has an account. Sign in instead.');
  if (/rate limit/i.test(m)) return t('Too many emails sent. Try again in a few minutes.');
  if (/not authorized/i.test(m)) return t('We cannot send confirmation emails to this address yet. Try Google, or ask the PERCENTO team.');
  return m;
};

// Loads the profile before returning, so the next screen already sees the player.
async function adopt(session) {
  user = session?.user ?? null;
  await refreshProfile();
}

const redirectTo = () => `${location.origin}${location.pathname}`;

// ---------- accounts ----------
export async function usernameTaken(username) {
  const { data } = await client.from('profiles').select('id').ilike('username', username.replace(/[%_\\]/g, '\\$&')).limit(1);
  return Boolean(data?.length);
}

export async function signUp({ email, password, username }) {
  const { data, error } = await client.auth.signUp({ email, password, options: { data: { username }, emailRedirectTo: redirectTo() } });
  if (error) return { error: fail(error) };
  // No session means Supabase sent a confirmation email first.
  if (!data.session) return { confirm: true };
  await adopt(data.session);
  return {};
}

export async function signIn({ email, password }) {
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) return { error: fail(error) };
  await adopt(data.session);
  return {};
}

export async function signInWithGoogle() {
  const { error } = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: redirectTo() } });
  return { error: fail(error) };
}

/** Online play without an account: an anonymous player with just a nickname. */
export async function signInAsGuest(nickname) {
  const { data, error } = await client.auth.signInAnonymously({ options: { data: { username: nickname } } });
  if (error) return { error: fail(error) };
  await adopt(data.session);
  return {};
}

/** Turns a guest into a full account, keeping their name and records. */
export async function upgradeGuest({ email, password }) {
  const { error } = await client.auth.updateUser({ email, password }, { emailRedirectTo: redirectTo() });
  if (error) return { error: fail(error) };
  const { data } = await client.auth.getUser();
  if (data?.user) user = data.user;
  return { confirm: !data?.user?.email_confirmed_at && Boolean(data?.user?.new_email || data?.user?.email) };
}

export async function signOut() {
  await client.auth.signOut();
  user = null;
  profile = null;
  for (const fn of listeners) fn();
}

export async function rename(username) {
  const { error } = await client.from('profiles').update({ username }).eq('id', user.id);
  if (error) return { error: /duplicate|unique/i.test(error.message) ? 'That name is taken.' : fail(error) };
  await refreshProfile();
  return {};
}

// ---------- solo progress ----------
export async function recordRun(score) {
  if (!currentUser()) return;
  await client.from('runs').insert({ score });
}

export async function myStats() {
  if (!currentUser()) return null;
  const { data } = await client.from('runs').select('score, created_at').eq('user_id', user.id).order('score', { ascending: false }).limit(10);
  const { count } = await client.from('runs').select('id', { count: 'exact', head: true }).eq('user_id', user.id);
  const { data: daily } = await client.from('daily_results').select('day, score, answers').eq('user_id', user.id).order('day', { ascending: false }).limit(14);
  return { runs: data || [], games: count || 0, daily: daily || [] };
}

export async function saveDaily(day, answers) {
  if (!currentUser()) return;
  await client.from('daily_results').upsert({ user_id: user.id, day, answers, score: answers.filter(Boolean).length, updated_at: new Date().toISOString() });
}

export async function loadDaily(day) {
  if (!currentUser()) return null;
  const { data } = await client.from('daily_results').select('answers').eq('user_id', user.id).eq('day', day).maybeSingle();
  return data?.answers ?? null;
}

// ---------- leaderboards ----------
export async function topPlayers(limit = 10) {
  const { data, error } = await client.from('leaderboard').select('username, best, runs').order('best', { ascending: false }).limit(limit);
  return error ? null : data;
}

export async function dailyBoard(day, limit = 10) {
  const { data, error } = await client.from('daily_results').select('score, answers, profiles(username)').eq('day', day)
    .order('score', { ascending: false }).order('updated_at', { ascending: true }).limit(limit);
  return error ? null : data.filter((r) => r.answers.length === 10).map((r) => ({ username: r.profiles?.username ?? '?', score: r.score }));
}

// ---------- friend rooms ----------
/** mode: 'standing' (last one standing) or 'guess' (closest guess). */
export async function createRoom(category = null, mode = 'standing') {
  const { data, error } = await client.rpc('create_room', { room_category: category, room_mode: mode });
  return error ? { error: fail(error) } : { code: data };
}

/** Joins the next public game of `mode` with strangers (or opens one). */
export async function quickMatch(mode = 'standing') {
  const { data, error } = await client.rpc('quick_match', { room_mode: mode });
  return error ? { error: fail(error) } : { code: data };
}

/** Milliseconds to add to Date.now() to get the server clock (rounds run on it). */
export async function serverOffset() {
  const t0 = Date.now();
  const { data, error } = await client.rpc('server_time');
  if (error || !data) return 0;
  return Date.parse(data) - (t0 + Date.now()) / 2;
}

export async function submitGuess(code, round, value) {
  const { error } = await client.rpc('submit_guess', { room_code: code, round_no: round, value });
  return { error: fail(error) };
}

/** Every guess this player may see: their own, and everyone's for finished rounds. */
export async function fetchGuesses(roomId) {
  const { data } = await client.from('room_guesses').select('user_id, round, guess').eq('room_id', roomId);
  return data || [];
}

export async function heartbeat(code) {
  await client.rpc('room_heartbeat', { room_code: code });
}

export async function leaveRoom(code) {
  await client.rpc('leave_room', { room_code: code });
}

export async function joinRoom(code) {
  const { error } = await client.rpc('join_room', { room_code: code });
  return { error: fail(error) };
}

export async function startRoom(code) {
  const { error } = await client.rpc('start_room', { room_code: code });
  return { error: fail(error) };
}

export async function reportScore(code, score, alive) {
  await client.rpc('report_room_score', { room_code: code, new_score: score, still_alive: alive });
}

export async function fetchRoom(code) {
  const { data: room } = await client.from('rooms').select('id, code, host_id, seed, status, started_at, starts_at, is_public, category, mode, round_seconds, reveal_seconds, rounds').eq('code', code).maybeSingle();
  if (!room) return null;
  const { data: players } = await client.from('room_players').select('user_id, username, score, alive, finished_at, joined_at')
    .eq('room_id', room.id).order('joined_at');
  return { room, players: players || [] };
}

/** Calls onChange whenever the room or its players change. Returns an unsubscribe function. */
export function watchRoom(roomId, onChange) {
  const channel = client.channel(`room-${roomId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'room_players', filter: `room_id=eq.${roomId}` }, onChange)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` }, onChange)
    .subscribe();
  // Realtime can miss events on flaky phones: a slow poll keeps the room honest.
  const poll = setInterval(onChange, 5000);
  return () => { clearInterval(poll); client.removeChannel(channel); };
}

export const ROOM_SIZE = 10;

// ---------- what everybody answered ----------
// These work without signing in: they only add to (or read) shared counters.
const ready_ = () => client !== null;

/** { plays, hits, guess_sum, miss_sum } for one pair key or card id (zeros when nobody answered yet); null when offline. */
export async function answerStats(key) {
  if (!ready_()) return null;
  const { data, error } = await client.from('answer_stats').select('plays, hits, guess_sum, miss_sum').eq('key', key).maybeSingle();
  if (error) return null;
  return data ?? { plays: 0, hits: 0, guess_sum: 0, miss_sum: 0 };
}

export async function recordPair(key, correct) {
  if (ready_()) await client.rpc('record_pair', { pair_key: key, correct });
}

export async function recordGuess(cardId, guess, miss) {
  if (ready_()) await client.rpc('record_guess', { card_id: cardId, guess, miss });
}

/** game: 'pairs' or 'guess'. */
export async function recordDaily(day, game, score) {
  if (ready_()) await client.rpc('record_daily', { day, game, score });
}

/** [{ score, players }] for a day's challenge, or null when offline. */
export async function dailyCounts(day, game) {
  if (!ready_()) return null;
  const { data, error } = await client.from('daily_counts').select('score, players').eq('day', day).eq('game', game);
  return error ? null : data;
}
