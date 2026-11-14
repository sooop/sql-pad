// SQLite 오류 메시지 해석과 실행 전 정적 검사. DOM과 무관하다.
// sql.js 는 오류 위치를 알려 주지 않으므로 렉서 토큰으로 문 안에서 위치를 찾는다.
import { tokenize, KEYWORDS } from './lexer.js';

const CLAUSES = ['SELECT', 'FROM', 'WHERE', 'GROUP BY', 'HAVING', 'WINDOW', 'ORDER BY', 'LIMIT', 'OFFSET'];
const CLAUSE_WORDS = new Set(['FROM', 'WHERE', 'GROUP', 'ORDER', 'LIMIT', 'HAVING']);
const ORDER_TEXT = CLAUSES.join(', ');

const FUNCTIONS = (
  'abs avg coalesce count date datetime group_concat ifnull iif instr julianday length lower ltrim max min nullif printf random replace ' +
  'round rtrim strftime substr sum time total trim typeof upper unixepoch row_number rank dense_rank lag lead first_value last_value ntile ' +
  'sqrt power floor ceil mod pi exp ln log'
).split(' ');

const FUNCTION_ALIASES = {
  LEN: "'len' 대신 'length' 를 쓰세요.",
  CHAR_LENGTH: "'char_length' 대신 'length' 를 쓰세요.",
  NOW: "현재 시각은 datetime('now') 로 구합니다.",
  GETDATE: "현재 시각은 datetime('now') 로 구합니다.",
  CURDATE: "오늘 날짜는 date('now') 로 구합니다.",
  CONCAT: '문자열 이어붙이기는 || 연산자를 씁니다. 예: a || b',
  NVL: "'NVL' 대신 'coalesce' 를 쓰세요.",
  ISNULL: "'ISNULL' 대신 'coalesce' 를 쓰세요. 조건이라면 'X IS NULL' 로 씁니다.",
  SUBSTRING: "'substring' 대신 'substr' 를 쓰세요.",
  CHARINDEX: "'charindex' 대신 'instr' 를 쓰세요.",
  LCASE: "'lcase' 대신 'lower' 를 쓰세요.",
  UCASE: "'ucase' 대신 'upper' 를 쓰세요.",
  STRING_AGG: "'string_agg' 대신 'group_concat' 를 쓰세요.",
  CEILING: "'ceiling' 대신 'ceil' 를 쓰세요.",
};

// 오타 후보. 거리가 같으면 앞쪽(흔한 키워드)이 이긴다.
const COMMON_KEYWORDS = (
  'SELECT FROM WHERE GROUP ORDER HAVING LIMIT JOIN INNER LEFT ON AND OR NOT IN LIKE BETWEEN DISTINCT UNION OFFSET INSERT INTO VALUES ' +
  'UPDATE SET DELETE CREATE TABLE DROP ALTER WITH'
).split(' ');
const KEYWORD_CANDIDATES = [...COMMON_KEYWORDS, ...[...KEYWORDS].filter((k) => !COMMON_KEYWORDS.includes(k))];
const STATEMENT_STARTERS = (
  'SELECT INSERT UPDATE DELETE CREATE DROP ALTER WITH PRAGMA EXPLAIN BEGIN COMMIT ROLLBACK VACUUM REPLACE ATTACH DETACH ANALYZE REINDEX VALUES SAVEPOINT RELEASE'
).split(' ');

/** 편집 거리(Damerau-Levenshtein, 인접 문자 바꿈을 1로 센다). 대소문자를 구분한다. */
export function editDistance(a, b) {
  a = String(a);
  b = String(b);
  const n = a.length;
  const m = b.length;
  if (!n) return m;
  if (!m) return n;
  const d = [];
  for (let i = 0; i <= n; i++) {
    d.push(new Array(m + 1).fill(0));
    d[i][0] = i;
  }
  for (let j = 0; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2][j - 2] + 1);
      d[i][j] = v;
    }
  }
  return d[n][m];
}

/** 후보 중 가장 비슷한 이름. 대소문자 무시. 거리가 상한(기본: 길이/3, 최소 1, 최대 3)을 넘으면 null. */
export function closestName(name, candidates, maxDist) {
  const s = String(name || '').toLowerCase();
  if (!s || !candidates) return null;
  const limit = maxDist ?? Math.min(3, Math.max(1, Math.floor(s.length / 3)));
  let best = null;
  let bestD = Infinity;
  for (const c of candidates) {
    const dist = editDistance(s, String(c).toLowerCase());
    if (dist < bestD) {
      best = c;
      bestD = dist;
    }
  }
  return best !== null && bestD <= limit ? best : null;
}

// ---------- 토큰 도우미 ----------

function sigTokens(sql) {
  return tokenize(sql).filter((t) => t.type !== 'ws' && t.type !== 'comment');
}

const up = (t) => t.text.toUpperCase();
const isKw = (t, ...names) => !!t && t.type === 'keyword' && names.includes(up(t));
const isP = (t, ch) => !!t && t.type === 'punct' && t.text === ch;

/** 괄호 깊이. '(' 와 ')' 토큰은 바깥 깊이에 둔다. */
function withDepth(sig) {
  let d = 0;
  return sig.map((t) => {
    if (isP(t, '(')) return d++;
    if (isP(t, ')')) {
      d = Math.max(0, d - 1);
      return d;
    }
    return d;
  });
}

function unclosedQuote(t, len) {
  if (t.type !== 'string' && t.type !== 'ident') return false;
  if (t.end !== len) return false;
  const close = t.text[0] === '[' ? ']' : t.text[0];
  return t.text.length === 1 || t.text[t.text.length - 1] !== close;
}

/** 식별자·단어 토큰이 가리키는 이름. 따옴표는 벗긴다. 그 밖의 토큰은 null. */
function nameOf(t) {
  if (t.type === 'word' || t.type === 'keyword') return t.text;
  if (t.type === 'ident') {
    const q = t.text[0];
    if (q === '[') return t.text.endsWith(']') ? t.text.slice(1, -1) : null;
    if (t.text.length < 2 || t.text[t.text.length - 1] !== q) return null;
    return t.text.slice(1, -1).split(q + q).join(q);
  }
  return null;
}

function findName(sig, name) {
  const lower = name.toLowerCase();
  return sig.find((t) => {
    const n = nameOf(t);
    return n !== null && n.toLowerCase() === lower;
  });
}

/** 이름이 쓰인 첫 토큰. AS 바로 뒤(별칭 정의)는 뒤로 미룬다. */
function findUse(sig, name) {
  const lower = name.toLowerCase();
  const hits = sig.filter((t) => (nameOf(t) || '').toLowerCase() === lower);
  return hits.find((t) => !isKw(sig[sig.indexOf(t) - 1], 'AS')) || hits[0];
}

function rangeOf(t) {
  return t ? { from: t.start, to: t.end } : null;
}

/** 키워드 오타 후보. 짧은 단어는 오탐이 많아 제안하지 않는다. */
function keywordTypo(text, pool = KEYWORD_CANDIDATES) {
  if (!/^[A-Za-z_]+$/.test(text)) return null;
  const s = text.toUpperCase();
  if (KEYWORDS.has(s)) return null;
  const limit = s.length <= 3 ? 0 : s.length <= 6 ? 1 : 2;
  if (!limit) return null;
  let best = null;
  let bestD = Infinity;
  for (const k of pool) {
    const dist = editDistance(s, k);
    if (dist < bestD) {
      best = k;
      bestD = dist;
    }
  }
  return best && bestD >= 1 && bestD <= limit ? best : null;
}

// ---------- 절 순서 ----------

/** 최상위 절 순서 위반. SELECT 나 WITH 로 시작하지 않는 문은 검사하지 않는다. */
function clauseOrderIssues(sig, depth) {
  const first = sig[0];
  if (!first || !isKw(first, 'SELECT', 'WITH')) return [];
  const issues = [];
  let started = false;
  let maxRank = -1;
  let maxName = '';
  for (let i = 0; i < sig.length; i++) {
    const t = sig[i];
    if (depth[i] !== 0 || t.type !== 'keyword') continue;
    const w = up(t);
    if (w === 'UNION' || w === 'INTERSECT' || w === 'EXCEPT') {
      maxRank = -1;
      maxName = '';
      continue;
    }
    let name = null;
    let last = t;
    if (w === 'GROUP' || w === 'ORDER') {
      if (isKw(sig[i + 1], 'BY')) {
        name = w + ' BY';
        last = sig[i + 1];
      }
    } else if (w === 'FROM') {
      if (!isKw(sig[i - 1], 'DISTINCT')) name = 'FROM'; // IS DISTINCT FROM 은 절이 아니다
    } else if (['SELECT', 'WHERE', 'HAVING', 'WINDOW', 'LIMIT', 'OFFSET'].includes(w)) {
      name = w;
    }
    if (!name) continue;
    if (name === 'SELECT') started = true;
    if (!started) continue;
    const rank = CLAUSES.indexOf(name);
    if (rank < maxRank) {
      issues.push({ tok: t, name, before: maxName, range: { from: t.start, to: last.end }, message: `${name} 는 ${maxName} 앞에 와야 합니다` });
    } else if (rank > maxRank) {
      maxRank = rank;
      maxName = name;
    }
  }
  return issues;
}

// ---------- lintStatement ----------

/**
 * 실행 전 정적 검사. 엔진 없이 렉서만으로 잡을 수 있는 실수.
 * @returns {{ level: 'error'|'warning', message: string, range: {from:number,to:number} }[]} 문 본문 기준 위치
 */
export function lintStatement(sql) {
  sql = typeof sql === 'string' ? sql : '';
  const sig = sigTokens(sql);
  if (!sig.length) return [];
  const depth = withDepth(sig);
  const out = [];
  const add = (level, message, range) => out.push({ level, message, range });

  // 괄호 불일치
  const stack = [];
  for (const t of sig) {
    if (isP(t, '(')) stack.push(t);
    else if (isP(t, ')')) {
      if (stack.length) stack.pop();
      else add('error', '짝이 없는 닫는 괄호입니다', rangeOf(t));
    }
  }
  for (const t of stack) add('error', '닫히지 않은 괄호가 있습니다', rangeOf(t));

  // 닫히지 않은 따옴표
  for (const t of sig) if (unclosedQuote(t, sql.length)) add('error', '닫히지 않은 따옴표가 있습니다', rangeOf(t));

  // 절 순서
  for (const is of clauseOrderIssues(sig, depth)) add('error', is.message, is.range);

  // 절 키워드 직전 쉼표
  for (let i = 0; i < sig.length - 1; i++) {
    if (!isP(sig[i], ',')) continue;
    const n = sig[i + 1];
    if (isP(n, ')') || (n.type === 'keyword' && CLAUSE_WORDS.has(up(n)))) add('error', '쉼표 뒤에 항목이 없습니다', rangeOf(sig[i]));
  }

  // 문 첫 단어 오타
  if (sig[0].type === 'word') {
    const k = keywordTypo(sig[0].text, STATEMENT_STARTERS);
    if (k) add('warning', `'${sig[0].text}' 은 '${k}' 의 오타로 보입니다`, rangeOf(sig[0]));
  }

  // 큰따옴표 문자열 의심
  const dqMsg = '큰따옴표는 이름을 감쌀 때 씁니다. 문자열 값은 작은따옴표로 감싸세요. SQLite 는 없는 이름을 문자열로 조용히 바꾸기도 합니다.';
  const lists = []; // 열린 괄호마다 IN/VALUES 목록 여부
  let valuesDepth = -1;
  for (let i = 0; i < sig.length; i++) {
    const t = sig[i];
    const prev = sig[i - 1];
    if (isKw(t, 'VALUES')) valuesDepth = depth[i];
    if (isP(t, '(')) {
      lists.push(isKw(prev, 'IN', 'VALUES') || (isP(prev, ',') && valuesDepth === depth[i]));
    } else if (isP(t, ')')) {
      lists.pop();
    } else if (t.type === 'ident' && t.text[0] === '"' && !unclosedQuote(t, sql.length) && !isP(sig[i + 1], '.')) {
      const afterOp = prev && prev.type === 'punct' && '=<>!'.includes(prev.text);
      const afterLike = isKw(prev, 'LIKE', 'GLOB');
      const inList = lists[lists.length - 1] && (isP(prev, '(') || isP(prev, ','));
      if (afterOp || afterLike || inList) add('warning', dqMsg, rangeOf(t));
    }
  }

  // JOIN 에 ON/USING 이 없음
  const MODS = ['LEFT', 'RIGHT', 'FULL', 'INNER', 'OUTER', 'NATURAL', 'CROSS'];
  const STOPS = ['WHERE', 'GROUP', 'HAVING', 'ORDER', 'LIMIT', 'WINDOW', 'OFFSET', 'UNION', 'INTERSECT', 'EXCEPT', 'JOIN', 'RETURNING'];
  for (let i = 0; i < sig.length; i++) {
    if (!isKw(sig[i], 'JOIN')) continue;
    let natural = false;
    for (let k = i - 1; k >= 0 && sig[k].type === 'keyword' && MODS.includes(up(sig[k])); k--) {
      if (isKw(sig[k], 'NATURAL', 'CROSS')) natural = true;
    }
    if (natural) continue;
    let ok = false;
    for (let k = i + 1; k < sig.length; k++) {
      if (depth[k] < depth[i]) break;
      if (depth[k] > depth[i]) continue;
      if (isKw(sig[k], 'ON', 'USING')) {
        ok = true;
        break;
      }
      if (sig[k].type === 'keyword' && STOPS.includes(up(sig[k]))) break;
      if (isP(sig[k], ';')) break;
    }
    if (!ok) add('warning', 'JOIN 에 ON 조건이 없어 모든 행 조합(교차 조인)이 됩니다', rangeOf(sig[i]));
  }

  return out.sort((a, b) => a.range.from - b.range.from);
}

// ---------- explainError ----------

function result(kind, title, detail = '', suggestion = '', range = null) {
  return { kind, title, detail, suggestion, range };
}

function splitTC(s) {
  const parts = s.split(',').map((x) => x.trim());
  const i = parts[0].lastIndexOf('.');
  return [i < 0 ? '' : parts[0].slice(0, i), parts.map((x) => x.split('.').pop()).join(', ')];
}

const AGG_RE = /^(count|sum|avg|min|max|total|group_concat)$/i;

/**
 * SQLite 오류 메시지를 해석한다.
 * @param message 엔진이 돌려준 문자열
 * @param sql 오류가 난 문 본문(문 하나)
 * @param schema { [테이블]: [열, ...] } 또는 null
 * @returns {{ kind: string, title: string, detail: string, suggestion: string, range: {from:number,to:number}|null }}
 */
export function explainError(message, sql, schema) {
  message = String(message ?? '').trim();
  sql = typeof sql === 'string' ? sql : '';
  const sig = sigTokens(sql);
  const depth = withDepth(sig);
  const tables = schema && typeof schema === 'object' ? Object.keys(schema) : [];
  let m;

  if ((m = /^near "([\s\S]*)": syntax error$/.exec(message))) return explainNear(m[1], sig, depth);

  if ((m = /^unrecognized token: "([\s\S]*)"$/.exec(message)) && /^['"]/.test(m[1])) {
    const tok = sig.find((t) => t.text === m[1]);
    const from = tok ? tok.start : sql.lastIndexOf(m[1]);
    return result(
      'unclosed',
      '닫히지 않은 따옴표가 있습니다',
      "문자열은 작은따옴표('...')로, 이름은 큰따옴표(\"...\")로 감쌉니다. 따옴표 안의 따옴표는 두 번('') 씁니다.",
      '',
      from >= 0 ? { from, to: sql.length } : null,
    );
  }

  if (message === 'incomplete input') {
    const open = lintStatement(sql).find((x) => x.message === '닫히지 않은 괄호가 있습니다');
    return result('syntax', '문이 끝나지 않았습니다', '괄호가 닫히지 않았거나 절이 비어 있습니다.', '', open ? open.range : rangeOf(sig[sig.length - 1]));
  }

  if ((m = /^no such table: ([\s\S]+)$/.exec(message))) {
    const name = m[1].split('.').pop();
    const near = closestName(name, tables);
    const range = rangeOf(findName(sig, name));
    const title = `'${name}' 테이블을 찾을 수 없습니다`;
    if (near) return result('no-table', title, '', `'${name}' 테이블은 없습니다. '${near}' 를 찾으셨나요?`, range);
    return result('no-table', title, '열린 DB 에 이 이름의 테이블이나 뷰가 없습니다. 왼쪽 목록에서 이름을 확인하세요.', '', range);
  }

  if ((m = /^no such column: ([\s\S]+)$/.exec(message))) {
    const name = m[1].split('.').pop();
    const cols = [...new Set(tables.flatMap((t) => (Array.isArray(schema[t]) ? schema[t] : [])))];
    const near = closestName(name, cols);
    const lower = name.toLowerCase();
    const quoted = sig.find((t) => t.type === 'ident' && t.text[0] === '"' && (nameOf(t) || '').toLowerCase() === lower);
    let detail = '';
    if (quoted) detail = '큰따옴표는 열이나 테이블 이름을 감쌀 때 씁니다. 문자열 값은 작은따옴표로 감싸세요.';
    else if (!near && sig.some((t, i) => isKw(t, 'AS') && sig[i + 1] && (nameOf(sig[i + 1]) || '').toLowerCase() === lower)) {
      detail = 'SELECT 에서 만든 별칭은 WHERE 에서 쓸 수 없습니다. 원래 식을 다시 쓰거나 서브쿼리로 감싸세요.';
    }
    return result('no-column', `'${name}' 열을 찾을 수 없습니다`, detail, near ? `'${name}' 열은 없습니다. '${near}' 을 찾으셨나요?` : '', rangeOf(quoted || findUse(sig, name)));
  }

  if ((m = /^ambiguous column name: ([\s\S]+)$/.exec(message))) {
    const name = m[1].split('.').pop();
    return result('ambiguous', '같은 이름의 열이 여러 테이블에 있습니다', `'${name}' 열이 FROM 의 여러 테이블에 있어 어느 쪽인지 알 수 없습니다.`, `테이블 이름이나 별칭을 앞에 붙이세요. 예: a.${name}`, rangeOf(findName(sig, name)));
  }

  if ((m = /^misuse of aggregate(?: function)?:? *([A-Za-z_]\w*)?/.exec(message))) {
    const fn = (m[1] || '').toLowerCase();
    const tok = sig.find((t, i) => (t.type === 'word' || t.type === 'keyword') && isP(sig[i + 1], '(') && (fn ? t.text.toLowerCase() === fn : AGG_RE.test(t.text)));
    return result('aggregate', '집계 함수를 쓸 수 없는 자리입니다', '집계 함수(COUNT, SUM, AVG, MIN, MAX)는 WHERE 에 쓸 수 없습니다. 그룹별 조건은 HAVING 에 씁니다.', '', rangeOf(tok));
  }

  if ((m = /^no such function: ([\s\S]+)$/.exec(message))) {
    const name = m[1];
    const tok = sig.find((t, i) => (t.type === 'word' || t.type === 'keyword') && t.text.toLowerCase() === name.toLowerCase() && isP(sig[i + 1], '('));
    const alias = FUNCTION_ALIASES[name.toUpperCase()];
    const near = alias ? null : closestName(name, FUNCTIONS);
    const suggestion = alias || (near ? `'${name}' 함수는 없습니다. '${near}' 를 찾으셨나요?` : '');
    return result('other', `'${name}' 은 없는 함수입니다`, 'SQLite 에 없는 함수입니다. 다른 DB 의 함수 이름일 수 있습니다.', suggestion, rangeOf(tok));
  }

  if ((m = /^UNIQUE constraint failed: ([\s\S]+)$/.exec(message))) {
    const [t, c] = splitTC(m[1]);
    return result('other', '중복 값은 넣을 수 없습니다', `${t ? t + ' 테이블의 ' : ''}${c} 열은 값이 고유해야 합니다.`);
  }
  if ((m = /^NOT NULL constraint failed: ([\s\S]+)$/.exec(message))) {
    const [t, c] = splitTC(m[1]);
    return result('other', `${c} 열은 비울 수 없습니다`, `${t ? t + ' 테이블의 ' : ''}${c} 열에는 NULL 을 넣을 수 없습니다. 값을 채워 주세요.`);
  }
  if (/^FOREIGN KEY constraint failed/.test(message)) return result('other', '참조하는 행이 없습니다', '부모 테이블에 값이 먼저 있어야 합니다.');
  if (/^datatype mismatch/.test(message)) return result('other', '열의 자료형과 맞지 않는 값입니다', 'INTEGER PRIMARY KEY 열 등에는 정수만 넣을 수 있습니다.');

  return result('other', message);
}

function explainNear(x, sig, depth) {
  const xl = x.toLowerCase();
  const matches = sig.filter((t) => t.text.toLowerCase() === xl);
  const first = matches[0];
  const word = x.toUpperCase();

  // 1. 절 키워드 앞에 쉼표가 남음
  if (CLAUSE_WORDS.has(word) || word === 'JOIN') {
    for (const t of matches) {
      const prev = sig[sig.indexOf(t) - 1];
      if (isP(prev, ',')) {
        return result('syntax', '절 앞에 쉼표가 남아 있습니다', 'SELECT 목록이나 GROUP BY 목록의 마지막 항목 뒤에는 쉼표를 쓰지 않습니다.', '앞의 쉼표를 지우세요.', rangeOf(prev));
      }
    }
  }

  // 2, 3. 절 순서 위반
  const issue = clauseOrderIssues(sig, depth).find((is) => is.tok.text.toLowerCase() === xl);
  if (word === 'WHERE') {
    let tok = issue && ['GROUP BY', 'HAVING', 'ORDER BY'].includes(issue.before) ? issue.tok : null;
    if (!tok) {
      // 하위 질의 등 최상위가 아닌 곳: 앞에 GROUP BY/HAVING/ORDER BY 가 있는 첫 WHERE
      tok = matches.find((t) => sig.slice(0, sig.indexOf(t)).some((p, k, arr) => isKw(p, 'HAVING') || (isKw(p, 'GROUP', 'ORDER') && isKw(arr[k + 1], 'BY'))));
    }
    if (tok) return result('syntax', 'WHERE 의 위치가 잘못되었습니다', 'WHERE 는 FROM 바로 뒤, GROUP BY 앞에 옵니다. 그룹별 조건은 HAVING 에 씁니다.', 'WHERE 를 FROM 바로 뒤로 옮기세요.', rangeOf(tok));
  }
  if (issue) return result('syntax', issue.message, `SQL 의 절 순서는 ${ORDER_TEXT} 입니다.`, `${issue.name} 를 ${issue.before} 앞으로 옮기세요.`, rangeOf(issue.tok));

  // 4. 키워드 오타
  if (first && first.type === 'word') {
    const k = keywordTypo(x);
    if (k) return result('syntax', '키워드 오타로 보입니다', '', `'${first.text}' 대신 '${k}' 를 쓰려던 것 같습니다.`, rangeOf(first));
  }

  // 13. 일반 문법 오류
  return result('syntax', `'${x}' 근처에 문법 오류가 있습니다`, 'SQLite 는 처음 막힌 토큰만 알려 줍니다. 실제 실수는 이 토큰 바로 앞일 때가 많습니다(빠진 쉼표, 빠진 키워드, 짝이 맞지 않는 괄호).', '', rangeOf(first));
}
