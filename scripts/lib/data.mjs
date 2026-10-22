// Loads every dataset file in data/entries/ (one JSON array per file).
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DATA_DIR = join(ROOT, 'data', 'entries');

export function loadEntries(dir = DATA_DIR) {
  const entries = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const list = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    if (!Array.isArray(list)) throw new Error(`${file} must contain a JSON array`);
    entries.push(...list);
  }
  return entries;
}

export const argValue = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : fallback;
};
