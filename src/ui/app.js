// SQLPad 화면 로직. DB 작업은 모두 워커(core/engine.js)에 요청하고, 이 파일은 상태와 DOM만 다룬다.
// 구조: 상태 -> 세션(DB 1개 = 워커 1개) -> 렌더 함수들 -> 동작(run, open, history) -> 이벤트 연결 -> boot
import { highlightHtml } from '../core/highlight.js';
import { splitStatements, statementIndexAt } from '../core/sqlsplit.js';
import { escapeHtml as esc, humanBytes, formatDuration, cellToText, isBlobCell, toDelimited, identForSql } from '../core/format.js';
import * as H from '../core/history.js';
import { createWorkerClient } from './worker-client.js';
import { kvGet, kvSet, loadSettings, saveSettings } from './store.js';
import { SAMPLES, sampleForName, genericExample } from './samples.js';
import { bindDropZone } from './dropzone.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const MAX_DB_BYTES = 256 * 1024 * 1024;
const fmtN = (n) => Number(n).toLocaleString('ko-KR');

// ---------- 자산(빌드 때 HTML에 들어간 워커 소스, wasm, 샘플) ----------
const ASSETS = JSON.parse($('#assets').textContent);
const b64ToBytes = (s) => {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
const WASM = b64ToBytes(ASSETS.wasm);

// ---------- 상태 ----------
const settings = loadSettings();
const state = {
  sessions: [],
  activeId: null,
  selected: null, // { sid, name }
  detail: null,
  detailTab: 'schema',
  detailToken: 0,
  preview: null,
  bottom: 'results',
  results: null, // { list, active }
  running: false,
  filter: '',
  notices: [],
  busy: '',
  history: [],
  saved: [],
  drawer: { open: false, tab: 'history', query: '', shown: 30, confirm: null, importMsg: '' },
};
let sessionSeq = 0;
let noticeSeq = 0;
const activeSession = () => state.sessions.find((s) => s.id === state.activeId) || null;

// ---------- 세션 ----------
class Session {
  constructor(name, bytes, sampleId) {
    this.id = ++sessionSeq;
    this.name = name;
    this.baseBytes = bytes;
    this.size = bytes.length;
    this.sampleId = sampleId || null;
    this.version = '';
    this.objects = [];
    this.dirty = false;
    this.expanded = new Set();
    this.client = null;
  }
  async start() {
    this.client = createWorkerClient(ASSETS.worker);
    await this.client.call('init', { wasm: WASM });
    const info = await this.client.call('open', { bytes: this.baseBytes });
    this.version = info.version;
    await this.refreshSchema();
  }
  async refreshSchema() {
    this.objects = await this.client.call('schema');
  }
  /** 워커를 새로 만들고 처음 열었던 상태로 되돌린다. */
  async restore() {
    this.client.restart();
    await this.client.call('init', { wasm: WASM });
    const info = await this.client.call('open', { bytes: this.baseBytes });
    this.version = info.version;
    await this.refreshSchema();
    this.dirty = false;
  }
  dispose() {
    if (this.client) this.client.dispose();
  }
}

// ---------- 알림 ----------
function notify(text) {
  state.notices.push({ id: ++noticeSeq, text });
  if (state.notices.length > 3) state.notices.shift();
  renderSideStatus();
}
function setBusy(text) {
  state.busy = text;
  renderSideStatus();
}
function renderSideStatus() {
  const el = $('#side-status');
  el.innerHTML =
    state.notices
      .map(
        (n) =>
          `<div class="notice" role="alert"><span>${esc(n.text)}</span><button class="icon-btn" type="button" data-act="notice-x" data-id="${n.id}" aria-label="닫기" title="닫기"><svg class="ic"><use href="#i-x"/></svg></button></div>`
      )
      .join('') + (state.busy ? `<div>${esc(state.busy)}</div>` : '');
}

// ---------- 렌더: 파일 목록 ----------
function renderFiles() {
  const list = $('#file-list');
  list.innerHTML = state.sessions
    .map((s) => {
      const active = s.id === state.activeId;
      return `<li class="file-item${active ? ' active' : ''}${s.dirty ? ' dirty' : ''}" data-sid="${s.id}">
        <button class="file-main" type="button" data-act="activate"${active ? ' aria-current="true"' : ''}>
          <span class="file-name">${esc(s.name)}</span>
          <span class="file-meta">${humanBytes(s.size)} · SQLite ${esc(s.version)}</span>
        </button>
        ${active && s.dirty ? `<button class="icon-btn" type="button" data-act="reset" aria-label="처음 상태로 되돌리기" title="처음 상태로 되돌리기"><svg class="ic"><use href="#i-undo"/></svg></button>` : ''}
        ${active ? `<button class="icon-btn" type="button" data-act="export" aria-label="DB 파일로 저장" title="DB 파일로 저장"><svg class="ic"><use href="#i-download"/></svg></button>` : ''}
        <button class="icon-btn" type="button" data-act="close" aria-label="닫기" title="닫기"><svg class="ic"><use href="#i-x"/></svg></button>
      </li>`;
    })
    .join('');
  const s = activeSession();
  $('#active-label').textContent = s ? s.name : '열린 DB 없음';
  $('#btn-example').disabled = !s;
}

// ---------- 렌더: 테이블 트리 ----------
function renderTree() {
  const el = $('#tree');
  const s = activeSession();
  if (!s) { el.innerHTML = ''; return; }
  const words = state.filter.toLowerCase().split(/\s+/).filter(Boolean);
  const objs = s.objects.filter((o) => words.every((w) => o.name.toLowerCase().includes(w)));
  const group = (type, label) => {
    const items = objs.filter((o) => o.type === type);
    if (!items.length) return '';
    return (
      `<div class="tree-group">${label} ${items.length}</div>` +
      items
        .map((o) => {
          const open = s.expanded.has(o.name);
          const sel = state.selected && state.selected.sid === s.id && state.selected.name === o.name;
          const cols = open
            ? `<ul class="cols">${o.columns
                .map(
                  (c) =>
                    `<li><button class="col-btn" type="button" data-act="col" data-col="${esc(c.name)}" title="커서 위치에 열 이름 넣기"><span>${esc(c.name)}</span>${c.pk ? '<span class="pk-tag">PK</span>' : ''}<span class="ty">${esc(c.type)}</span></button></li>`
                )
                .join('')}</ul>`
            : '';
          return `<div class="obj" data-name="${esc(o.name)}">
            <div class="obj-row${sel ? ' selected' : ''}">
              <button class="obj-toggle" type="button" data-act="toggle" aria-expanded="${open}" aria-label="${esc(o.name)} 열 목록" title="열 목록"><svg class="ic"><use href="#i-chevron"/></svg></button>
              <button class="obj-name" type="button" data-act="select"${sel ? ' aria-current="true"' : ''}><svg class="ic"><use href="#${o.type === 'view' ? 'i-eye' : 'i-table'}"/></svg><span class="t">${esc(o.name)}</span><span class="n">${o.rowCount === null ? '' : fmtN(o.rowCount)}</span></button>
            </div>${cols}</div>`;
        })
        .join('')
    );
  };
  const html = group('table', '테이블') + group('view', '뷰');
  el.innerHTML = html || (words.length ? '<div class="tree-empty">일치하는 항목이 없습니다</div>' : '');
}

// ---------- 렌더: 결과 표 ----------
function gridHtml(columns, rows, rowOffset = 0) {
  const head = `<tr><th class="rn">#</th>${columns.map((c) => `<th title="${esc(c)}">${esc(c)}</th>`).join('')}</tr>`;
  const body = rows
    .map((r, i) => {
      const tds = r
        .map((v) => {
          if (v === null || v === undefined) return '<td class="null">NULL</td>';
          if (isBlobCell(v)) return `<td class="blob">${esc(cellToText(v))}</td>`;
          if (typeof v === 'number') return `<td class="num">${esc(v)}</td>`;
          const s = String(v);
          return `<td title="${esc(s.length > 400 ? s.slice(0, 400) + '…' : s)}">${esc(s)}</td>`;
        })
        .join('');
      return `<tr><td class="rn">${rowOffset + i + 1}</td>${tds}</tr>`;
    })
    .join('');
  return `<table class="grid"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

function renderResults() {
  const el = $('#pane-results');
  const r = state.results;
  if (!r) { el.innerHTML = ''; return; }
  const list = r.list;
  const cur = list[r.active];
  let html = '';
  if (list.length > 1) {
    html +=
      '<div class="chips">' +
      list
        .map((x, i) => {
          const label = x.error ? '오류' : x.columns && x.columns.length ? `${fmtN(x.rows.length)}행` : x.changes != null ? `${fmtN(x.changes)}행 변경` : '완료';
          return `<button class="chip${x.error ? ' err' : ''}" type="button" data-act="chip" data-i="${i}" aria-pressed="${i === r.active}">${i + 1} ${esc(x.kind || '')} · ${label}</button>`;
        })
        .join('') +
      '</div>';
  }
  if (!cur) {
    el.innerHTML = html + '<div class="pane-empty">실행할 문이 없습니다.</div>';
    return;
  }
  if (cur.info) {
    el.innerHTML = html + `<div class="ok-box" role="status">${esc(cur.info)}</div>`;
    return;
  }
  if (cur.error) {
    el.innerHTML = html + `<div class="err-box" role="alert"><div>${esc(cur.error)}</div>${cur.sql ? `<pre class="stmt">${esc(cur.sql)}</pre>` : ''}</div>`;
    return;
  }
  if (!cur.columns.length) {
    const chg = cur.changes != null ? ` · ${fmtN(cur.changes)}행 변경` : '';
    el.innerHTML = html + `<div class="ok-box" role="status">${esc(cur.kind)} 완료${chg} · ${formatDuration(cur.ms)}</div>`;
    return;
  }
  const count = `${fmtN(cur.rows.length)}행${cur.truncated ? ' (이후 행은 표시하지 않음)' : ''} · ${formatDuration(cur.ms)}`;
  const sizes = [100, 1000, 5000].map((n) => `<option value="${n}"${settings.maxRows === n ? ' selected' : ''}>${fmtN(n)}행까지</option>`).join('');
  el.innerHTML =
    html +
    `<div class="meta-row"><span class="meta-text" role="status">${count}</span><span class="spacer"></span>
      <select id="max-rows" class="select-sm" aria-label="최대 표시 행" title="최대 표시 행 (다음 실행부터 적용)">${sizes}</select>
      <button class="icon-btn" type="button" data-act="copy-result" aria-label="결과 복사" title="결과 복사 (탭 구분)"><svg class="ic"><use href="#i-copy"/></svg></button>
      <button class="icon-btn" type="button" data-act="csv-result" aria-label="CSV로 저장" title="CSV로 저장"><svg class="ic"><use href="#i-download"/></svg></button>
    </div><div class="pane-scroll">${gridHtml(cur.columns, cur.rows)}</div>`;
}

// ---------- 렌더: 테이블 상세 ----------
function renderTablePane() {
  const el = $('#pane-table');
  const d = state.detail;
  if (!state.selected) { el.innerHTML = ''; return; }
  if (!d) { el.innerHTML = '<div class="pane-empty" role="status">불러오는 중…</div>'; return; }
  if (d.error) { el.innerHTML = `<div class="err-box" role="alert">${esc(d.error)}</div>`; return; }
  const subs = [['schema', '스키마'], ['data', '데이터'], ['ddl', 'DDL']]
    .map(([k, label]) => `<button class="chip" type="button" data-act="sub" data-sub="${k}" aria-pressed="${state.detailTab === k}">${label}</button>`)
    .join('');
  const head = `<div class="table-head"><span class="nm">${esc(d.name)}</span><span class="tag">${d.type === 'view' ? '뷰' : '테이블'}</span>${
    d.rowCount === null ? '' : `<span class="meta-text">${fmtN(d.rowCount)}행</span>`
  }<span class="spacer"></span><button class="btn sm" type="button" data-act="insert-select">SELECT 넣기</button></div><div class="subtabs">${subs}</div>`;
  let body = '';
  if (state.detailTab === 'schema') {
    const cols = d.columns
      .map(
        (c) =>
          `<tr><td>${c.cid}</td><td class="mono">${esc(c.name)}</td><td class="mono">${esc(c.type)}</td><td>${c.pk ? 'PK' + (c.pk > 1 ? ' ' + c.pk : '') : ''}</td><td>${c.notnull ? 'NOT NULL' : ''}</td><td class="mono">${c.dflt === null || c.dflt === undefined ? '' : esc(c.dflt)}</td></tr>`
      )
      .join('');
    const fks = d.foreignKeys.length
      ? `<div class="sec-title">외래 키</div><table class="info"><thead><tr><th>열</th><th>참조 테이블</th><th>참조 열</th><th>UPDATE</th><th>DELETE</th></tr></thead><tbody>${d.foreignKeys
          .map((f) => `<tr><td class="mono">${esc(f.from)}</td><td class="mono">${esc(f.table)}</td><td class="mono">${esc(f.to)}</td><td>${esc(f.onUpdate)}</td><td>${esc(f.onDelete)}</td></tr>`)
          .join('')}</tbody></table>`
      : '';
    const idx = d.indexes.length
      ? `<div class="sec-title">인덱스</div><table class="info"><thead><tr><th>이름</th><th>열</th><th>유일</th><th>생성 방식</th></tr></thead><tbody>${d.indexes
          .map((i) => `<tr><td class="mono">${esc(i.name)}</td><td class="mono">${esc(i.columns.join(', '))}</td><td>${i.unique ? '예' : ''}</td><td>${{ c: 'CREATE INDEX', u: 'UNIQUE 제약', pk: '기본 키' }[i.origin] || esc(i.origin)}</td></tr>`)
          .join('')}</tbody></table>`
      : '';
    const trg = d.triggers.length
      ? `<div class="sec-title">트리거</div><table class="info"><tbody>${d.triggers.map((t) => `<tr><td class="mono">${esc(t.name)}</td></tr>`).join('')}</tbody></table>`
      : '';
    body = `<div class="pane-scroll"><table class="info"><thead><tr><th>#</th><th>이름</th><th>타입</th><th>키</th><th>제약</th><th>기본값</th></tr></thead><tbody>${cols}</tbody></table>${fks}${idx}${trg}</div>`;
  } else if (state.detailTab === 'ddl') {
    body = `<div class="pane-scroll"><pre class="ddl">${highlightHtml(d.ddl || '-- DDL 없음')}</pre></div>`;
  } else {
    const p = state.preview;
    if (!p || p.loading) body = '<div class="pane-empty" role="status">불러오는 중…</div>';
    else if (p.error) body = `<div class="err-box" role="alert">${esc(p.error)}</div>`;
    else {
      const size = settings.previewSize;
      const from = p.data.rows.length ? p.offset + 1 : 0;
      const to = p.offset + p.data.rows.length;
      const hasNext = d.rowCount !== null ? to < d.rowCount : p.data.rows.length === size;
      const sizes = [25, 50, 100, 200].map((n) => `<option value="${n}"${size === n ? ' selected' : ''}>${n}행씩</option>`).join('');
      body = `<div class="meta-row"><span class="meta-text" role="status">${fmtN(from)}–${fmtN(to)}${d.rowCount === null ? '' : ' / ' + fmtN(d.rowCount)}</span><span class="spacer"></span>
        <select id="preview-size" class="select-sm" aria-label="페이지 크기">${sizes}</select>
        <button class="icon-btn" type="button" data-act="prev" aria-label="이전 페이지" title="이전 페이지"${p.offset <= 0 ? ' disabled' : ''}><svg class="ic"><use href="#i-chevron-left"/></svg></button>
        <button class="icon-btn" type="button" data-act="next" aria-label="다음 페이지" title="다음 페이지"${hasNext ? '' : ' disabled'}><svg class="ic"><use href="#i-chevron"/></svg></button></div>
        <div class="pane-scroll">${gridHtml(p.data.columns, p.data.rows, p.offset)}</div>`;
    }
  }
  el.innerHTML = head + body;
}

function showBottom(which) {
  state.bottom = which;
  const hasTable = !!state.selected;
  $('#tab-table').hidden = !hasTable;
  $('#tab-table').textContent = hasTable ? state.selected.name : '테이블';
  if (which === 'table' && !hasTable) which = state.bottom = 'results';
  $('#tab-results').setAttribute('aria-selected', String(which === 'results'));
  $('#tab-table').setAttribute('aria-selected', String(which === 'table'));
  $('#pane-results').hidden = which !== 'results';
  $('#pane-table').hidden = which !== 'table';
}

// ---------- 동작: 파일 열기 ----------
const SQLITE_MAGIC = 'SQLite format 3\0';
const isSqliteFile = (u8) => u8.length >= 16 && String.fromCharCode(...u8.subarray(0, 16)) === SQLITE_MAGIC;

function friendlyOpenError(e) {
  const m = String((e && e.message) || e);
  if (/not a database|malformed|encrypted/i.test(m)) return 'SQLite 데이터베이스 파일이 아닙니다. 암호화되었거나 손상된 파일일 수 있습니다.';
  return m;
}

function uniqueName(name) {
  const names = new Set(state.sessions.map((s) => s.name));
  if (!names.has(name)) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let i = 2;
  while (names.has(`${stem} (${i})${ext}`)) i++;
  return `${stem} (${i})${ext}`;
}

async function openBytes(name, bytes, sampleId) {
  const label = uniqueName(name);
  setBusy(`${label} 여는 중…`);
  const s = new Session(label, bytes, sampleId);
  try {
    await s.start();
    state.sessions.push(s);
    activate(s.id);
  } catch (e) {
    s.dispose();
    notify(`${name}: ${friendlyOpenError(e)}`);
  } finally {
    setBusy('');
  }
}

async function openSample(id) {
  const meta = SAMPLES.find((x) => x.id === id);
  if (!meta) return;
  const existing = state.sessions.find((s) => s.sampleId === id);
  if (existing) { activate(existing.id); return; }
  await openBytes(meta.file, b64ToBytes(ASSETS.samples[id]), id);
}

/** 파일 열기 버튼, 드롭 모두 이 함수로 모인다. 형식은 내용으로 판정한다. */
async function handleFiles(files) {
  let sqlText = null;
  let ignored = 0;
  for (const f of files) {
    if (f.size > MAX_DB_BYTES) { notify(`${f.name}: ${humanBytes(MAX_DB_BYTES)}를 넘는 파일은 열 수 없습니다.`); continue; }
    let u8;
    try {
      u8 = new Uint8Array(await f.arrayBuffer());
    } catch {
      notify(`${f.name}: 파일을 읽을 수 없습니다. 폴더는 열 수 없습니다.`);
      continue;
    }
    if (isSqliteFile(u8)) { await openBytes(f.name, u8); continue; }
    let text = null;
    if (!u8.subarray(0, 1024).includes(0)) {
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(u8); } catch { text = null; }
    }
    if (text === null) { notify(`${f.name}: SQLite 파일(.sqlite, .db) 또는 SQL 텍스트(.sql, .txt)만 열 수 있습니다.`); continue; }
    if (text.length > H.LIMITS.sqlMaxChars) { notify(`${f.name}: SQL 텍스트가 ${fmtN(H.LIMITS.sqlMaxChars)}자를 넘습니다.`); continue; }
    if (sqlText === null) sqlText = text; else ignored++;
  }
  if (sqlText !== null) setEditorSql(sqlText, { focus: true });
  if (ignored) notify(`SQL 텍스트는 한 번에 하나만 편집기에 넣을 수 있어 ${ignored}개를 건너뛰었습니다.`);
}

function activate(id) {
  state.activeId = id;
  state.selected = null;
  state.detail = null;
  state.preview = null;
  renderFiles();
  renderTree();
  showBottom('results');
  renderTablePane();
}

async function closeSession(id) {
  const s = state.sessions.find((x) => x.id === id);
  if (!s) return;
  s.dispose();
  state.sessions = state.sessions.filter((x) => x.id !== id);
  if (state.activeId === id) activate(state.sessions.length ? state.sessions[state.sessions.length - 1].id : null);
  else renderFiles();
}

async function resetSession() {
  const s = activeSession();
  if (!s) return;
  setBusy('처음 상태로 되돌리는 중…');
  try {
    await s.restore();
    await afterSchemaChange(s);
    state.results = { list: [{ info: '처음 열었을 때의 상태로 되돌렸습니다.' }], active: 0 };
    renderResults();
    showBottom('results');
  } catch (e) {
    notify(`되돌리기 실패: ${friendlyOpenError(e)}`);
  } finally {
    setBusy('');
    renderFiles();
  }
}

async function exportSession() {
  const s = activeSession();
  if (!s) return;
  try {
    const bytes = await s.client.call('export');
    const dot = s.name.lastIndexOf('.');
    const stem = dot > 0 ? s.name.slice(0, dot) : s.name;
    const ext = dot > 0 ? s.name.slice(dot) : '.sqlite';
    downloadBlob(new Blob([bytes], { type: 'application/vnd.sqlite3' }), s.dirty ? `${stem}-modified${ext}` : s.name);
  } catch (e) {
    notify(`저장 실패: ${e.message}`);
  }
}

// ---------- 동작: 선택한 테이블 ----------
async function selectObject(name) {
  const s = activeSession();
  if (!s) return;
  const token = ++state.detailToken;
  state.selected = { sid: s.id, name };
  state.detail = null;
  state.preview = null;
  showBottom('table');
  renderTree();
  renderTablePane();
  try {
    const d = await s.client.call('detail', { name });
    if (token !== state.detailToken) return;
    state.detail = d;
  } catch (e) {
    if (token !== state.detailToken) return;
    state.detail = { error: e.message };
  }
  renderTablePane();
  if (state.detailTab === 'data' && state.detail && !state.detail.error) loadPreview(0);
}

async function loadPreview(offset) {
  const s = activeSession();
  const sel = state.selected;
  if (!s || !sel) return;
  const token = state.detailToken;
  state.preview = { offset, loading: true };
  renderTablePane();
  try {
    const data = await s.client.call('preview', { name: sel.name, limit: settings.previewSize, offset });
    if (token !== state.detailToken) return;
    state.preview = data.error ? { offset, error: data.error } : { offset, data };
  } catch (e) {
    if (token !== state.detailToken) return;
    state.preview = { offset, error: e.message };
  }
  renderTablePane();
}

/** 스키마가 바뀐 뒤 트리와 선택한 테이블 상세를 다시 맞춘다. */
async function afterSchemaChange(s) {
  renderTree();
  const sel = state.selected;
  if (sel && sel.sid === s.id) {
    if (s.objects.some((o) => o.name === sel.name)) await selectObject(sel.name);
    else { state.selected = null; state.detail = null; showBottom('results'); renderTree(); }
  }
}

// ---------- 동작: 쿼리 실행 ----------
function setRunning(on) {
  state.running = on;
  $('#btn-run').disabled = on;
  $('#btn-run-all').disabled = on;
  $('#btn-cancel').hidden = !on;
}

async function run(mode) {
  if (state.running) return;
  const s = activeSession();
  showBottom('results');
  if (!s) {
    state.results = { list: [{ error: '열린 DB가 없습니다. 파일을 열거나 샘플 DB를 선택하세요.' }], active: 0 };
    renderResults();
    return;
  }
  const ta = $('#sql');
  const text = ta.value;
  let sql;
  if (mode === 'all') sql = text;
  else if (ta.selectionEnd > ta.selectionStart) sql = text.slice(ta.selectionStart, ta.selectionEnd);
  else {
    const stmts = splitStatements(text);
    const i = statementIndexAt(stmts, ta.selectionStart);
    sql = i >= 0 ? stmts[i].text : '';
  }
  if (!sql.trim() || !splitStatements(sql).length) {
    state.results = { list: [], active: 0 };
    renderResults();
    return;
  }
  setRunning(true);
  $('#pane-results').innerHTML = '<div class="pane-empty" role="status">실행 중…</div>';
  try {
    const res = await s.client.call('run', { sql, maxRows: settings.maxRows });
    let active = res.results.length - 1;
    for (let i = res.results.length - 1; i >= 0; i--) {
      if (res.results[i].columns && res.results[i].columns.length) { active = i; break; }
    }
    state.results = { list: res.results, active: Math.max(0, active) };
    if (res.results.some((r) => r.error)) state.results.active = res.results.findIndex((r) => r.error);
    if (res.dirty) s.dirty = true;
    if (res.schemaChanged) { await s.refreshSchema(); await afterSchemaChange(s); }
    renderFiles();
    renderResults();
    recordHistory(sql, s.name);
  } catch (e) {
    if (e.message === 'cancelled' || e.message === 'worker') await recoverAfterStop(s, e.message);
    else { state.results = { list: [{ error: e.message, sql }], active: 0 }; renderResults(); }
  } finally {
    setRunning(false);
  }
}

async function cancelRun() {
  const s = activeSession();
  if (s && state.running) s.client.restart();
}

async function recoverAfterStop(s, reason) {
  const wasDirty = s.dirty;
  try {
    await s.restore();
    await afterSchemaChange(s);
    const msg = reason === 'cancelled' ? '실행을 취소했습니다.' : '엔진이 중단되어 DB를 다시 열었습니다.';
    state.results = { list: [{ info: msg + (wasDirty ? ' 변경 내용은 처음 열었을 때의 상태로 되돌아갔습니다.' : '') }], active: 0 };
  } catch (e) {
    state.results = { list: [{ error: `DB를 다시 열지 못했습니다: ${friendlyOpenError(e)}` }], active: 0 };
  }
  renderFiles();
  renderResults();
}

// ---------- 내역, 저장한 쿼리 ----------
async function loadStores() {
  state.history = await kvGet('history', []);
  state.saved = await kvGet('saved', []);
  renderBadge();
}
function renderBadge() {
  const b = $('#history-badge');
  b.hidden = !state.history.length;
  b.textContent = state.history.length > 99 ? '99+' : String(state.history.length);
}
async function recordHistory(sql, dbName) {
  const r = H.addHistory(state.history, { sql, dbName });
  if (r.status === 'oversize') { notify(`SQL이 ${fmtN(H.LIMITS.sqlMaxChars)}자를 넘어 내역에 저장하지 않았습니다.`); return; }
  if (r.status === 'empty') return;
  state.history = r.list;
  if (r.dropped) notify(`내역이 ${fmtN(H.LIMITS.historyMax)}건을 넘어 오래된 ${r.dropped}건을 정리했습니다.`);
  renderBadge();
  await kvSet('history', state.history);
  if (state.drawer.open) renderDrawerList();
}

/** 편집기 내용을 바꾼다. 교체되는 기존 입력은 내역에 남긴다. */
function setEditorSql(text, { focus = false } = {}) {
  const ta = $('#sql');
  const prev = ta.value;
  if (prev.trim() && prev.trim() !== text.trim()) recordHistory(prev, activeSession() ? activeSession().name : '');
  ta.value = text;
  syncEditor();
  if (focus) { ta.focus(); ta.setSelectionRange(text.length, text.length); }
}

function markHtml(text, words) {
  if (!words.length) return esc(text);
  const re = new RegExp('(' + words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi');
  return text.split(re).map((p, i) => (i % 2 ? `<mark>${esc(p)}</mark>` : esc(p))).join('');
}
const fmtTime = (ts) => new Date(ts).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });

let drawerReturnFocus = null;

function openDrawer(tab) {
  drawerReturnFocus = document.activeElement;
  Object.assign(state.drawer, { open: true, tab, query: '', shown: 30, confirm: null, importMsg: '' });
  $('#drawer').hidden = false;
  $('#drawer-backdrop').hidden = false;
  $('#app').inert = true;
  $('#btn-history').setAttribute('aria-expanded', 'true');
  renderDrawer(true);
}
function closeDrawer() {
  if (!state.drawer.open) return;
  state.drawer.open = false;
  $('#drawer').hidden = true;
  $('#drawer-backdrop').hidden = true;
  $('#app').inert = false;
  $('#btn-history').setAttribute('aria-expanded', 'false');
  if (drawerReturnFocus && drawerReturnFocus.focus) drawerReturnFocus.focus();
}

function renderDrawer(focusFirst) {
  const d = state.drawer;
  $$('#drawer [data-dtab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.dtab === d.tab)));
  const body = $('#drawer-body');
  if (d.tab === 'backup') {
    body.innerHTML = `<div class="field-row"><button class="btn" type="button" data-act="d-export"><svg class="ic"><use href="#i-download"/></svg>내보내기</button>
      <button class="btn" type="button" data-act="d-copy-json"><svg class="ic"><use href="#i-copy"/></svg>JSON 복사</button></div>
      <textarea id="d-json" class="json-in drop-target" aria-label="백업 JSON" spellcheck="false" autocapitalize="off" autocomplete="off"></textarea>
      <div class="field-row"><button class="btn" type="button" data-act="d-pick">파일에서 가져오기</button><button class="btn primary" type="button" data-act="d-import">가져오기</button></div>
      <div id="d-msg" class="meta-text" role="status">${esc(d.importMsg)}</div>
      <input id="d-file" type="file" accept=".json,application/json" hidden>`;
    bindDropZone($('#d-json'), {
      accept: {},
      onFiles: async (files) => { $('#d-json').value = await files[0].text(); },
      onReject: () => {},
    });
    if (focusFirst) $('#d-json').focus();
    return;
  }
  const isSaved = d.tab === 'saved';
  const saveForm = isSaved
    ? `<form id="d-save-form" class="field-row"><input id="d-name" class="text-in" type="text" placeholder="이름" aria-label="저장할 이름" maxlength="80" autocomplete="off"><button class="btn primary" type="submit"${$('#sql').value.trim() ? '' : ' disabled'}>저장</button></form>`
    : '';
  body.innerHTML = `${saveForm}
    <div class="field-row"><input id="d-search" type="search" placeholder="검색" aria-label="검색" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(d.query)}"></div>
    <div id="d-tools" class="list-tools"></div><div id="d-list"></div>`;
  renderDrawerList();
  if (focusFirst) (isSaved ? $('#d-name') : $('#d-search')).focus();
}

function renderDrawerList() {
  const d = state.drawer;
  if (d.tab === 'backup' || !$('#d-list')) return;
  const isSaved = d.tab === 'saved';
  const all = isSaved ? state.saved : state.history;
  const words = d.query.toLowerCase().split(/\s+/).filter(Boolean);
  const found = H.searchEntries(all, d.query);
  const shown = found.slice(0, d.shown);
  const tools = d.confirm === d.tab
    ? `<span class="meta-text">${fmtN(all.length)}건 모두 삭제할까요?</span><span class="grp"><button class="btn sm danger" type="button" data-act="d-clear-yes">삭제</button><button class="btn sm" type="button" data-act="d-clear-no">취소</button></span>`
    : `<span class="meta-text">${words.length ? `${fmtN(found.length)} / ` : ''}${fmtN(all.length)}건</span>${all.length ? '<button class="btn sm" type="button" data-act="d-clear">전체 삭제</button>' : ''}`;
  $('#d-tools').innerHTML = tools;
  $('#d-list').innerHTML =
    shown
      .map(
        (e) => `<div class="entry" data-id="${esc(e.id)}">
          ${isSaved ? `<div class="entry-name">${markHtml(e.name, words)}</div>` : ''}
          <pre class="entry-sql">${markHtml(e.sql.length > 600 ? e.sql.slice(0, 600) + '…' : e.sql, words)}</pre>
          <div class="entry-foot"><span class="grow">${fmtTime(e.ts)}${e.dbName ? ' · ' + esc(e.dbName) : ''}</span>
            <button class="btn sm" type="button" data-act="d-load">불러오기</button>
            <button class="icon-btn" type="button" data-act="d-copy" aria-label="SQL 복사" title="SQL 복사"><svg class="ic"><use href="#i-copy"/></svg></button>
            <button class="icon-btn" type="button" data-act="d-del" aria-label="삭제" title="삭제"><svg class="ic"><use href="#i-trash"/></svg></button></div></div>`
      )
      .join('') + (found.length > shown.length ? `<button class="btn" type="button" data-act="d-more">더 보기 (${fmtN(found.length - shown.length)})</button>` : '');
}

async function persist(kind) {
  await kvSet(kind, state[kind]);
  if (kind === 'history') renderBadge();
}

async function drawerAction(act, target) {
  const d = state.drawer;
  const id = target.closest('.entry') && target.closest('.entry').dataset.id;
  const list = d.tab === 'saved' ? state.saved : state.history;
  const entry = id ? list.find((e) => e.id === id) : null;
  switch (act) {
    case 'd-load':
      if (!entry) return;
      closeDrawer();
      setEditorSql(entry.sql, { focus: true });
      break;
    case 'd-copy':
      if (entry) await copyText(entry.sql);
      break;
    case 'd-del':
      if (!entry) return;
      state[d.tab === 'saved' ? 'saved' : 'history'] = list.filter((e) => e.id !== id);
      await persist(d.tab === 'saved' ? 'saved' : 'history');
      renderDrawerList();
      break;
    case 'd-more':
      d.shown += 30;
      renderDrawerList();
      break;
    case 'd-clear':
      d.confirm = d.tab;
      renderDrawerList();
      break;
    case 'd-clear-no':
      d.confirm = null;
      renderDrawerList();
      break;
    case 'd-clear-yes': {
      const kind = d.tab === 'saved' ? 'saved' : 'history';
      state[kind] = [];
      d.confirm = null;
      await persist(kind);
      renderDrawerList();
      break;
    }
    case 'd-export':
      downloadBlob(new Blob([JSON.stringify(H.buildBackup(state.history, state.saved), null, 2)], { type: 'application/json' }), 'sqlpad-backup.json');
      break;
    case 'd-copy-json':
      await copyText(JSON.stringify(H.buildBackup(state.history, state.saved), null, 2));
      break;
    case 'd-pick':
      $('#d-file').click();
      break;
    case 'd-import': {
      const msg = $('#d-msg');
      try {
        const data = JSON.parse($('#d-json').value);
        const m = H.mergeBackup({ history: state.history, saved: state.saved }, data);
        state.history = m.history;
        state.saved = m.saved;
        await persist('history');
        await persist('saved');
        d.importMsg = `추가 ${m.summary.added}, 중복 ${m.summary.dup}, 제외 ${m.summary.skipped}`;
      } catch (e) {
        d.importMsg = e instanceof SyntaxError ? 'JSON 형식이 올바르지 않습니다.' : e.message;
      }
      msg.textContent = d.importMsg;
      break;
    }
  }
}

// ---------- 파일 저장, 복사 ----------
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const t = document.createElement('textarea');
    t.value = text;
    t.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
    document.body.appendChild(t);
    t.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    t.remove();
    return ok;
  }
}

// ---------- 편집기 ----------
function syncEditor() {
  const ta = $('#sql');
  $('#hl').innerHTML = highlightHtml(ta.value);
  const n = ta.value.split('\n').length;
  $('#gutter').textContent = Array.from({ length: n }, (_, i) => i + 1).join('\n');
  syncScroll();
  requestAnimationFrame(measureScrollbars);
}
function syncScroll() {
  const ta = $('#sql');
  const hl = $('#hl');
  hl.scrollTop = ta.scrollTop;
  hl.scrollLeft = ta.scrollLeft;
  $('#gutter').scrollTop = ta.scrollTop;
}
function measureScrollbars() {
  const ta = $('#sql');
  const box = $('#editor-box');
  box.style.setProperty('--sb', Math.max(0, ta.offsetHeight - ta.clientHeight) + 'px');
  box.style.setProperty('--sbx', Math.max(0, ta.offsetWidth - ta.clientWidth) + 'px');
  syncScroll();
}

function insertAtCaret(text) {
  const ta = $('#sql');
  ta.focus();
  if (!document.execCommand || !document.execCommand('insertText', false, text)) {
    const a = ta.selectionStart;
    ta.setRangeText(text, a, ta.selectionEnd, 'end');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

const KEYS = ['(', ')', ',', "'", '"', '*', '=', '<', '>', '%', '_', '.', ';', '||', '-', '/'];
function buildKeybar() {
  $('#keybar').innerHTML = KEYS.map((k) => `<button type="button" tabindex="-1" data-key="${esc(k)}" aria-label="${esc(k)} 입력">${esc(k)}</button>`).join('');
  const kb = $('#keybar');
  const keep = (e) => e.preventDefault();
  kb.addEventListener('pointerdown', keep);
  kb.addEventListener('mousedown', keep);
  kb.addEventListener('click', (e) => {
    const b = e.target.closest('[data-key]');
    if (b) insertAtCaret(b.dataset.key);
  });
}

function insertExample() {
  const s = activeSession();
  if (!s) return;
  const meta = s.sampleId ? SAMPLES.find((x) => x.id === s.sampleId) : sampleForName(s.name);
  const text = meta ? meta.examples : genericExample(s.objects);
  const ta = $('#sql');
  const cur = ta.value;
  const next = cur.trim() ? cur.replace(/\s*$/, '') + '\n\n' + text : text;
  ta.value = next;
  syncEditor();
  ta.focus();
  const caret = cur.trim() ? cur.replace(/\s*$/, '').length + 2 : 0;
  ta.setSelectionRange(caret, caret);
  ta.scrollTop = cur.trim() ? ta.scrollHeight : 0;
  syncScroll();
}

// ---------- 테마, 패널 ----------
const THEME_LABEL = { auto: '자동', light: '라이트', dark: '다크' };
function applyTheme() {
  const root = document.documentElement;
  if (settings.theme === 'auto') root.removeAttribute('data-theme');
  else root.dataset.theme = settings.theme;
  const label = `테마: ${THEME_LABEL[settings.theme]}`;
  $('#btn-theme').setAttribute('aria-label', label);
  $('#btn-theme').title = label;
}
function applyEditorHeight() {
  document.documentElement.style.setProperty('--editor-h', settings.editorH + 'px');
  requestAnimationFrame(measureScrollbars);
}

function openNav() {
  document.body.classList.add('nav-open');
  $('#nav-backdrop').hidden = false;
  $('#btn-nav').setAttribute('aria-expanded', 'true');
}
function closeNav() {
  document.body.classList.remove('nav-open');
  $('#nav-backdrop').hidden = true;
  $('#btn-nav').setAttribute('aria-expanded', 'false');
}

function toggleSampleMenu(force) {
  const menu = $('#sample-menu');
  const open = force !== undefined ? force : menu.hidden;
  if (open) {
    menu.innerHTML = SAMPLES.map(
      (x) => `<button type="button" role="menuitem" data-sample="${x.id}"><span class="pt">${esc(x.label)}</span><span class="pd">${esc(x.desc)}</span></button>`
    ).join('');
  }
  menu.hidden = !open;
  $('#btn-samples').setAttribute('aria-expanded', String(open));
}

// ---------- 이벤트 연결 ----------
function bindEvents() {
  // 편집기
  const ta = $('#sql');
  ta.addEventListener('input', syncEditor);
  ta.addEventListener('scroll', syncScroll);
  ta.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      run(e.shiftKey ? 'all' : 'current');
    }
  });
  window.addEventListener('resize', () => requestAnimationFrame(measureScrollbars));
  $('#btn-run').addEventListener('click', () => run('current'));
  $('#btn-run-all').addEventListener('click', () => run('all'));
  $('#btn-cancel').addEventListener('click', cancelRun);
  $('#btn-example').addEventListener('click', insertExample);
  $('#btn-clear').addEventListener('click', () => {
    setEditorSql('', { focus: true });
  });
  $('#btn-save').addEventListener('click', () => openDrawer('saved'));

  // 상단
  $('#btn-history').addEventListener('click', () => openDrawer('history'));
  $('#btn-theme').addEventListener('click', () => {
    const order = ['auto', 'light', 'dark'];
    settings.theme = order[(order.indexOf(settings.theme) + 1) % order.length];
    saveSettings(settings);
    applyTheme();
  });
  $('#btn-nav').addEventListener('click', () => (document.body.classList.contains('nav-open') ? closeNav() : openNav()));
  $('#nav-backdrop').addEventListener('click', closeNav);

  // 파일 열기
  $('#btn-open').addEventListener('click', () => $('#file-input').click());
  $('#file-input').addEventListener('change', (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length) handleFiles(files);
  });
  $('#btn-samples').addEventListener('click', (e) => { e.stopPropagation(); toggleSampleMenu(); });
  $('#sample-menu').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sample]');
    if (!b) return;
    toggleSampleMenu(false);
    openSample(b.dataset.sample);
  });
  document.addEventListener('click', (e) => {
    if (!$('#sample-menu').hidden && !e.target.closest('.menu-wrap')) toggleSampleMenu(false);
  });
  bindDropZone(document.body, { onFiles: handleFiles, multiple: true, accept: {}, onReject: () => {} });

  // 사이드바 위임
  $('#file-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const sid = Number(b.closest('[data-sid]').dataset.sid);
    if (b.dataset.act === 'activate') activate(sid);
    else if (b.dataset.act === 'close') closeSession(sid);
    else if (b.dataset.act === 'reset') resetSession();
    else if (b.dataset.act === 'export') exportSession();
  });
  $('#side-status').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act="notice-x"]');
    if (!b) return;
    state.notices = state.notices.filter((n) => n.id !== Number(b.dataset.id));
    renderSideStatus();
  });
  $('#tree-filter').addEventListener('input', (e) => { state.filter = e.target.value; renderTree(); });
  $('#tree').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    const s = activeSession();
    if (!b || !s) return;
    const name = b.closest('.obj').dataset.name;
    if (b.dataset.act === 'toggle') {
      s.expanded.has(name) ? s.expanded.delete(name) : s.expanded.add(name);
      renderTree();
    } else if (b.dataset.act === 'select') {
      selectObject(name);
      closeNav();
    } else if (b.dataset.act === 'col') {
      closeNav();
      insertAtCaret(identForSql(b.dataset.col));
    }
  });

  // 하단 패널
  $('#tab-results').addEventListener('click', () => showBottom('results'));
  $('#tab-table').addEventListener('click', () => showBottom('table'));
  $('#pane-results').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || !state.results) return;
    const cur = state.results.list[state.results.active];
    if (b.dataset.act === 'chip') { state.results.active = Number(b.dataset.i); renderResults(); }
    else if (b.dataset.act === 'copy-result' && cur) copyText(toDelimited(cur.columns, cur.rows, { sep: '\t' }));
    else if (b.dataset.act === 'csv-result' && cur) downloadBlob(new Blob([toDelimited(cur.columns, cur.rows, { bom: true, crlf: true })], { type: 'text/csv;charset=utf-8' }), 'result.csv');
  });
  $('#pane-results').addEventListener('change', (e) => {
    if (e.target.id === 'max-rows') { settings.maxRows = Number(e.target.value); saveSettings(settings); }
  });
  $('#pane-table').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const a = b.dataset.act;
    if (a === 'sub') {
      state.detailTab = b.dataset.sub;
      renderTablePane();
      if (state.detailTab === 'data' && !state.preview) loadPreview(0);
    } else if (a === 'insert-select' && state.detail) {
      const ta = $('#sql');
      const q = `SELECT * FROM ${identForSql(state.detail.name)} LIMIT 100;`;
      const cur = ta.value.replace(/\s*$/, '');
      setEditorSql(cur ? cur + '\n\n' + q + '\n' : q + '\n', { focus: true });
    } else if (a === 'prev') loadPreview(Math.max(0, state.preview.offset - settings.previewSize));
    else if (a === 'next') loadPreview(state.preview.offset + settings.previewSize);
  });
  $('#pane-table').addEventListener('change', (e) => {
    if (e.target.id === 'preview-size') { settings.previewSize = Number(e.target.value); saveSettings(settings); loadPreview(0); }
  });

  // 분할선
  const sp = $('#splitter');
  let drag = null;
  sp.addEventListener('pointerdown', (e) => {
    drag = { y: e.clientY, h: settings.editorH };
    sp.setPointerCapture(e.pointerId);
    sp.classList.add('drag');
  });
  sp.addEventListener('pointermove', (e) => {
    if (!drag) return;
    settings.editorH = Math.max(140, Math.min(window.innerHeight - 260, drag.h + e.clientY - drag.y));
    applyEditorHeight();
  });
  const endDrag = () => { if (drag) { drag = null; sp.classList.remove('drag'); saveSettings(settings); } };
  sp.addEventListener('pointerup', endDrag);
  sp.addEventListener('pointercancel', endDrag);
  sp.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    settings.editorH = Math.max(140, Math.min(window.innerHeight - 260, settings.editorH + (e.key === 'ArrowDown' ? 24 : -24)));
    applyEditorHeight();
    saveSettings(settings);
  });

  // 서랍
  $('#drawer-close').addEventListener('click', closeDrawer);
  $('#drawer-backdrop').addEventListener('click', closeDrawer);
  $('#drawer').addEventListener('click', (e) => {
    const t = e.target.closest('[data-dtab]');
    if (t) { Object.assign(state.drawer, { tab: t.dataset.dtab, query: '', shown: 30, confirm: null }); renderDrawer(true); return; }
    const b = e.target.closest('[data-act]');
    if (b) drawerAction(b.dataset.act, b);
  });
  $('#drawer').addEventListener('input', (e) => {
    if (e.target.id === 'd-search') { state.drawer.query = e.target.value; state.drawer.shown = 30; renderDrawerList(); }
  });
  $('#drawer').addEventListener('change', async (e) => {
    if (e.target.id === 'd-file' && e.target.files[0]) {
      $('#d-json').value = await e.target.files[0].text();
      e.target.value = '';
    }
  });
  $('#drawer').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (e.target.id !== 'd-save-form') return;
    const r = H.upsertSaved(state.saved, { name: $('#d-name').value, sql: $('#sql').value });
    if (r.status === 'full') { notify(`저장한 쿼리는 ${H.LIMITS.savedMax}건까지입니다. 하나를 삭제한 뒤 저장하세요.`); return; }
    if (r.status === 'oversize') { notify('SQL이 너무 길어 저장하지 못했습니다.'); return; }
    if (r.status === 'empty') return;
    state.saved = r.list;
    await persist('saved');
    $('#d-name').value = '';
    renderDrawerList();
  });

  // 전역 키, 포커스
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('#sample-menu').hidden) { toggleSampleMenu(false); $('#btn-samples').focus(); }
    else if (state.drawer.open) closeDrawer();
    else if (document.body.classList.contains('nav-open')) closeNav();
  });
  window.addEventListener('focus', async () => {
    await loadStores();
    if (state.drawer.open) renderDrawerList();
  });
}

// ---------- 시작 ----------
async function boot() {
  applyTheme();
  applyEditorHeight();
  buildKeybar();
  bindEvents();
  syncEditor();
  showBottom('results');
  renderFiles();
  renderTree();
  await loadStores();
  $('#sql').focus();
  if (window.matchMedia('(max-width: 899px)').matches) openNav();
  window.__sqlpad = { state, run, openSample, handleFiles }; // 테스트와 디버깅용
}

boot();
