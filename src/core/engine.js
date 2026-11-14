// sql.js(SQLite WASM) 위의 DB 엔진. DOM과 무관하며 워커 안과 node 테스트에서 같은 코드를 쓴다.
// 화면 쪽은 이 파일의 반환 형태(JSON으로 복제 가능한 값)만 알면 된다.
import { splitStatements, statementKind } from './sqlsplit.js';
import { quoteIdent } from './format.js';

const SCHEMA_KINDS = new Set(['CREATE', 'DROP', 'ALTER']);
const WRITE_KINDS = new Set(['INSERT', 'UPDATE', 'DELETE', 'REPLACE', 'CREATE', 'DROP', 'ALTER', 'VACUUM', 'REINDEX']);

const now = () => (globalThis.performance ? globalThis.performance.now() : Date.now());

function cellOut(v) {
  return v instanceof Uint8Array ? { $blob: v.length } : v;
}

/** @param SQL initSqlJs()가 돌려준 모듈 */
export function createEngine(SQL) {
  let db = null;

  const need = () => {
    if (!db) throw new Error('열린 DB가 없습니다.');
    return db;
  };

  /** 결과 한 덩어리를 객체 배열로 바꾼다. */
  const rows = (sql) => {
    const r = need().exec(sql);
    if (!r.length) return [];
    const { columns, values } = r[0];
    return values.map((v) => Object.fromEntries(columns.map((c, i) => [c, v[i]])));
  };

  function open(bytes) {
    if (db) db.close();
    db = null;
    const next = new SQL.Database(bytes);
    try {
      next.exec('SELECT count(*) FROM sqlite_master'); // SQLite 파일이 아니면 여기서 오류가 난다
    } catch (e) {
      next.close();
      throw e;
    }
    db = next;
    return { version: rows('SELECT sqlite_version() AS v')[0].v };
  }

  function close() {
    if (db) db.close();
    db = null;
  }

  function columnsOf(name) {
    try {
      return rows(`PRAGMA table_xinfo(${quoteIdent(name)})`).map((c) => ({
        cid: c.cid, name: c.name, type: c.type || '', notnull: !!c.notnull, dflt: c.dflt_value, pk: c.pk, hidden: c.hidden,
      }));
    } catch {
      return [];
    }
  }

  function countOf(name) {
    try {
      return rows(`SELECT count(*) AS n FROM ${quoteIdent(name)}`)[0].n;
    } catch {
      return null; // 모듈이 없는 가상 테이블, 깨진 뷰 등
    }
  }

  /** 테이블과 뷰 목록(열, 행 수 포함). 시스템 테이블(sqlite_*)은 뺀다. */
  function schema() {
    const objs = rows(
      "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY type DESC, name COLLATE NOCASE"
    );
    return objs.map((o) => ({
      type: o.type,
      name: o.name,
      columns: columnsOf(o.name),
      rowCount: o.type === 'table' ? countOf(o.name) : null,
    }));
  }

  /** 선택한 테이블/뷰의 상세: 열, 외래 키, 인덱스, 트리거, DDL. */
  function detail(name) {
    const meta = rows(`SELECT type, sql FROM sqlite_master WHERE name = '${String(name).replace(/'/g, "''")}' AND type IN ('table','view')`)[0];
    if (!meta) throw new Error(`'${name}' 객체를 찾을 수 없습니다.`);
    const fks = rows(`PRAGMA foreign_key_list(${quoteIdent(name)})`).map((f) => ({
      id: f.id, from: f.from, table: f.table, to: f.to, onUpdate: f.on_update, onDelete: f.on_delete,
    }));
    const indexes = rows(`PRAGMA index_list(${quoteIdent(name)})`).map((ix) => ({
      name: ix.name,
      unique: !!ix.unique,
      origin: ix.origin,
      columns: rows(`PRAGMA index_info(${quoteIdent(ix.name)})`).map((c) => c.name),
    }));
    const triggers = rows(
      `SELECT name, sql FROM sqlite_master WHERE type='trigger' AND tbl_name = '${String(name).replace(/'/g, "''")}' ORDER BY name`
    );
    return {
      name,
      type: meta.type,
      ddl: meta.sql || '',
      columns: columnsOf(name),
      foreignKeys: fks,
      indexes,
      triggers,
      rowCount: meta.type === 'table' ? countOf(name) : null,
    };
  }

  function runOne(text, maxRows) {
    const t0 = now();
    const stmt = need().prepare(text);
    try {
      const columns = stmt.getColumnNames();
      const out = [];
      let truncated = false;
      if (columns.length) {
        while (stmt.step()) {
          if (out.length >= maxRows) { truncated = true; break; }
          out.push(stmt.get().map(cellOut));
        }
      } else {
        stmt.step();
      }
      return { columns, rows: out, truncated, changes: columns.length ? null : need().getRowsModified(), ms: now() - t0 };
    } finally {
      stmt.free();
    }
  }

  /**
   * SQL 텍스트를 문 단위로 실행한다. 오류가 나면 그 문까지만 결과에 담고 멈춘다.
   * @returns {{results: object[], dirty: boolean, schemaChanged: boolean}}
   */
  function run(sql, { maxRows = 1000 } = {}) {
    need();
    const results = [];
    let dirty = false;
    let schemaChanged = false;
    for (const s of splitStatements(sql)) {
      const kind = statementKind(s.text);
      try {
        const r = runOne(s.text, maxRows);
        results.push({ sql: s.text, kind, ...r });
        if (WRITE_KINDS.has(kind) && (r.changes > 0 || SCHEMA_KINDS.has(kind))) dirty = true;
        if (SCHEMA_KINDS.has(kind)) schemaChanged = true;
      } catch (e) {
        results.push({ sql: s.text, kind, error: String(e && e.message ? e.message : e) });
        break;
      }
    }
    return { results, dirty, schemaChanged };
  }

  /** 테이블/뷰 데이터 미리보기. */
  function preview(name, { limit = 50, offset = 0 } = {}) {
    const lim = Math.max(1, Math.min(10000, limit | 0));
    const off = Math.max(0, offset | 0);
    const res = run(`SELECT * FROM ${quoteIdent(name)} LIMIT ${lim} OFFSET ${off}`, { maxRows: lim });
    return res.results[0];
  }

  function exportDb() {
    return need().export();
  }

  /**
   * 실행하지 않고 문법·이름 오류만 검사한다(편집기 실시간 검사용). 문마다 prepare 만 하고 step 은 하지 않는다.
   * prepare 는 DB 를 바꾸지 않으므로 쓰기 문(CREATE, INSERT 등)도 안전하다.
   * 한계: 같은 배치 앞 문이 만들 테이블·열은 아직 없으므로, 뒤 문이 "no such table" 등으로 실패할 수 있다.
   * 오류가 나도 다음 문을 계속 검사한다(run 과 다르다).
   * @returns {{results: ({start:number,end:number,kind:string,ok:true}|{start:number,end:number,kind:string,ok:false,error:string})[]}}
   */
  function check(sql) {
    need();
    const results = [];
    for (const s of splitStatements(sql)) {
      const kind = statementKind(s.text);
      try {
        need().prepare(s.text).free();
        results.push({ start: s.start, end: s.end, kind, ok: true });
      } catch (e) {
        // sql.js 는 빈 문자열 등에서 Error 가 아니라 문자열을 던진다
        results.push({ start: s.start, end: s.end, kind, ok: false, error: String(e && e.message ? e.message : e) });
      }
    }
    return { results };
  }

  return { open, close, schema, detail, run, preview, exportDb, check, isOpen: () => !!db };
}
