// 오류 힌트(실행 결과)와 실시간 검사 e2e. 실행: npm run build && node --test test/e2e-errors.test.mjs
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

const runAll = async (sql) => {
  await setSql(sql);
  await page.click('#btn-run-all');
  await page.waitForSelector('.err-box');
};

test('Chinook 열기', { skip }, async () => {
  await page.click('#btn-samples');
  await page.click('[data-sample="chinook"]');
  await page.waitForSelector('.obj');
});

test('없는 테이블: 제안, 강조, 편집기에서 보기', { skip }, async () => {
  await runAll('SELECT * FROM Artists');
  assert.equal(await page.getAttribute('.err-box', 'role'), 'alert');
  assert.match(await page.textContent('.err-box .err-suggest'), /Artist\b/);
  assert.equal(await page.textContent('.err-box .err-mark'), 'Artists');
  assert.match(await page.textContent('.err-box .err-raw'), /no such table/);
  await page.click('[data-act="goto-error"]');
  const sel = await page.evaluate(() => window.__sqlpad.editor.getSelection());
  assert.deepEqual(sel, { from: 14, to: 21 });
  await page.waitForSelector('.cm-diag-error');
});

test('쉼표 오류와 키워드 오타', { skip }, async () => {
  await runAll('SELECT Name, FROM Artist');
  assert.match(await page.textContent('.err-box .err-title'), /쉼표/);
  await runAll('SELCT 1');
  assert.match(await page.textContent('.err-box'), /SELECT/);
  assert.match(await page.textContent('.err-box .err-title'), /오타/);
});

test('실시간 검사: 오류 밑줄이 생기고 지우면 사라진다', { skip }, async () => {
  const has = await page.evaluate(() => !!window.__sqlpad.liveCheck);
  if (!has) return;
  await setSql('SELECT * FROM Nope');
  await page.waitForSelector('.cm-diag-error', { timeout: 4000 });
  await setSql('');
  await page.waitForSelector('.cm-diag-error', { state: 'detached', timeout: 4000 });
});

test('페이지 오류 없음', { skip }, () => {
  assert.deepEqual(errors, []);
});
