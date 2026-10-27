// CrazyGames SDK v3, used only by the CrazyGames build (index.html loads the
// SDK there). Every call is optional: when the SDK is missing or a call
// fails, the game behaves like the web version.
let sdk = null;

/** Waits for the SDK script and initialises it (gives up after `ms`). */
export async function init(ms = 4000) {
  const deadline = Date.now() + ms;
  while (!window.CrazyGames?.SDK?.init && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  const SDK = window.CrazyGames?.SDK;
  if (!SDK?.init) return false;
  try {
    await Promise.race([SDK.init(), new Promise((_, no) => setTimeout(() => no(new Error('timeout')), Math.max(0, deadline - Date.now())))]);
    sdk = SDK;
  } catch {
    sdk = null;
  }
  return sdk !== null;
}

export const active = () => sdk !== null;

/** True when CrazyGames asks the game to go straight into a joinable multiplayer lobby. */
export const instantMultiplayer = () => Boolean(sdk?.game?.isInstantMultiplayer);

/** A parameter of the invite link the player arrived with, or null. */
export function inviteParam(name) {
  try { return sdk?.game?.getInviteParam?.(name) ?? null; } catch { return null; }
}

/** A link to this game on CrazyGames that opens room `code`. */
export function inviteLink(code) {
  try { return sdk?.game?.inviteLink?.({ roomId: code }) ?? ''; } catch { return ''; }
}

/** CrazyGames' own invite button, shown while the room can still be joined. */
export function showInvite(code) {
  try { sdk?.game?.showInviteButton?.({ roomId: code }); } catch { /* optional */ }
}

export function hideInvite() {
  try { sdk?.game?.hideInviteButton?.(); } catch { /* optional */ }
}

let playing = null;
/** Tells CrazyGames when a round is on screen (gameplayStart) or not (gameplayStop). */
export function gameplay(on) {
  if (!sdk || playing === on) return;
  playing = on;
  try { if (on) sdk.game.gameplayStart(); else sdk.game.gameplayStop(); } catch { /* optional */ }
}

/** The signed-in CrazyGames player's name, or null for a CrazyGames guest. */
export async function username() {
  try { return (await sdk?.user?.getUser?.())?.username ?? null; } catch { return null; }
}

/** Calls fn(muted) whenever the CrazyGames audio setting changes (and once now). */
export function onMute(fn) {
  try {
    const settings = () => sdk?.game?.settings;
    if (settings()) fn(Boolean(settings().muteAudio));
    sdk?.game?.addSettingsChangeListener?.((s) => fn(Boolean((s ?? settings())?.muteAudio)));
  } catch { /* optional */ }
}
