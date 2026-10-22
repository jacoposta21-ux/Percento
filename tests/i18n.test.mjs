import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadEntries } from '../scripts/lib/data.mjs';
import { collectKeys, placeholders } from '../scripts/i18n-keys.mjs';

const LANGS = ['it', 'fr', 'es', 'de', 'pt'];
const ENTRIES = loadEntries();
const KEYS = collectKeys();

for (const lang of LANGS) {
  test(`${lang}: every card is translated, short enough, without giving the answer away`, () => {
    const file = join(ROOT, 'data', 'i18n', `${lang}.json`);
    assert.ok(existsSync(file), `missing ${file}`);
    const cards = JSON.parse(readFileSync(file, 'utf8'));
    for (const e of ENTRIES) {
      const tr = cards[e.id];
      assert.ok(Array.isArray(tr) && tr.length === 2 && tr[0] && tr[1], `${lang}: no translation for ${e.id}`);
      assert.ok(tr[0].length <= 80, `${lang}: ${e.id} text too long (${tr[0].length})`);
      assert.ok(tr[1].length <= 70, `${lang}: ${e.id} detail too long (${tr[1].length})`);
      assert.ok(!/\d\s?%/.test(tr[0] + tr[1]), `${lang}: ${e.id} shows a percentage`);
    }
  });

  test(`${lang}: every interface string is translated with the same placeholders`, async () => {
    const dict = (await import(join(ROOT, 'src', 'locales', `${lang}.js`))).default;
    const missing = KEYS.filter((k) => typeof dict[k] !== 'string' || !dict[k].trim());
    assert.deepEqual(missing, [], `${lang}: missing ${missing.length}`);
    const bad = KEYS.filter((k) => placeholders(k) !== placeholders(dict[k]));
    assert.deepEqual(bad, [], `${lang}: wrong placeholders`);
  });
}
