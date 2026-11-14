// 상태를 바꾸는 동작. DB 작업은 모두 워커(core/engine.js)에 요청한다. 화면 그리기는 컴포넌트가 상태를 읽어서 한다.
import { tick } from 'svelte';
import { splitStatements, statementIndexAt } from '../core/sqlsplit.js';
import { humanBytes, toDelimited, identForSql, quoteIdent } from '../core/format.js';
import * as H from '../core/history.js';
import { kvGet, kvSet, saveSettings } from './store.js';
import { SAMPLES, sampleForName, genericExample } from './samples.js';
import { app, settings, tabStates, getSession, activeSession, getAssets, b64ToBytes, createSession, refreshSchema, restoreSession, disposeSession, clientOf } from './state.svelte.js';

const MAX_DB_BYTES = 256 * 1024 * 1024;
export const fmtN = (n) => Number(n).toLocaleString('ko-KR');

/** EditorPane 이 마운트되면 채워진다. 반응형이 아니다. */
export const ref = { editor: null };
const ed = () => ref.editor;

// ---------- 알림 ----------
let noticeSeq = 0;
export function notify(text) {
  app.notices.push({ id: ++noticeSeq, text });
  if (app.notices.length > 3) app.notices.shift();
}
export function dismissNotice(id) {
  app.notices = app.notices.filter((n) => n.id !== id);
}
const setBusy = (text) => { app.busy = text; };

// ---------- 파일 저장, 복사 ----------
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function copyText(text) {
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

// ---------- 파일 열기 ----------
const SQLITE_MAGIC = 'SQLite format 3\0';
const isSqliteFile = (u8) => u8.length >= 16 && String.fromCharCode(...u8.subarray(0, 16)) === SQLITE_MAGIC;

function friendlyOpenError(e) {
  const m = String((e && e.message) || e);
  if (/not a database|malformed|encrypted/i.test(m)) return 'SQLite 데이터베이스 파일이 아닙니다. 암호화되었거나 손상된 파일일 수 있습니다.';
  return m;
}

function uniqueName(name) {
  const names = new Set(app.sessions.map((s) => s.name));
  if (!names.has(name)) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let i = 2;
  while (names.has(`${stem} (${i})${ext}`)) i++;
  return `${stem} (${i})${ext}`;
}

export async function openBytes(name, bytes, sampleId) {
  const label = uniqueName(name);
  setBusy(`${label} 여는 중…`);
  try {
    const s = await createSession(label, bytes, sampleId);
    app.sessions.push(s);
    activate(s.id);
  } catch (e) {
    notify(`${name}: ${friendlyOpenError(e)}`);
  } finally {
    setBusy('');
  }
}

export async function openSample(id) {
  const meta = SAMPLES.find((x) => x.id === id);
  if (!meta) return;
  const existing = app.sessions.find((s) => s.sampleId === id);
  if (existing) { activate(existing.id); return; }
  await openBytes(meta.file, b64ToBytes(getAssets().samples[id]), id);
}

/** 파일 열기 버튼, 드롭 모두 이 함수로 모인다. 형식은 내용으로 판정한다. */
export async function handleFiles(files) {
  let sqlText = null;
  let sqlName = '';
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
    if (sqlText === null) { sqlText = text; sqlName = f.name; } else ignored++;
  }
  if (sqlText !== null) addTab(sqlText, { name: sqlName });
  if (ignored) notify(`SQL 텍스트는 한 번에 하나만 새 탭으로 열 수 있어 ${ignored}개를 건너뛰었습니다.`);
}

let detailToken = 0;

export function activate(id) {
  detailToken++;
  app.activeId = id;
  app.selected = null;
  app.detail = null;
  app.preview = null;
  app.bottom = 'results';
}

export function closeSession(id) {
  if (!getSession(id)) return;
  disposeSession(id);
  app.sessions = app.sessions.filter((x) => x.id !== id);
  if (app.activeId === id) activate(app.sessions.length ? app.sessions[app.sessions.length - 1].id : null);
}

export async function resetSession() {
  const s = activeSession();
  if (!s) return;
  setBusy('처음 상태로 되돌리는 중…');
  try {
    await restoreSession(s.id);
    await afterSchemaChange(s.id);
    app.results = { list: [{ info: '처음 열었을 때의 상태로 되돌렸습니다.' }] };
    app.resultActive = 0;
    app.bottom = 'results';
  } catch (e) {
    notify(`되돌리기 실패: ${friendlyOpenError(e)}`);
  } finally {
    setBusy('');
  }
}

export async function exportSession() {
  const s = activeSession();
  if (!s) return;
  try {
    const bytes = await clientOf(s.id).call('export');
    const dot = s.name.lastIndexOf('.');
    const stem = dot > 0 ? s.name.slice(0, dot) : s.name;
    const ext = dot > 0 ? s.name.slice(dot) : '.sqlite';
    downloadBlob(new Blob([bytes], { type: 'application/vnd.sqlite3' }), s.dirty ? `${stem}-modified${ext}` : s.name);
  } catch (e) {
    notify(`저장 실패: ${e.message}`);
  }
}

// ---------- 선택한 테이블 ----------
export async function selectObject(name) {
  const s = activeSession();
  if (!s) return;
  const token = ++detailToken;
  app.selected = { sid: s.id, name };
  app.detail = null;
  app.preview = null;
  app.bottom = 'table';
  try {
    const d = await clientOf(s.id).call('detail', { name });
    if (token !== detailToken) return;
    app.detail = d;
  } catch (e) {
    if (token !== detailToken) return;
    app.detail = { error: e.message };
  }
  if (app.detailTab === 'data' && app.detail && !app.detail.error) loadPreview(0);
}

export async function loadPreview(offset) {
  const s = activeSession();
  const sel = app.selected;
  if (!s || !sel) return;
  const token = detailToken;
  app.preview = { offset, loading: true };
  try {
    const data = await clientOf(s.id).call('preview', { name: sel.name, limit: settings.previewSize, offset });
    if (token !== detailToken) return;
    app.preview = data.error ? { offset, error: data.error } : { offset, data };
  } catch (e) {
    if (token !== detailToken) return;
    app.preview = { offset, error: e.message };
  }
}

export function setDetailTab(tab) {
  app.detailTab = tab;
  if (tab === 'data' && !app.preview) loadPreview(0);
}

export function setPreviewSize(n) {
  settings.previewSize = n;
  saveSettings(settings);
  loadPreview(0);
}

export function setMaxRows(n) {
  settings.maxRows = n;
  saveSettings(settings);
}

export function insertSelectForDetail() {
  if (!app.detail) return;
  const q = `SELECT * FROM ${identForSql(app.detail.name)} LIMIT 100;`;
  const cur = ed().getValue().replace(/\s*$/, '');
  setEditorSql(cur ? cur + '\n\n' + q + '\n' : q + '\n', { focus: true });
}

/** 스키마가 바뀐 뒤 선택한 테이블 상세를 다시 맞춘다(트리와 자동완성은 상태를 따라 갱신된다). */
async function afterSchemaChange(sid) {
  const s = getSession(sid);
  const sel = app.selected;
  if (s && sel && sel.sid === sid) {
    if (s.objects.some((o) => o.name === sel.name)) await selectObject(sel.name);
    else { app.selected = null; app.detail = null; app.bottom = 'results'; }
  }
}

// ---------- 쿼리 실행 ----------
export async function run(mode) {
  if (app.running) return;
  const s = activeSession();
  app.bottom = 'results';
  if (!s) {
    app.results = { list: [{ error: '열린 DB가 없습니다. 파일을 열거나 샘플 DB를 선택하세요.' }] };
    app.resultActive = 0;
    return;
  }
  const text = ed().getValue();
  const sel = ed().getSelection();
  let sql;
  if (mode === 'all') sql = text;
  else if (sel.to > sel.from) sql = text.slice(sel.from, sel.to);
  else {
    const stmts = splitStatements(text);
    const i = statementIndexAt(stmts, sel.from);
    sql = i >= 0 ? stmts[i].text : '';
  }
  if (!sql.trim() || !splitStatements(sql).length) {
    app.results = { list: [] };
    app.resultActive = 0;
    return;
  }
  const sid = s.id;
  const dbName = s.name;
  app.running = true;
  try {
    const res = await clientOf(sid).call('run', { sql, maxRows: settings.maxRows });
    let active = res.results.length - 1;
    for (let i = res.results.length - 1; i >= 0; i--) {
      if (res.results[i].columns && res.results[i].columns.length) { active = i; break; }
    }
    if (res.results.some((r) => r.error)) active = res.results.findIndex((r) => r.error);
    app.results = { list: res.results };
    app.resultActive = Math.max(0, active);
    if (res.dirty) getSession(sid).dirty = true;
    if (res.schemaChanged) { await refreshSchema(sid); await afterSchemaChange(sid); }
    recordHistory(sql, dbName);
  } catch (e) {
    if (e.message === 'cancelled' || e.message === 'worker') await recoverAfterStop(sid, e.message);
    else { app.results = { list: [{ error: e.message, sql }] }; app.resultActive = 0; }
  } finally {
    app.running = false;
  }
}

export function cancelRun() {
  const s = activeSession();
  if (s && app.running) clientOf(s.id).restart();
}

async function recoverAfterStop(sid, reason) {
  const wasDirty = getSession(sid).dirty;
  try {
    await restoreSession(sid);
    await afterSchemaChange(sid);
    const msg = reason === 'cancelled' ? '실행을 취소했습니다.' : '엔진이 중단되어 DB를 다시 열었습니다.';
    app.results = { list: [{ info: msg + (wasDirty ? ' 변경 내용은 처음 열었을 때의 상태로 되돌아갔습니다.' : '') }] };
  } catch (e) {
    app.results = { list: [{ error: `DB를 다시 열지 못했습니다: ${friendlyOpenError(e)}` }] };
  }
  app.resultActive = 0;
}

// ---------- 내역, 저장한 쿼리 ----------
export async function loadStores() {
  app.history = await kvGet('history', []);
  app.saved = await kvGet('saved', []);
}

export async function recordHistory(sql, dbName) {
  const r = H.addHistory(app.history, { sql, dbName });
  if (r.status === 'oversize') { notify(`SQL이 ${fmtN(H.LIMITS.sqlMaxChars)}자를 넘어 내역에 저장하지 않았습니다.`); return; }
  if (r.status === 'empty') return;
  app.history = r.list;
  if (r.dropped) notify(`내역이 ${fmtN(H.LIMITS.historyMax)}건을 넘어 오래된 ${r.dropped}건을 정리했습니다.`);
  await kvSet('history', app.history);
}

/** 편집기 내용을 바꾼다. 교체되는 기존 입력은 내역에 남긴다. */
export function setEditorSql(text, { focus = false } = {}) {
  const prev = ed().getValue();
  if (prev.trim() && prev.trim() !== text.trim()) recordHistory(prev, activeSession() ? activeSession().name : '');
  ed().setValue(text, { focus });
}

export function insertExample() {
  const s = activeSession();
  if (!s) return;
  const meta = s.sampleId ? SAMPLES.find((x) => x.id === s.sampleId) : sampleForName(s.name);
  const text = meta ? meta.examples : genericExample(s.objects);
  const cur = ed().getValue();
  const next = cur.trim() ? cur.replace(/\s*$/, '') + '\n\n' + text : text;
  ed().setValue(next, { focus: true, cursor: cur.trim() ? cur.replace(/\s*$/, '').length + 2 : 0 });
}

export function insertColumn(name) {
  app.navOpen = false;
  ed().insertText(identForSql(name));
}

// ---------- 결과 ----------
export function copyResult() {
  const cur = app.results && app.results.list[app.resultActive];
  if (cur) copyText(toDelimited(cur.columns, cur.rows, { sep: '\t' }));
}
export function csvResult() {
  const cur = app.results && app.results.list[app.resultActive];
  if (cur) downloadBlob(new Blob([toDelimited(cur.columns, cur.rows, { bom: true, crlf: true })], { type: 'text/csv;charset=utf-8' }), 'result.csv');
}

// ---------- 서랍 ----------
let drawerReturnFocus = null;
const focusSoon = async (sel) => { await tick(); const el = document.querySelector(sel); if (el) el.focus(); };
const resetDrawerView = (tab) => Object.assign(app.drawer, { tab, query: '', shown: 30, confirm: null, canSave: !!(ed() && ed().getValue().trim()) });

export function openDrawer(tab) {
  drawerReturnFocus = document.activeElement;
  resetDrawerView(tab);
  Object.assign(app.drawer, { open: true, importMsg: '' });
  focusDrawerFirst();
}
export function closeDrawer(restoreFocus = true) {
  if (!app.drawer.open) return;
  app.drawer.open = false;
  if (restoreFocus) tick().then(() => { if (drawerReturnFocus && drawerReturnFocus.focus) drawerReturnFocus.focus(); });
}
export function setDrawerTab(tab) {
  resetDrawerView(tab);
  focusDrawerFirst();
}
function focusDrawerFirst() {
  focusSoon(app.drawer.tab === 'backup' ? '#d-json' : app.drawer.tab === 'saved' ? '#d-name' : '#d-search');
}

const kindOf = () => (app.drawer.tab === 'saved' ? 'saved' : 'history');
const persist = (kind) => kvSet(kind, app[kind]);

export async function loadEntry(entry) {
  closeDrawer(false);
  await tick(); // #app 의 inert 가 풀린 뒤에 편집기로 포커스를 옮긴다
  setEditorSql(entry.sql, { focus: true });
}
export async function deleteEntry(id) {
  const kind = kindOf();
  app[kind] = app[kind].filter((e) => e.id !== id);
  await persist(kind);
}
export function clearAll() {
  app.drawer.confirm = app.drawer.tab;
}
export function clearCancel() {
  app.drawer.confirm = null;
}
export async function clearConfirm() {
  const kind = kindOf();
  app[kind] = [];
  app.drawer.confirm = null;
  await persist(kind);
}
export function exportBackup() {
  downloadBlob(new Blob([JSON.stringify(H.buildBackup(app.history, app.saved), null, 2)], { type: 'application/json' }), 'sqlpad-backup.json');
}
export async function copyBackup() {
  await copyText(JSON.stringify(H.buildBackup(app.history, app.saved), null, 2));
}
export async function importBackup(jsonText) {
  const d = app.drawer;
  try {
    const m = H.mergeBackup({ history: app.history, saved: app.saved }, JSON.parse(jsonText));
    app.history = m.history;
    app.saved = m.saved;
    await persist('history');
    await persist('saved');
    d.importMsg = `추가 ${m.summary.added}, 중복 ${m.summary.dup}, 제외 ${m.summary.skipped}`;
  } catch (e) {
    d.importMsg = e instanceof SyntaxError ? 'JSON 형식이 올바르지 않습니다.' : e.message;
  }
}
/** 저장한 쿼리를 추가한다. 저장했으면 true. */
export async function saveQuery(name) {
  const r = H.upsertSaved(app.saved, { name, sql: ed().getValue() });
  if (r.status === 'full') { notify(`저장한 쿼리는 ${H.LIMITS.savedMax}건까지입니다. 하나를 삭제한 뒤 저장하세요.`); return false; }
  if (r.status === 'oversize') { notify('SQL이 너무 길어 저장하지 못했습니다.'); return false; }
  if (r.status === 'empty') return false;
  app.saved = r.list;
  await persist('saved');
  return true;
}

// ---------- 테마, 패널 ----------
export function cycleTheme() {
  const order = ['auto', 'light', 'dark'];
  settings.theme = order[(order.indexOf(settings.theme) + 1) % order.length];
  saveSettings(settings);
}
export function setEditorHeight(h) {
  settings.editorH = Math.max(140, Math.min(window.innerHeight - 260, h));
}
export const persistSettings = () => saveSettings(settings);


// ---------- 쿼리 편집기 탭 ----------
// 탭의 문서(EditorState)는 state.svelte.js 의 tabStates 에 둔다. 활성 탭의 최신 상태는 편집기 view 가 들고 있으므로
// 전환 직전에 stashActive() 로 맡겨 둔다. view.setState() 로 바꿔 끼우면 실행 취소 내역·커서가 탭별로 유지된다.
const tabScroll = new Map(); // id -> scrollTop
const tabNum = new Map(); // id -> 자동 이름에 쓸 번호('쿼리 N')
let tabSeq = 0;
let numSeq = 0;
let lastClosed = null; // { sql, name } 최근 닫은 탭 1개
let tabSaveTimer = 0;

/** 첫 비주석·비공백 줄 앞 24자. 없으면 null. */
export function autoNameOf(text) {
  const body = text.replace(/\/\*[\s\S]*?(\*\/|$)/g, '').replace(/--[^\n]*/g, '');
  const line = body.split('\n').map((l) => l.trim()).find(Boolean);
  return line ? line.slice(0, 24) : null;
}
const autoFor = (id, text) => autoNameOf(text) || `쿼리 ${tabNum.get(id)}`;
export const tabLabel = (t) => t.name || t.auto;

const tabDoc = (id) => (id === app.activeTab ? ed().getValue() : tabStates.has(id) ? tabStates.get(id).doc.toString() : '');

function stashActive() {
  if (!app.activeTab || !ed()) return;
  tabStates.set(app.activeTab, ed().getState());
  tabScroll.set(app.activeTab, ed().view.scrollDOM.scrollTop);
}

export function saveTabsSoon() {
  clearTimeout(tabSaveTimer);
  tabSaveTimer = setTimeout(() => {
    if (!ed()) return;
    kvSet('tabs', { active: app.activeTab, list: app.tabs.map((t) => ({ id: t.id, name: t.name, sql: tabDoc(t.id) })) });
  }, 500);
}

/** 편집기 문서가 바뀔 때(EditorPane 이 연결): 활성 탭의 자동 이름을 갱신하고 저장을 예약한다. */
export function onEditorChange(text) {
  const t = app.tabs.find((x) => x.id === app.activeTab);
  if (t) { const a = autoFor(t.id, text); if (t.auto !== a) t.auto = a; }
  saveTabsSoon();
}

function show(id) {
  app.activeTab = id;
  ed().setState(tabStates.get(id));
  const top = tabScroll.get(id) || 0;
  requestAnimationFrame(() => { if (app.activeTab === id && ed()) ed().view.scrollDOM.scrollTop = top; });
}

function makeTab(doc, name) {
  const id = 't' + (++tabSeq) + Date.now().toString(36);
  tabNum.set(id, ++numSeq);
  tabStates.set(id, ed().createState(doc));
  app.tabs.push({ id, name: name || '', auto: autoFor(id, doc) });
  return id;
}

export function addTab(doc = '', { name = '', focus = true } = {}) {
  if (!ed()) return null;
  stashActive();
  const id = makeTab(doc, name);
  show(id);
  saveTabsSoon();
  if (focus) ed().focus();
  return id;
}

export function selectTab(id, { focus = true } = {}) {
  if (!app.tabs.some((t) => t.id === id)) return;
  if (id !== app.activeTab) {
    stashActive();
    show(id);
    saveTabsSoon();
  }
  if (focus) ed().focus();
}

export function closeTab(id = app.activeTab) {
  const i = app.tabs.findIndex((t) => t.id === id);
  if (i < 0) return;
  if (app.tabs.length === 1) { setEditorSql('', { focus: true }); return; } // 탭은 항상 1개 이상: 내용 비우기
  const doc = tabDoc(id);
  if (doc.trim()) lastClosed = { sql: doc, name: app.tabs[i].name };
  const wasActive = id === app.activeTab;
  app.tabs.splice(i, 1);
  tabStates.delete(id); tabScroll.delete(id); tabNum.delete(id);
  if (wasActive) { app.activeTab = null; show(app.tabs[Math.min(i, app.tabs.length - 1)].id); ed().focus(); }
  saveTabsSoon();
}

export function restoreClosedTab() {
  if (!lastClosed) return;
  const { sql, name } = lastClosed;
  lastClosed = null;
  addTab(sql, { name });
}

export function renameTab(id, name) {
  const t = app.tabs.find((x) => x.id === id);
  if (!t) return;
  t.name = name.trim();
  saveTabsSoon();
}

export function stepTab(dir) {
  const n = app.tabs.length;
  const i = app.tabs.findIndex((t) => t.id === app.activeTab);
  if (n < 2 || i < 0) return;
  selectTab(app.tabs[(i + dir + n) % n].id);
}

/** 편집기 단축키(onTab) 처리 */
export function onTabKey(action) {
  if (action === 'new') addTab();
  else if (action === 'close') closeTab();
  else if (action === 'restore') restoreClosedTab();
  else if (action === 'prev') stepTab(-1);
  else if (action === 'next') stepTab(1);
  else if (/^[1-9]$/.test(action)) { const t = app.tabs[Number(action) - 1]; if (t) selectTab(t.id); }
}

/** 테이블을 새 탭에서 바로 조회한다(Ctrl+클릭, 호버 버튼). */
export function quickSelect(name) {
  app.navOpen = false;
  addTab(`SELECT * FROM ${quoteIdent(name)} LIMIT 100;`, { name });
  return run('all');
}

async function restoreTabs() {
  const saved = await kvGet('tabs', null);
  const list = saved && Array.isArray(saved.list) ? saved.list.filter((x) => x && typeof x.id === 'string') : [];
  if (list.length) {
    for (const x of list) {
      tabNum.set(x.id, ++numSeq);
      tabStates.set(x.id, ed().createState(typeof x.sql === 'string' ? x.sql : ''));
      app.tabs.push({ id: x.id, name: typeof x.name === 'string' ? x.name : '', auto: autoFor(x.id, tabStates.get(x.id).doc.toString()) });
    }
    show(list.some((x) => x.id === saved.active) ? saved.active : list[0].id);
    return;
  }
  // 탭 저장이 없으면 예전 초안을 첫 탭으로 옮긴다
  const draft = await kvGet('draft', '');
  if (typeof draft === 'string' && draft.trim() && !ed().getValue().trim()) ed().setValue(draft, { cursor: 'end' });
  const id = 't' + (++tabSeq) + Date.now().toString(36);
  tabNum.set(id, ++numSeq);
  app.tabs.push({ id, name: '', auto: autoFor(id, ed().getValue()) });
  app.activeTab = id; // 편집기가 이미 들고 있는 상태가 첫 탭의 문서다
  if (draft) kvSet('draft', '');
  saveTabsSoon();
}

// ---------- 시작 ----------
export async function boot() {
  if (window.matchMedia('(max-width: 899px)').matches) app.navOpen = true;
  await loadStores();
  await restoreTabs();
  ed().focus();
}
