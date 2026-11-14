import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { splitStatements, statementIndexAt, statementKind, statementRangeAt } from '../src/core/sqlsplit.js';
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

test('statementRangeAt: 캐럿이 속한 문의 본문 범위', () => {
  const sql = 'select 1; select 2;';
  assert.deepEqual(statementRangeAt(sql, 3), { from: 0, to: 8 }); // 첫 문 중간
  assert.deepEqual(statementRangeAt(sql, 9), { from: 0, to: 8 }); // 세미콜론 바로 뒤는 앞 문
  assert.deepEqual(statementRangeAt(sql, 12), { from: 10, to: 18 }); // 둘째 문 중간
  assert.deepEqual(statementRangeAt(sql, sql.length), { from: 10, to: 18 }); // 문서 끝
});

test('statementRangeAt: 빈 문서와 공백만 있는 문서는 null', () => {
  assert.equal(statementRangeAt('', 0), null);
  assert.equal(statementRangeAt('  \n\t ', 2), null);
});

test('statementRangeAt: 주석 사이 캐럿은 실행 규칙과 같은 문', () => {
  const sql = 'select 1;\n-- 주석 줄\nselect 2';
  const second = { from: sql.indexOf('select 2'), to: sql.length };
  assert.deepEqual(statementRangeAt(sql, sql.indexOf('주석')), second);
  assert.deepEqual(statementRangeAt(sql, 2), { from: 0, to: 8 });
  assert.equal(statementIndexAt(splitStatements(sql), sql.indexOf('주석')), 1);
});

test('statementRangeAt: 마지막 문 뒤 공백과 앞쪽 공백', () => {
  const sql = '   select 1;   \n  ';
  assert.deepEqual(statementRangeAt(sql, sql.length), { from: 3, to: 11 });
  assert.deepEqual(statementRangeAt(sql, 0), { from: 3, to: 11 });
});

test('statementRangeAt: 여러 줄 문의 중간 캐럿은 문 전체 범위', () => {
  const sql = 'select a,\n  b\nfrom t;\nselect 2';
  const first = { from: 0, to: sql.indexOf(';') };
  assert.deepEqual(statementRangeAt(sql, sql.indexOf('b')), first);
  assert.deepEqual(statementRangeAt(sql, sql.indexOf('from')), first);
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

// ---------- errors ----------
import { explainError, lintStatement, editDistance, closestName } from '../src/core/errors.js';

const errSchema = { Artist: ['ArtistId', 'Name'], Album: ['AlbumId', 'Title', 'ArtistId'] };
const slice = (sql, r) => sql.slice(r.from, r.to);
const lintMsgs = (sql) => lintStatement(sql).map((x) => `${x.level}:${x.message}`);

test('errors: 절 앞 쉼표', () => {
  const sql = 'SELECT Name, FROM Artist';
  const r = explainError('near "FROM": syntax error', sql, errSchema);
  assert.equal(r.kind, 'syntax');
  assert.equal(r.title, '절 앞에 쉼표가 남아 있습니다');
  assert.equal(slice(sql, r.range), ',');
  const lo = explainError('near "from": syntax error', 'select a, from t', null); // 엔진은 쓴 대로 돌려준다
  assert.equal(lo.range.from, 8);
});

test('errors: WHERE 위치와 절 순서', () => {
  const sql = 'SELECT a FROM t GROUP BY a WHERE a > 1';
  const r = explainError('near "WHERE": syntax error', sql, null);
  assert.equal(r.title, 'WHERE 의 위치가 잘못되었습니다');
  assert.match(r.detail, /HAVING/);
  assert.equal(r.range.from, sql.lastIndexOf('WHERE'));
  const sql2 = 'SELECT a FROM t LIMIT 1 ORDER BY a';
  const r2 = explainError('near "ORDER": syntax error', sql2, null);
  assert.equal(r2.title, 'ORDER BY 는 LIMIT 앞에 와야 합니다');
  assert.equal(slice(sql2, r2.range), 'ORDER');
  assert.equal(lintStatement(sql2)[0].message, r2.title);
});

test('errors: 키워드 오타', () => {
  let r = explainError('near "SELCT": syntax error', 'SELCT * FROM t', null);
  assert.equal(r.title, '키워드 오타로 보입니다');
  assert.equal(r.suggestion, "'SELCT' 대신 'SELECT' 를 쓰려던 것 같습니다.");
  assert.deepEqual(r.range, { from: 0, to: 5 });
  for (const [bad, good] of [['form', 'FROM'], ['WHRE', 'WHERE'], ['GRUOP', 'GROUP'], ['ORDRE', 'ORDER'], ['LIMT', 'LIMIT'], ['JOING', 'JOIN']]) {
    r = explainError(`near "${bad}": syntax error`, `SELECT 1 ${bad} t`, null);
    assert.match(r.suggestion, new RegExp(`'${good}'`), bad);
  }
});

test('errors: 닫히지 않은 따옴표와 incomplete input', () => {
  const sql = "SELECT 'abc";
  const r = explainError(`unrecognized token: "'abc"`, sql, null);
  assert.equal(r.kind, 'unclosed');
  assert.deepEqual(r.range, { from: 7, to: sql.length });
  assert.equal(explainError('unrecognized token: ""abc"', 'SELECT "abc', null).range.from, 7);
  const r2 = explainError('incomplete input', 'SELECT (1', null);
  assert.equal(r2.title, '문이 끝나지 않았습니다');
  assert.deepEqual(r2.range, { from: 7, to: 8 });
  assert.deepEqual(explainError('incomplete input', 'SELECT 1 +', null).range, { from: 9, to: 10 });
});

test('errors: no such table 제안', () => {
  const sql = 'SELECT * FROM Artists';
  let r = explainError('no such table: Artists', sql, errSchema);
  assert.equal(r.kind, 'no-table');
  assert.equal(r.suggestion, "'Artists' 테이블은 없습니다. 'Artist' 를 찾으셨나요?");
  assert.equal(slice(sql, r.range), 'Artists');
  r = explainError('no such table: main.Zzzzzz', 'SELECT * FROM main.Zzzzzz', errSchema);
  assert.equal(r.suggestion, '');
  assert.match(r.detail, /왼쪽 목록/);
  assert.equal(r.range.from, 19);
  assert.equal(explainError('no such table: x', 'SELECT * FROM x', null).kind, 'no-table');
});

test('errors: no such column 제안, 큰따옴표, 별칭', () => {
  let sql = 'SELECT Nmae FROM Artist';
  let r = explainError('no such column: Nmae', sql, errSchema);
  assert.equal(r.kind, 'no-column');
  assert.equal(r.suggestion, "'Nmae' 열은 없습니다. 'Name' 을 찾으셨나요?");
  assert.equal(slice(sql, r.range), 'Nmae');
  sql = 'SELECT "Nmae" FROM Artist';
  r = explainError('no such column: Nmae', sql, errSchema);
  assert.match(r.detail, /작은따옴표/);
  assert.equal(slice(sql, r.range), '"Nmae"');
  sql = 'SELECT a.Nmae FROM Artist a';
  r = explainError('no such column: a.Nmae', sql, errSchema);
  assert.equal(slice(sql, r.range), 'Nmae');
  sql = 'SELECT Name AS n2 FROM Artist WHERE n2 = 1';
  r = explainError('no such column: n2', sql, errSchema);
  assert.match(r.detail, /별칭/);
  assert.equal(r.range.from, sql.lastIndexOf('n2'));
});

test('errors: ambiguous, aggregate, function', () => {
  let sql = 'SELECT ArtistId FROM Artist a JOIN Album b ON 1=1';
  let r = explainError('ambiguous column name: ArtistId', sql, errSchema);
  assert.equal(r.kind, 'ambiguous');
  assert.equal(r.title, '같은 이름의 열이 여러 테이블에 있습니다');
  assert.equal(r.suggestion, '테이블 이름이나 별칭을 앞에 붙이세요. 예: a.ArtistId');
  assert.equal(r.range.from, 7);

  sql = 'SELECT * FROM t WHERE count(*) > 1';
  for (const msg of ['misuse of aggregate function count()', 'misuse of aggregate: count()']) {
    r = explainError(msg, sql, null);
    assert.equal(r.kind, 'aggregate');
    assert.equal(r.title, '집계 함수를 쓸 수 없는 자리입니다');
    assert.equal(slice(sql, r.range), 'count');
  }

  sql = 'SELECT len(Name) FROM Artist';
  r = explainError('no such function: len', sql, errSchema);
  assert.equal(r.title, "'len' 은 없는 함수입니다");
  assert.match(r.suggestion, /length/);
  assert.equal(slice(sql, r.range), 'len');
  assert.match(explainError('no such function: NOW', 'SELECT NOW()', null).suggestion, /datetime\('now'\)/);
  assert.match(explainError('no such function: CONCAT', 'SELECT CONCAT(a,b)', null).suggestion, /\|\|/);
  assert.match(explainError('no such function: NVL', 'SELECT NVL(a,b)', null).suggestion, /coalesce/);
  assert.match(explainError('no such function: roud', 'SELECT roud(1)', null).suggestion, /round/);
});

test('errors: 제약 조건 오류', () => {
  let r = explainError('UNIQUE constraint failed: a.n', 'INSERT INTO a VALUES (1)', null);
  assert.equal(r.title, '중복 값은 넣을 수 없습니다');
  assert.equal(r.detail, 'a 테이블의 n 열은 값이 고유해야 합니다.');
  r = explainError('NOT NULL constraint failed: a.n', '', null);
  assert.match(r.title, /n 열은 비울 수 없습니다/);
  assert.match(explainError('FOREIGN KEY constraint failed', '', null).title, /참조하는 행이 없습니다/);
  assert.match(explainError('datatype mismatch', '', null).title, /자료형/);
});

test('errors: 일반 문법 오류와 기타', () => {
  const sql = 'SELECT a b c FROM t';
  let r = explainError('near "c": syntax error', sql, null);
  assert.equal(r.kind, 'syntax');
  assert.equal(r.title, "'c' 근처에 문법 오류가 있습니다");
  assert.match(r.detail, /바로 앞/);
  assert.equal(slice(sql, r.range), 'c');
  r = explainError('something odd', 'SELECT 1', null);
  assert.deepEqual(r, { kind: 'other', title: 'something odd', detail: '', suggestion: '', range: null });
});

test('errors: lint 괄호와 따옴표', () => {
  let l = lintStatement('SELECT (1 + 2');
  assert.deepEqual(l, [{ level: 'error', message: '닫히지 않은 괄호가 있습니다', range: { from: 7, to: 8 } }]);
  l = lintStatement('SELECT 1)');
  assert.equal(l[0].message, '짝이 없는 닫는 괄호입니다');
  assert.equal(l[0].range.from, 8);
  assert.deepEqual(lintStatement("SELECT '(', \"a)\" -- (\n"), []);
  assert.deepEqual(lintStatement("SELECT 'abc"), [{ level: 'error', message: '닫히지 않은 따옴표가 있습니다', range: { from: 7, to: 11 } }]);
  assert.deepEqual(lintStatement(''), []);
});

test('errors: lint 절 순서', () => {
  const l = lintStatement('SELECT a FROM t GROUP BY a WHERE a > 1');
  assert.deepEqual(l.map((x) => x.message), ['WHERE 는 GROUP BY 앞에 와야 합니다']);
  assert.equal(l[0].level, 'error');
  assert.deepEqual(lintMsgs('SELECT a FROM t ORDER BY a LIMIT 1 OFFSET 2'), []);
  assert.deepEqual(lintMsgs('SELECT a FROM t UNION SELECT b FROM u ORDER BY 1'), []);
  assert.deepEqual(lintMsgs('SELECT a FROM t WHERE x IN (SELECT y FROM u ORDER BY y) ORDER BY a'), []);
  assert.deepEqual(lintMsgs('WITH c AS (SELECT 1 FROM x WHERE 1) SELECT * FROM c WHERE 1'), []);
  assert.deepEqual(lintMsgs('UPDATE t SET a = 1 WHERE b = 2'), []);
  assert.deepEqual(lintMsgs('SELECT 1 FROM t WHERE a IS DISTINCT FROM b'), []);
  assert.deepEqual(lintMsgs('SELECT a FROM t LIMIT 1 ORDER BY a'), ['error:ORDER BY 는 LIMIT 앞에 와야 합니다']);
  assert.deepEqual(lintMsgs('SELECT a FROM t UNION SELECT b FROM u WHERE 1 UNION SELECT 1 FROM v WHERE 2'), []);
});

test('errors: lint 쉼표', () => {
  assert.deepEqual(lintStatement('SELECT a, FROM t'), [{ level: 'error', message: '쉼표 뒤에 항목이 없습니다', range: { from: 8, to: 9 } }]);
  assert.deepEqual(lintMsgs('SELECT max(a, ) FROM t'), ['error:쉼표 뒤에 항목이 없습니다']);
  assert.deepEqual(lintMsgs('SELECT a, b FROM t GROUP BY a, b ORDER BY a, b'), []);
  assert.equal(lintMsgs('SELECT a, FROM t WHERE x, GROUP BY a').length, 2);
});

test('errors: lint 키워드 오타', () => {
  assert.deepEqual(lintStatement('SELCT * FROM t'), [{ level: 'warning', message: "'SELCT' 은 'SELECT' 의 오타로 보입니다", range: { from: 0, to: 5 } }]);
  assert.deepEqual(lintMsgs('foo bar'), []);
  assert.deepEqual(lintMsgs('select 1'), []);
});

test('errors: lint 큰따옴표 문자열 의심', () => {
  assert.equal(lintStatement('SELECT * FROM t WHERE a = "abc"').length, 1);
  assert.equal(lintStatement('SELECT * FROM t WHERE a LIKE "%a%"')[0].level, 'warning');
  assert.equal(lintStatement('SELECT * FROM t WHERE a IN ("a", "b")').length, 2);
  assert.equal(lintStatement('INSERT INTO t VALUES ("a", 1), ("b", 2)').length, 2);
  assert.deepEqual(lintMsgs('SELECT "a" FROM "t" WHERE "t"."a" = "t"."b"'), []);
  assert.deepEqual(lintMsgs('INSERT INTO t ("a", "b") VALUES (1, 2)'), []);
  assert.deepEqual(lintMsgs("SELECT * FROM t WHERE a = 'abc'"), []);
});

test('errors: lint JOIN 에 ON 없음', () => {
  const l = lintStatement('SELECT * FROM a JOIN b WHERE a.x = 1');
  assert.equal(l.length, 1);
  assert.equal(l[0].level, 'warning');
  assert.equal(l[0].message, 'JOIN 에 ON 조건이 없어 모든 행 조합(교차 조인)이 됩니다');
  assert.deepEqual(l[0].range, { from: 16, to: 20 });
  assert.equal(lintStatement('SELECT * FROM a JOIN b').length, 1);
  assert.equal(lintStatement('SELECT * FROM a JOIN b JOIN c ON 1').length, 1);
  assert.deepEqual(lintMsgs('SELECT * FROM a JOIN b ON a.x = b.x'), []);
  assert.deepEqual(lintMsgs('SELECT * FROM a LEFT JOIN b USING (x) WHERE 1'), []);
  assert.deepEqual(lintMsgs('SELECT * FROM a NATURAL JOIN b'), []);
  assert.deepEqual(lintMsgs('SELECT * FROM a CROSS JOIN b'), []);
  assert.deepEqual(lintMsgs('SELECT * FROM a NATURAL LEFT JOIN b'), []);
  assert.deepEqual(lintMsgs('SELECT * FROM a JOIN (SELECT 1 FROM x JOIN y ON 1) s ON 1'), []);
});

test('errors: editDistance, closestName 경계', () => {
  assert.equal(editDistance('', 'abc'), 3);
  assert.equal(editDistance('kitten', 'sitting'), 3);
  assert.equal(editDistance('name', 'nmae'), 1); // 인접 바꿈
  assert.equal(editDistance('a', 'a'), 0);
  assert.equal(closestName('Nmae', ['Id', 'Name', 'Title']), 'Name');
  assert.equal(closestName('artist', ['Artist']), 'Artist'); // 대소문자 무시
  assert.equal(closestName('Artists', ['Artist', 'Album']), 'Artist');
  assert.equal(closestName('xyz', ['Artist', 'Album']), null); // 상한 초과
  assert.equal(closestName('ab', ['cd']), null); // 짧은 이름은 상한 1
  assert.equal(closestName('abcdef', ['abcxyz']), null); // 길이 6 이면 상한 2, 거리 3
  assert.equal(closestName('abcdef', ['abcdxy']), 'abcdxy');
  assert.equal(closestName('x', []), null);
  assert.equal(closestName('x', null), null);
});
