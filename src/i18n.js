// Translations. English text is the key: t('Play again') returns the current
// language's version, or the English text when a translation is missing.
// Placeholders look like {name}. Headlines and quips are translated line by line.
// Card texts live in src/cards/<lang>.js (generated from data/i18n by the build).
import { load, save } from './storage.js';

export const LANGS = { en: 'English', it: 'Italiano', fr: 'Français', es: 'Español', de: 'Deutsch', pt: 'Português' };
const KEY = 'percento:lang';

let lang = 'en';
let dict = {};
let cards = {};

/** Saved choice, else the first browser language we speak, else English. */
export function detectLang() {
  const saved = load(KEY, null);
  if (saved && LANGS[saved]) return saved;
  const wanted = typeof navigator === 'undefined' ? [] : (navigator.languages?.length ? navigator.languages : [navigator.language]);
  for (const l of wanted) {
    const code = String(l || '').slice(0, 2).toLowerCase();
    if (LANGS[code]) return code;
  }
  return 'en';
}

/** Loads the language's strings and card texts. Never throws: English is the fallback. */
export async function initI18n() {
  lang = detectLang();
  if (lang !== 'en') {
    try {
      [dict, cards] = await Promise.all([
        import(`./locales/${lang}.js`).then((m) => m.default),
        import(`./cards/${lang}.js`).then((m) => m.default).catch(() => ({})),
      ]);
    } catch {
      lang = 'en';
      dict = {};
      cards = {};
    }
  }
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
  return lang;
}

export const getLang = () => lang;

export function setLang(next) {
  if (!LANGS[next]) return;
  save(KEY, next);
}

export function t(text, vars) {
  let out = dict[text] ?? text;
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return out;
}

export const cardText = (e) => cards[e.id]?.[0] ?? e.text;
export const cardDetail = (e) => cards[e.id]?.[1] ?? e.detail;

/** 12.5 → "12.5%" / "12,5 %" depending on the language. */
export function formatPercent(value, decimals = Number.isInteger(value) ? 0 : 1) {
  return new Intl.NumberFormat(lang, { style: 'percent', minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value / 100);
}
