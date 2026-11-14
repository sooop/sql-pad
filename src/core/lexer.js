// SQL 토크나이저. DOM과 무관하며 문 분리(sqlsplit)와 구문 강조(highlight)가 함께 쓴다.
// 토큰 종류: ws, comment, string, ident(따옴표 식별자), keyword, word, number, punct

export const KEYWORDS = new Set(
  (
    'ABORT ACTION ADD AFTER ALL ALTER ALWAYS ANALYZE AND AS ASC ATTACH AUTOINCREMENT BEFORE BEGIN BETWEEN BY CASCADE CASE CAST CHECK ' +
    'COLLATE COLUMN COMMIT CONFLICT CONSTRAINT CREATE CROSS CURRENT CURRENT_DATE CURRENT_TIME CURRENT_TIMESTAMP DATABASE DEFAULT ' +
    'DEFERRABLE DEFERRED DELETE DESC DETACH DISTINCT DO DROP EACH ELSE END ESCAPE EXCEPT EXCLUDE EXCLUSIVE EXISTS EXPLAIN FAIL FILTER ' +
    'FIRST FOLLOWING FOR FOREIGN FROM FULL GENERATED GLOB GROUP GROUPS HAVING IF IGNORE IMMEDIATE IN INDEX INDEXED INITIALLY INNER ' +
    'INSERT INSTEAD INTERSECT INTO IS ISNULL JOIN KEY LAST LEFT LIKE LIMIT MATCH MATERIALIZED NATURAL NO NOT NOTHING NOTNULL NULL ' +
    'NULLS OF OFFSET ON OR ORDER OTHERS OUTER OVER PARTITION PLAN PRAGMA PRECEDING PRIMARY QUERY RAISE RANGE RECURSIVE REFERENCES ' +
    'REGEXP REINDEX RELEASE RENAME REPLACE RESTRICT RETURNING RIGHT ROLLBACK ROW ROWS SAVEPOINT SELECT SET TABLE TEMP TEMPORARY THEN ' +
    'TIES TO TRANSACTION TRIGGER UNBOUNDED UNION UNIQUE UPDATE USING VACUUM VALUES VIEW VIRTUAL WHEN WHERE WINDOW WITH WITHOUT'
  ).split(' ')
);

const WORD_START = /[A-Za-z_\u0080-￿]/;
const WORD_PART = /[\w$\u0080-￿]/;
const DIGIT = /[0-9]/;
const NUMBER = /^(?:0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/;

function scanQuoted(sql, i, q) {
  const n = sql.length;
  let j = i + 1;
  while (j < n) {
    if (sql[j] === q) {
      if (sql[j + 1] === q) { j += 2; continue; }
      return j + 1;
    }
    j++;
  }
  return n; // 닫히지 않은 따옴표는 끝까지 한 토큰으로 본다
}

export function tokenize(sql) {
  const out = [];
  const n = sql.length;
  let i = 0;
  while (i < n) {
    const c = sql[i];
    let j;
    let type;
    if (/\s/.test(c)) {
      j = i + 1;
      while (j < n && /\s/.test(sql[j])) j++;
      type = 'ws';
    } else if (c === '-' && sql[i + 1] === '-') {
      j = sql.indexOf('\n', i);
      if (j < 0) j = n;
      type = 'comment';
    } else if (c === '/' && sql[i + 1] === '*') {
      j = sql.indexOf('*/', i + 2);
      j = j < 0 ? n : j + 2;
      type = 'comment';
    } else if (c === "'") {
      j = scanQuoted(sql, i, "'");
      type = 'string';
    } else if (c === '"' || c === '`') {
      j = scanQuoted(sql, i, c);
      type = 'ident';
    } else if (c === '[') {
      j = sql.indexOf(']', i + 1);
      j = j < 0 ? n : j + 1;
      type = 'ident';
    } else if (DIGIT.test(c) || (c === '.' && DIGIT.test(sql[i + 1] || ''))) {
      const m = NUMBER.exec(sql.slice(i, i + 64));
      j = i + (m ? m[0].length : 1);
      type = 'number';
    } else if (WORD_START.test(c)) {
      j = i + 1;
      while (j < n && WORD_PART.test(sql[j])) j++;
      type = KEYWORDS.has(sql.slice(i, j).toUpperCase()) ? 'keyword' : 'word';
    } else {
      j = i + 1;
      type = 'punct';
    }
    out.push({ type, text: sql.slice(i, j), start: i, end: j });
    i = j;
  }
  return out;
}
