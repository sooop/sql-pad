// 서랍 참고(치트시트) 탭 e2e. 독립 실행.
// 실제 브라우저(Chrome) 검증. dist/sqlpad.html을 file://로 연다. playwright나 Chrome이 없으면 건너뛴다.
// 실행: npm run build && node --test test/e2e.test.mjs   (스크린샷: SQLPAD_SHOTS=/경로 지정)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = pathToFileURL(path.join(root, 'dist/sqlpad.html')).href;
const shots = process.env.SQLPAD_SHOTS;

let pw = null;
for (const id of ['playwright', '/opt/npm-tools/node_modules/playwright']) {
  try { pw = require(id); break; } catch { /* 다음 후보 */ }
}
const CHROME_CANDIDATES = [
  process.env.SQLPAD_CHROME,
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);
const chromePath = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
const skip = !pw || !chromePath || !fs.existsSync(path.join(root, 'dist/sqlpad.html')) ? 'playwright, Chrome 또는 dist/sqlpad.html 없음' : false;

let browser;
let page;
const errors = [];

// 편집기 접근은 DOM 값이 아니라 window.__sqlpad 계약(getSql/setSql/setCursor)으로 한다.
const getSql = () => page.evaluate(() => window.__sqlpad.getSql());
const setSql = (v) => page.evaluate((v) => window.__sqlpad.setSql(v), v);
const setCursor = (pos) => page.evaluate((p) => window.__sqlpad.setCursor(p), pos);
const focusEditor = () => page.evaluate(() => window.__sqlpad.editor.focus());

before(async () => {
  if (skip) return;
  browser = await pw.chromium.launch({ executablePath: chromePath, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 } });
  page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(html);
});
after(async () => { if (browser) await browser.close(); });


test('치트시트: 탭, 검색, 넣기, F1', { skip }, async () => {
  await page.click('#btn-samples');
  await page.click('[data-sample="chinook"]');
  await page.waitForSelector('.obj');

  await page.click('#btn-history');
  await page.click('[data-dtab="cheat"]');
  await page.waitForSelector('.cs-item');
  assert.ok(await page.locator('.cs-item').count() >= 40);
  const all = await page.locator('.cs-item').count();

  await page.fill('#cs-search', '날짜');
  const few = await page.locator('.cs-item').count();
  assert.ok(few > 0 && few < all);
  const hit = page.locator('.cs-item', { hasText: 'strftime' }).first();
  assert.ok(await hit.count() >= 1);
  await hit.locator('.cs-head').click();
  await page.waitForSelector('pre.cs-snippet');
  const snippet = await page.locator('pre.cs-snippet').first().textContent();
  await page.click('[data-act="cs-insert"]');
  await page.waitForSelector('#drawer', { state: 'hidden' });
  assert.ok((await getSql()).includes(snippet.split('\n')[0]));

  await setSql('strftime');
  await setCursor(3);
  await focusEditor();
  await page.keyboard.press('F1');
  await page.waitForSelector('#drawer:not([hidden])');
  await page.waitForSelector('[data-dtab="cheat"][aria-selected="true"]');
  await page.waitForSelector('.cs-item [aria-expanded="true"]');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'cs-search');
  assert.deepEqual(errors, []);
});
