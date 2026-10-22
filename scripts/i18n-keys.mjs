// Collects every English string the interface translates, so locale files can
// be checked for gaps:
//   node scripts/i18n-keys.mjs            → list keys missing per language
//   node scripts/i18n-keys.mjs --json     → all keys as JSON (for translators)
// Sources: t()/tx()/toast() calls in src/*.js, data-i18n attributes in
// index.html, category labels, and every line in src/copy.js.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib/data.mjs';
import { CATEGORIES } from '../src/config.js';
import * as copy from '../src/copy.js';

const LITERAL = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g;
const unescape = (s) => s.replace(/\\(.)/g, '$1');

/** The source text of the first argument of the call starting at `open` (the "("). */
function firstArgument(src, open) {
  let depth = 0;
  let quote = null;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') quote = c;
    else if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    } else if (c === ',' && depth === 1) return src.slice(open + 1, i);
  }
  return '';
}

export function collectKeys() {
  const keys = new Set();
  const dir = join(ROOT, 'src');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    // Comments may quote keys in shortened form; only code counts.
    const src = readFileSync(join(dir, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    // A call, not a method (x.t(…)), but spread calls (...tx(…)) count.
    for (const m of src.matchAll(/(?<![\w$])(?<![^.]\.)(t|tx|toast)\(/g)) {
      const arg = firstArgument(src, m.index + m[0].length - 1);
      for (const lit of arg.matchAll(LITERAL)) {
        const text = unescape(lit[1] ?? lit[2]);
        if (/[A-Za-z]/.test(text) && text.length > 1) keys.add(text);
      }
    }
  }
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  for (const m of html.matchAll(/data-i18n(?:-label)?="([^"]+)"/g)) keys.add(m[1]);
  for (const c of Object.values(CATEGORIES)) keys.add(c.label);
  keys.add(copy.TAGLINE);
  keys.add(copy.INSTRUCTION);
  keys.add('Which percentage is higher?');
  for (const list of [copy.HEADLINES, copy.RIGHT_QUIPS, copy.WRONG_QUIPS]) list.forEach((l) => keys.add(l));
  for (const table of [copy.GAME_OVER_LINES, copy.DAILY_END_LINES]) table.forEach((row) => row.lines.forEach((l) => keys.add(l)));
  return [...keys].sort();
}

export const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

if (import.meta.url === `file://${process.argv[1]}`) {
  const keys = collectKeys();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(keys, null, 1));
  } else {
    const { LANGS } = await import('../src/i18n.js');
    for (const lang of Object.keys(LANGS).filter((l) => l !== 'en')) {
      const dict = (await import(join(ROOT, 'src', 'locales', `${lang}.js`)).catch(() => ({ default: {} }))).default;
      const missing = keys.filter((k) => !(k in dict));
      const bad = keys.filter((k) => k in dict && placeholders(k) !== placeholders(dict[k]));
      console.log(`${lang}: ${keys.length - missing.length}/${keys.length} translated${bad.length ? `, ${bad.length} with wrong placeholders` : ''}`);
      for (const k of missing.slice(0, 10)) console.log(`  missing: ${k}`);
      for (const k of bad.slice(0, 10)) console.log(`  placeholders: ${k}`);
    }
  }
}
