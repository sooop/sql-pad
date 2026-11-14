import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { createEngine } from '../src/core/engine.js';

const require = createRequire(import.meta.url);
const initSqlJs = require('sql.js');
const SQL = await initSqlJs();

const chinook = fs.readFileSync(new URL('../samples/chinook.sqlite', import.meta.url));

test('check: 올바른 문 여러 개는 모두 ok', () => {
  const e = createEngine(SQL);
  e.open(new Uint8Array(chinook));
  const sql = 'SELECT * FROM Album; INSERT INTO Artist(Name) VALUES (\'x\'); UPDATE Album SET Title = Title;';
  const { results } = e.check(sql);
  assert.equal(results.length, 3);
  assert.ok(results.every((r) => r.ok === true));
  assert.deepEqual(results.map((r) => r.kind), ['SELECT', 'INSERT', 'UPDATE']);
});

test('check: 문법 오류와 없는 테이블이 섞여도 각각 error 가 담기고 뒤 문도 검사된다', () => {
  const e = createEngine(SQL);
  e.open(new Uint8Array(chinook));
  const sql = 'SELEC 1; SELECT * FROM NoSuchTable; SELECT 3 FROM Album';
  const { results } = e.check(sql);
  assert.equal(results.length, 3);
  assert.equal(results[0].ok, false);
  assert.equal(typeof results[0].error, 'string');
  assert.ok(results[0].error.length > 0);
  assert.equal(results[1].ok, false);
  assert.match(results[1].error, /no such table/);
  assert.equal(results[2].ok, true); // 앞 문 오류 뒤에도 검사를 계속한다
});

test('check: 뒤에 실행해도 DB 행 수가 변하지 않는다', () => {
  const e = createEngine(SQL);
  e.open(new Uint8Array(chinook));
  const before = e.run('SELECT count(*) FROM Artist').results[0].rows;
  const { results } = e.check("INSERT INTO Artist(Name) VALUES ('check-only'); DELETE FROM Artist; DROP TABLE Album; CREATE TABLE zz(a)");
  assert.equal(results.length, 4);
  assert.ok(results.every((r) => r.ok === true));
  assert.deepEqual(e.run('SELECT count(*) FROM Artist').results[0].rows, before);
  assert.equal(e.schema().some((o) => o.name === 'zz'), false);
  assert.equal(e.schema().some((o) => o.name === 'Album'), true);
});

test('check: 빈 문자열과 공백·주석만 있는 입력은 빈 배열', () => {
  const e = createEngine(SQL);
  e.open(new Uint8Array(chinook));
  assert.deepEqual(e.check('').results, []);
  assert.deepEqual(e.check('  \n\t ').results, []);
  assert.deepEqual(e.check('-- 주석만\n/* x */').results, []);
});

test('check: start/end 는 입력 sql 기준 문 본문과 일치한다', () => {
  const e = createEngine(SQL);
  e.open(new Uint8Array(chinook));
  const sql = "  SELECT 1 ; -- c;\n/* x; */ SELECT 'a;b'  ;\nSELEC 9";
  const { results } = e.check(sql);
  assert.equal(results.length, 3);
  assert.equal(sql.slice(results[0].start, results[0].end), 'SELECT 1');
  assert.equal(sql.slice(results[1].start, results[1].end), "SELECT 'a;b'");
  assert.equal(sql.slice(results[2].start, results[2].end), 'SELEC 9');
  assert.equal(results[2].ok, false);
  assert.equal(results[1].kind, 'SELECT');
});

test('check: DB 가 없으면 예외', () => {
  const e = createEngine(SQL);
  assert.throws(() => e.check('SELECT 1'), /열린 DB/);
});
