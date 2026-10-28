// Playgama Bridge SDK, used only by the Playgama build: scripts/build.mjs
// ships this file as src/portal.js there (index.html loads the SDK). Same
// functions as the CrazyGames wrapper; what Playgama has no use for (invites,
// instant multiplayer) does nothing. Every call is optional: when the SDK is
// missing or a call fails, the game behaves like the web version.
let bridge = null;

/** Waits for the SDK script and initialises it (gives up after `ms`). */
export async function init(ms = 6000) {
  const deadline = Date.now() + ms;
  while (!window.bridge?.initialize && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  if (!window.bridge?.initialize) return false;
  try {
    await Promise.race([window.bridge.initialize(), new Promise((_, no) => setTimeout(() => no(new Error('timeout')), Math.max(0, deadline - Date.now())))]);
    bridge = window.bridge;
  } catch {
    bridge = null;
  }
  return bridge !== null;
}

export const active = () => bridge !== null;
export const instantMultiplayer = () => false;
export const inviteParam = () => null;
export const inviteLink = () => '';
export function room() {}
export function leftRoom() {}
export function onJoinRoom() {}

const send = (message) => { try { bridge?.platform.sendMessage(message)?.catch?.(() => {}); } catch { /* optional */ } };

/** The end of loading is the moment Playgama shows the game ("game_ready"). */
export function loading(on) {
  if (!on) send('game_ready');
}

let playing = null;
/** Tells Playgama when a round is on screen (gameplay_started) or not (gameplay_stopped). */
export function gameplay(on) {
  if (!bridge || playing === on) return;
  playing = on;
  send(on ? 'gameplay_started' : 'gameplay_stopped');
}

/** The signed-in Playgama player's name, or null for a guest. */
export async function username() {
  try { return bridge?.player.isAuthorized ? bridge.player.name : null; } catch { return null; }
}

/** The language of the platform (e.g. "it"), or null. */
export function locale() {
  try { return bridge?.platform.language || null; } catch { return null; }
}

let adOpen = false;
/**
 * Calls fn(muted) whenever the platform mutes or unmutes the game, or an ad
 * opens or closes (and once now).
 */
export function onMute(fn) {
  if (!bridge) return;
  const audioOn = () => { try { return bridge.platform.isAudioEnabled !== false; } catch { return true; } };
  const update = () => fn(adOpen || !audioOn());
  try {
    bridge.platform.on('audio_state_changed', update);
    bridge.advertisement.on('interstitial_state_changed', (state) => { adOpen = state === 'opened' || state === 'loading'; update(); });
  } catch { /* optional */ }
  update();
}

/** A full-screen ad at a natural break (a game just ended); Playgama spaces them out. */
export function interstitial() {
  try { if (bridge?.advertisement.isInterstitialSupported) bridge.advertisement.showInterstitial(); } catch { /* optional */ }
}
