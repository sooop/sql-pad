import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { splitStatements, statementIndexAt, statementKind } from '../src/core/sqlsplit.js';
import { highlightHtml } from '../src/core/highlight.js';
import { toDelimited, cellToText, identForSql } from '../src/core/format.js';
import { createEngine } from '../src/core/engine.js';
import { addHistory, upsertSaved, searchEntries, mergeBackup, buildBackup, hashSql } from '../src/core/history.js';

const require = createRequire(import.meta.url);
const initSqlJs = require('sql.js');
const SQL = await initSqlJs();

test('splitStatements: 문자열, 주석, 트리거 본문의 세미콜론', () => {
  const sql = `SELECT ';' AS a; -- c;\n/* x; */ SELECT 2;\nCREATE TRIGGER t AFTER INSERT ON x BEGIN\n UPDATE y SET v = CASE WHEN 1 THEN 2 END; DELETE FROM z;\nEND;\nSELECT 3`;
  const s = splitStatements(sql);
  assert.equal(s.length, 4);
  assert.equal(s[0].text, "SELECT ';' AS a");
  assert.equal(s[1].text, 'SELECT 2');
  assert.match(s[2].text, /^CREATE TRIGGER[\s\S]*END$/);
  assert.equal(s[3].text, 'SELECT 3');
});

test('statementIndexAt: 캐럿 위치별 문 선택', () => {
  const sql = 'SELECT 1;\n\nSELECT 2;';
  const s = splitStatements(sql);
  assert.equal(statementIndexAt(s, 3), 0);
  assert.equal(statementIndexAt(s, 9), 0); // 세미콜론 바로 뒤
  assert.equal(statementIndexAt(s, 11), 1);
  assert.equal(statementIndexAt(s, sql.length), 1);
  assert.equal(statementIndexAt([], 0), -1);
  assert.equal(statementKind('  with a as (select 1) select * from a'), 'WITH');
});

test('highlightHtml: 이스케이프와 클래스', () => {
  const h = highlightHtml(`SELECT "a<b", 'x&y', 12 -- note`);
  assert.match(h, /<span class="t-kw">SELECT<\/span>/);
  assert.match(h, /&lt;/);
  assert.match(h, /&amp;/);
  assert.match(h, /t-num/);
  assert.match(h, /t-cm/);
  assert.ok(!h.includes('<b'));
});

test('format: CSV 따옴표, BOM, CRLF', () => {
  const out = toDelimited(['a', 'b'], [[1, 'x,"y"'], [null, { $blob: 3 }]], { bom: true, crlf: true });
  assert.equal(out, '﻿a,b\r\n1,"x,""y"""\r\n,[BLOB 3 B]\r\n');
  assert.equal(cellToText(null), 'NULL');
  assert.equal(identForSql('Order Details'), '"Order Details"');
  assert.equal(identForSql('Album'), 'Album');
});

const chinook = fs.readFileSync(new URL('../samples/chinook.sqlite', import.meta.url));
const northwind = fs.readFileSync(new URL('../samples/northwind.sqlite', import.meta.url));

test('engine: Chinook 열기, 스키마, 상세', () => {
  const e = createEngine(SQL);
  const info = e.open(new Uint8Array(chinook));
  assert.match(info.version, /^3\./);
  const sc = e.schema();
  const names = sc.map((o) => o.name);
  assert.equal(sc.filter((o) => o.type === 'table').length, 11);
  assert.ok(names.includes('Album'));
  assert.equal(sc.find((o) => o.name === 'Album').rowCount, 347);
  const d = e.detail('Album');
  assert.deepEqual(d.columns.map((c) => c.name), ['AlbumId', 'Title', 'ArtistId']);
  assert.equal(d.columns[0].pk, 1);
  assert.equal(d.foreignKeys[0].table, 'Artist');
  assert.ok(d.indexes.length >= 1);
  assert.match(d.ddl, /CREATE TABLE/);
});

test('engine: 여러 문 실행, 행 제한, 오류에서 멈춤', () => {
  const e = createEngine(SQL);
  e.open(new Uint8Array(chinook));
  let r = e.run('SELECT * FROM Track; SELECT 1 AS one;', { maxRows: 10 });
  assert.equal(r.results.length, 2);
  assert.equal(r.results[0].rows.length, 10);
  assert.equal(r.results[0].truncated, true);
  assert.deepEqual(r.results[1].rows, [[1]]);
  assert.equal(r.dirty, false);

  r = e.run('SELECT 1; SELEC 2; SELECT 3;');
  assert.equal(r.results.length, 2);
  assert.ok(r.results[1].error);

  r = e.run("CREATE TABLE memo(id INTEGER PRIMARY KEY, t TEXT); INSERT INTO memo(t) VALUES ('a'),('b'); SELECT count(*) FROM memo;");
  assert.equal(r.dirty, true);
  assert.equal(r.schemaChanged, true);
  assert.equal(r.results[1].changes, 2);
  assert.deepEqual(r.results[2].rows, [[2]]);
  assert.ok(e.schema().some((o) => o.name === 'memo'));
});

test('engine: 내보낸 DB를 다시 열 수 있다', () => {
  const e = createEngine(SQL);
  e.open(new Uint8Array(chinook));
  e.run('CREATE TABLE keep(x); INSERT INTO keep VALUES (42);');
  const bytes = e.exportDb();
  const e2 = createEngine(SQL);
  e2.open(bytes);
  assert.deepEqual(e2.run('SELECT x FROM keep').results[0].rows, [[42]]);
});

test('engine: SQLite가 아닌 파일은 거부한다', () => {
  const e = createEngine(SQL);
  e.open(new Uint8Array(chinook));
  assert.throws(() => e.open(new TextEncoder().encode('this is not a sqlite database file at all, just text '.repeat(10))));
  assert.equal(e.isOpen(), false); // 열기를 시도하면 기존 연결은 닫힌다. 화면은 DB마다 엔진(워커)을 따로 둔다
});

test('engine: Northwind 뷰와 공백 있는 테이블명', () => {
  const e = createEngine(SQL);
  e.open(new Uint8Array(northwind));
  const sc = e.schema();
  assert.ok(sc.some((o) => o.name === 'Order Details' && o.type === 'table'));
  assert.ok(sc.some((o) => o.type === 'view'));
  const p = e.preview('Order Details', { limit: 5, offset: 5 });
  assert.equal(p.rows.length, 5);
  assert.equal(p.columns[0], 'OrderID');
});

test('history: 중복은 한 건으로 합치고 최신순', () => {
  let l = [];
  l = addHistory(l, { sql: 'SELECT 1', ts: 1 }).list;
  l = addHistory(l, { sql: 'SELECT 2', ts: 2 }).list;
  const r = addHistory(l, { sql: 'SELECT 1\r\n', ts: 3 }); // 줄바꿈과 공백만 다른 같은 입력
  assert.equal(r.status, 'updated');
  assert.equal(r.list.length, 2);
  assert.equal(r.list[0].sql, 'SELECT 1');
  assert.equal(addHistory([], { sql: '  ' }).status, 'empty');
  assert.equal(addHistory([], { sql: 'x'.repeat(200001) }).status, 'oversize');
  assert.equal(addHistory(r.list, { sql: 'SELECT 9' }, 2).dropped, 1);
});

test('history: 검색과 저장 쿼리, 백업 병합', () => {
  const l = [{ id: '1', sql: 'SELECT * FROM Album', dbName: 'chinook.sqlite', ts: 1 }, { id: '2', sql: 'SELECT 1', dbName: '', ts: 2 }];
  assert.equal(searchEntries(l, 'album chinook').length, 1);
  assert.equal(searchEntries(l, '').length, 2);

  const s1 = upsertSaved([], { name: '앨범', sql: 'SELECT * FROM Album', ts: 5 });
  assert.equal(s1.status, 'added');
  const s2 = upsertSaved(s1.list, { name: '앨범 전체', sql: 'SELECT * FROM Album ', ts: 6 });
  assert.equal(s2.status, 'updated');
  assert.equal(s2.list.length, 1);

  const backup = buildBackup(l, s2.list);
  const merged = mergeBackup({ history: [{ id: hashSql('SELECT 1'), sql: 'SELECT 1', ts: 9 }], saved: [] }, {
    ...backup, history: [...backup.history, { sql: '' }, { sql: 'SELECT 7', ts: 3 }],
  });
  assert.deepEqual(merged.summary, { added: 3, dup: 1, skipped: 1 });
  assert.equal(merged.history.length, 3);
  assert.throws(() => mergeBackup({ history: [], saved: [] }, { app: 'other' }));
});
