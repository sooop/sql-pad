// 실행 내역과 저장한 쿼리의 순수 로직(저장소 접근 없음). 저장소는 ui/store.js가 맡는다.

export const LIMITS = { historyMax: 500, savedMax: 200, sqlMaxChars: 200000 };

export function normalizeSql(s) {
  return String(s).replace(/\r\n?/g, '\n').trim();
}

/** 53비트 문자열 해시(cyrb53). 같은 SQL이면 같은 키. */
export function hashSql(s) {
  const str = normalizeSql(s);
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36) + '-' + str.length.toString(36);
}

/**
 * 내역에 실행한 쿼리를 더한다. 같은 SQL은 한 건만 남기고 시각을 갱신해 맨 앞으로 올린다.
 * @returns {{list:object[], status:'added'|'updated'|'oversize', dropped:number}}
 */
export function addHistory(list, { sql, dbName = '', ts = Date.now() }, max = LIMITS.historyMax) {
  const text = normalizeSql(sql);
  if (!text) return { list, status: 'empty', dropped: 0 };
  if (text.length > LIMITS.sqlMaxChars) return { list, status: 'oversize', dropped: 0 };
  const id = hashSql(text);
  const rest = list.filter((e) => e.id !== id);
  const status = rest.length === list.length ? 'added' : 'updated';
  const next = [{ id, sql: text, dbName, ts }, ...rest];
  const dropped = Math.max(0, next.length - max);
  return { list: next.slice(0, max), status, dropped };
}

/** 저장한 쿼리를 추가/갱신한다. 같은 SQL이면 이름만 바꾼다. */
export function upsertSaved(list, { name, sql, ts = Date.now() }, max = LIMITS.savedMax) {
  const text = normalizeSql(sql);
  if (!text) return { list, status: 'empty' };
  if (text.length > LIMITS.sqlMaxChars) return { list, status: 'oversize' };
  const id = hashSql(text);
  const rest = list.filter((e) => e.id !== id);
  if (rest.length >= max && rest.length === list.length) return { list, status: 'full' };
  const label = String(name || '').trim() || text.split('\n')[0].slice(0, 40);
  return { list: [{ id, name: label, sql: text, ts }, ...rest], status: rest.length === list.length ? 'added' : 'updated' };
}

/** 공백으로 나눈 단어를 모두 포함하는 항목만 남긴다(대소문자 무시). */
export function searchEntries(list, query, fields = ['sql', 'name', 'dbName']) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return list;
  return list.filter((e) => {
    const hay = fields.map((f) => String(e[f] || '')).join('\n').toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

export function buildBackup(history, saved) {
  return { app: 'sqlpad', version: 1, exportedAt: new Date().toISOString(), history, saved };
}

function validEntry(e) {
  return e && typeof e.sql === 'string' && normalizeSql(e.sql) && e.sql.length <= LIMITS.sqlMaxChars;
}

/**
 * 백업 JSON을 병합한다. 항목은 검증하고 id를 다시 계산한다.
 * @returns {{history:object[], saved:object[], summary:{added:number,dup:number,skipped:number}}}
 */
export function mergeBackup(current, data) {
  const summary = { added: 0, dup: 0, skipped: 0 };
  const out = { history: current.history.slice(), saved: current.saved.slice() };
  if (!data || data.app !== 'sqlpad') {
    throw new Error('SQLPad 백업 파일이 아닙니다.');
  }
  const merge = (target, incoming, kind) => {
    for (const e of Array.isArray(incoming) ? incoming : []) {
      if (!validEntry(e)) { summary.skipped++; continue; }
      const id = hashSql(e.sql);
      if (target.some((x) => x.id === id)) { summary.dup++; continue; }
      const ts = Number.isFinite(e.ts) ? e.ts : Date.now();
      target.push(kind === 'saved'
        ? { id, name: String(e.name || '').slice(0, 80) || normalizeSql(e.sql).split('\n')[0].slice(0, 40), sql: normalizeSql(e.sql), ts }
        : { id, sql: normalizeSql(e.sql), dbName: String(e.dbName || '').slice(0, 120), ts });
      summary.added++;
    }
    target.sort((a, b) => b.ts - a.ts);
  };
  merge(out.history, data.history, 'history');
  merge(out.saved, data.saved, 'saved');
  out.history = out.history.slice(0, LIMITS.historyMax);
  out.saved = out.saved.slice(0, LIMITS.savedMax);
  return { ...out, summary };
}
