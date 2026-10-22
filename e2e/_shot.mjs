import { chromium } from 'playwright-core';
import { startServer } from '../scripts/serve.mjs';
const s = await startServer(4780, '/home/user/Percento/dist');
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const out = process.argv[2];
for (const [w, hh, n] of [[1280, 860, 'd'], [380, 820, 'm']]) {
  const c = await b.newContext({ viewport: { width: w, height: hh } });
  await c.addInitScript({ path: '/home/user/Percento/e2e/fake-supabase.js' });
  const p = await c.newPage();
  p.on('pageerror', (e) => console.log('pageerror', e.message));
  await p.goto('http://127.0.0.1:4780/#/guess/geography'); await p.waitForSelector('.guess-slider');
  await p.fill('.guess-slider', '37'); await p.dispatchEvent('.guess-slider', 'input');
  await p.screenshot({ path: `${out}/g${n}-ask.png`, fullPage: true });
  await p.click('.lock'); await p.waitForSelector('.continue'); await p.waitForTimeout(200);
  await p.screenshot({ path: `${out}/g${n}-reveal.png`, fullPage: true });
  await c.close();
}
await b.close(); s.close();
