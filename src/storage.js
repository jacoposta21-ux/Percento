// localStorage wrapped so the game keeps working when storage is blocked
// (private mode, disabled cookies, sandboxed iframes). Falls back to memory.
const memory = new Map();
let available = null;

function probe() {
  if (available !== null) return available;
  try {
    const k = '__percento_probe__';
    window.localStorage.setItem(k, '1');
    window.localStorage.removeItem(k);
    available = true;
  } catch {
    available = false;
  }
  return available;
}

export const storageAvailable = () => probe();

export function load(key, fallback = null) {
  try {
    if (probe()) {
      const raw = window.localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    }
  } catch {
    /* corrupted value or storage revoked: fall through to memory */
  }
  return memory.has(key) ? memory.get(key) : fallback;
}

export function save(key, value) {
  memory.set(key, value);
  try {
    if (probe()) window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    available = false;
  }
}
