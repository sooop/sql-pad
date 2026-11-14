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

const shot = async (name) => { if (shots) await page.screenshot({ path: path.join(shots, name + '.png') }); };
const runAll = async (sql) => {
  await page.fill('#sql', sql);
  await page.click('#btn-run-all');
};

test('시작: 편집기는 비어 있고 포커스가 있다', { skip }, async () => {
  assert.equal(await page.inputValue('#sql'), '');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'sql');
  assert.equal(await page.locator('.file-item').count(), 0);
});

test('샘플 열기: 파일 목록과 테이블 트리', { skip }, async () => {
  await page.click('#btn-samples');
  await page.click('[data-sample="chinook"]');
  await page.waitForSelector('.file-item');
  assert.match(await page.textContent('.file-item .file-name'), /chinook\.sqlite/);
  await page.waitForSelector('.obj');
  assert.equal(await page.locator('.obj').count(), 11);
  assert.match(await page.textContent('#active-label'), /chinook/);
});

test('테이블 선택: 스키마, 데이터, DDL', { skip }, async () => {
  await page.click('.obj[data-name="Album"] [data-act="select"]');
  await page.waitForSelector('#pane-table .info');
  const schema = await page.textContent('#pane-table');
  assert.match(schema, /AlbumId/);
  assert.match(schema, /Artist/); // 외래 키
  await page.click('[data-sub="data"]');
  await page.waitForSelector('#pane-table table.grid');
  assert.equal(await page.locator('#pane-table table.grid tbody tr').count(), 50);
  await page.click('[data-act="next"]');
  await page.waitForFunction(() => /51–100/.test((document.querySelector('#pane-table .meta-row .meta-text') || {}).textContent || ''));
  await page.click('[data-sub="ddl"]');
  assert.match(await page.textContent('#pane-table .ddl'), /CREATE TABLE/);
  await shot('1-table');
});

test('쿼리 실행: 여러 문, 오류, 한도', { skip }, async () => {
  await runAll('SELECT * FROM Artist LIMIT 5; SELECT count(*) AS n FROM Track;');
  await page.waitForSelector('#pane-results .chip');
  assert.equal(await page.locator('#pane-results .chip').count(), 2);
  assert.match(await page.textContent('#pane-results .meta-text'), /1행/);
  assert.match(await page.textContent('#pane-results table.grid'), /3,?503|3503/);

  await runAll('SELEC 1');
  await page.waitForSelector('#pane-results .err-box');
  assert.match(await page.textContent('#pane-results .err-box'), /syntax error/i);

  await runAll('SELECT * FROM Track');
  await page.waitForSelector('#pane-results table.grid');
  assert.equal(await page.locator('#pane-results table.grid tbody tr').count(), 1000);
  assert.match(await page.textContent('#pane-results .meta-text'), /이후 행은 표시하지 않음/);
  await shot('2-results');
});

test('커서 위치의 문만 실행(Ctrl+Enter)', { skip }, async () => {
  await page.fill('#sql', 'SELECT 111 AS a;\n\nSELECT 222 AS b;');
  await page.evaluate(() => { const t = document.querySelector('#sql'); t.focus(); t.setSelectionRange(t.value.length - 3, t.value.length - 3); });
  await page.keyboard.press('Control+Enter');
  await page.waitForFunction(() => /222/.test(document.querySelector('#pane-results').textContent));
  assert.ok(!/111/.test(await page.textContent('#pane-results table.grid')));
});

test('쓰기 쿼리: 변경됨 표시, 스키마 갱신, 처음 상태로 되돌리기', { skip }, async () => {
  await runAll("CREATE TABLE memo(id INTEGER PRIMARY KEY, t TEXT); INSERT INTO memo(t) VALUES ('a'),('b');");
  await page.waitForSelector('.file-item.dirty');
  await page.waitForSelector('.obj[data-name="memo"]');
  assert.equal(await page.locator('.obj').count(), 12);
  await page.click('[data-act="reset"]');
  await page.waitForFunction(() => document.querySelectorAll('.obj').length === 11 && !document.querySelector('.file-item.dirty'));
});

test('취소: 오래 걸리는 쿼리를 중단하고 DB를 다시 연다', { skip }, async () => {
  await page.fill('#sql', 'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c) SELECT count(*) FROM c;');
  await page.click('#btn-run');
  await page.waitForSelector('#btn-cancel:not([hidden])');
  await page.click('#btn-cancel');
  await page.waitForFunction(() => /취소했습니다/.test(document.querySelector('#pane-results').textContent), null, { timeout: 15000 });
  assert.equal(await page.locator('#btn-cancel').isVisible(), false);
  // 취소 뒤에도 쿼리가 동작한다
  await runAll('SELECT count(*) AS n FROM Album');
  await page.waitForFunction(() => /347/.test(document.querySelector('#pane-results').textContent));
});

test('내역: 중복은 한 건, 서랍 조작, 불러오기', { skip }, async () => {
  await runAll('SELECT 42 AS answer');
  await runAll('SELECT 42 AS answer');
  await page.waitForSelector('#pane-results table.grid');
  await page.click('#btn-history');
  await page.waitForSelector('#drawer:not([hidden]) .entry');
  assert.equal(await page.evaluate(() => document.querySelector('#app').inert), true);
  const texts = await page.locator('#drawer .entry-sql').allTextContents();
  assert.equal(texts.filter((t) => t.trim() === 'SELECT 42 AS answer').length, 1);
  await page.fill('#d-search', 'answer');
  assert.equal(await page.locator('#drawer .entry').count(), 1);
  assert.ok(await page.locator('#drawer mark').count() >= 1);
  await shot('3-drawer');
  await page.click('[data-act="d-load"]');
  assert.equal(await page.inputValue('#sql'), 'SELECT 42 AS answer');
  assert.equal(await page.evaluate(() => document.querySelector('#app').inert), false);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'sql');
});

test('저장한 쿼리와 백업 가져오기', { skip }, async () => {
  await page.fill('#sql', 'SELECT * FROM Genre');
  await page.click('#btn-save');
  await page.waitForSelector('#d-name');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'd-name');
  await page.fill('#d-name', '장르 전체');
  await page.click('#d-save-form button[type="submit"]');
  await page.waitForSelector('#drawer .entry-name');
  assert.match(await page.textContent('#drawer .entry-name'), /장르 전체/);
  await page.click('[data-dtab="backup"]');
  await page.click('[data-act="d-import"]'); // 빈 입력
  await page.waitForFunction(() => /JSON/.test(document.querySelector('#d-msg').textContent));
  await page.fill('#d-json', JSON.stringify({ app: 'sqlpad', version: 1, history: [{ sql: 'SELECT 1', ts: 1 }, { sql: '' }], saved: [] }));
  await page.click('[data-act="d-import"]');
  await page.waitForFunction(() => /추가 1, 중복 0, 제외 1/.test(document.querySelector('#d-msg').textContent));
  await page.keyboard.press('Escape');
  await page.waitForSelector('#drawer', { state: 'hidden' });
});

test('전체 삭제는 화면 안에서 한 번 더 확인한다', { skip }, async () => {
  await page.click('#btn-history');
  await page.click('[data-dtab="history"]');
  await page.click('[data-act="d-clear"]');
  await page.waitForSelector('[data-act="d-clear-yes"]');
  await page.click('[data-act="d-clear-no"]');
  assert.ok(await page.locator('#drawer .entry').count() > 0);
  await page.click('[data-act="d-clear"]');
  await page.click('[data-act="d-clear-yes"]');
  await page.waitForFunction(() => document.querySelectorAll('#drawer .entry').length === 0);
  await page.keyboard.press('Escape');
});

test('파일 열기: DB와 SQL 텍스트를 내용으로 판별, 잘못된 파일은 안내', { skip }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlpad-e2e-'));
  fs.writeFileSync(path.join(tmp, 'noext'), fs.readFileSync(path.join(root, 'samples/northwind.sqlite'))); // 확장자 없는 DB
  fs.writeFileSync(path.join(tmp, 'q.sql'), 'SELECT 7 AS seven;');
  fs.writeFileSync(path.join(tmp, 'junk.bin'), Buffer.from([0, 1, 2, 3, 255, 254, 0, 9, 9, 9]));
  await page.setInputFiles('#file-input', [path.join(tmp, 'noext'), path.join(tmp, 'q.sql'), path.join(tmp, 'junk.bin')]);
  await page.waitForFunction(() => document.querySelector('#sql').value === 'SELECT 7 AS seven;' && /junk\.bin/.test(document.querySelector('#side-status').textContent));
  assert.equal(await page.locator('.file-item').count(), 2);
  assert.match(await page.textContent('#side-status'), /junk\.bin/);
  assert.equal(await page.locator('.file-item.active .file-name').textContent(), 'noext');
  await page.waitForFunction(() => document.querySelectorAll('.obj').length >= 14);
  // SQLite 헤더지만 깨진 파일
  fs.writeFileSync(path.join(tmp, 'bad.db'), Buffer.concat([Buffer.from('SQLite format 3\0'), Buffer.alloc(200, 7)]));
  await page.setInputFiles('#file-input', [path.join(tmp, 'bad.db')]);
  await page.waitForFunction(() => /bad\.db/.test(document.querySelector('#side-status').textContent));
  assert.equal(await page.locator('.file-item').count(), 2);
});

test('파일 드롭: 영역 강조와 열기', { skip }, async () => {
  const before = await page.locator('.file-item').count();
  const result = await page.evaluate(async () => {
    const dt = new DataTransfer();
    dt.items.add(new File(['SELECT 99 AS dropped;'], 'dropped.txt', { type: '' }));
    const target = document.querySelector('#sql');
    const fire = (type) => target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
    fire('dragenter'); fire('dragover');
    const highlighted = document.body.hasAttribute('data-dragover');
    const dropEv = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt });
    target.dispatchEvent(dropEv);
    await new Promise((r) => setTimeout(r, 300));
    return { highlighted, prevented: dropEv.defaultPrevented, cleared: !document.body.hasAttribute('data-dragover'), text: document.querySelector('#sql').value };
  });
  assert.equal(result.highlighted, true);
  assert.equal(result.prevented, true);
  assert.equal(result.cleared, true);
  assert.equal(result.text, 'SELECT 99 AS dropped;');
  assert.equal(await page.locator('.file-item').count(), before);
});

test('예시 넣기와 구문 강조, 줄번호', { skip }, async () => {
  await page.click('.file-item:first-child [data-act="activate"]');
  await page.fill('#sql', '');
  await page.click('#btn-example');
  const v = await page.inputValue('#sql');
  assert.match(v, /SELECT/);
  assert.ok(await page.locator('#hl .t-kw').count() > 3);
  const lines = v.split('\n').length;
  assert.equal((await page.textContent('#gutter')).split('\n').length, lines);
  await page.click('#btn-run-all');
  await page.waitForFunction(() => document.querySelectorAll('#pane-results .chip').length >= 2);
  const errs = await page.locator('#pane-results .chip.err').count();
  assert.equal(errs, 0, '예시 쿼리는 모두 오류 없이 실행되어야 한다');
  await shot('4-example');
});

test('Northwind 예시 쿼리도 오류 없이 실행된다', { skip }, async () => {
  await page.evaluate(() => window.__sqlpad.openSample('northwind'));
  await page.waitForFunction(() => document.querySelectorAll('.file-item').length === 3);
  await page.fill('#sql', '');
  await page.click('#btn-example');
  await page.click('#btn-run-all');
  await page.waitForFunction(() => document.querySelectorAll('#pane-results .chip').length >= 4);
  assert.equal(await page.locator('#pane-results .chip.err').count(), 0);
});

test('테마 전환은 저장되고 새로고침 뒤에도 유지된다', { skip }, async () => {
  await page.click('#btn-theme'); // light
  await page.click('#btn-theme'); // dark
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  await shot('5-dark');
  await page.reload();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  assert.equal(await page.inputValue('#sql'), ''); // 새로고침 뒤 편집기는 비어 있다
  await page.click('#btn-history');
  await page.waitForSelector('#drawer:not([hidden])');
  await page.keyboard.press('Escape');
});

test('좁은 화면: 사이드바 패널과 가로 스크롤 없음', { skip }, async () => {
  await page.evaluate(() => localStorage.setItem('sqlpad.settings', JSON.stringify({ theme: 'light' })));
  await page.setViewportSize({ width: 390, height: 800 });
  await page.reload();
  await page.waitForSelector('body.nav-open');
  await page.click('#btn-samples');
  await page.click('[data-sample="chinook"]');
  await page.waitForSelector('.obj');
  await page.click('.obj[data-name="Customer"] [data-act="select"]');
  await page.waitForSelector('#pane-table .info');
  assert.equal(await page.evaluate(() => document.body.classList.contains('nav-open')), false);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, `가로 넘침 ${overflow}px`);
  await page.click('#sql');
  assert.equal(await page.locator('#keybar').isVisible(), true);
  const fs16 = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('#sql')).fontSize));
  assert.ok(fs16 >= 16);
  await shot('6-mobile');
});

test('콘솔과 페이지 오류가 없다', { skip }, async () => {
  assert.deepEqual(errors, []);
});
