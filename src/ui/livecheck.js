// 편집기 실시간 검사. 렉서 검사(lintStatement)는 즉시, 엔진 검사(check, prepare 만)는 디바운스 뒤에 진단으로 건다.
// 사용: const stop = startLiveCheck(editor); 정리할 때 stop().
import { splitStatements, statementIndexAt } from '../core/sqlsplit.js';
import { lintStatement, explainError } from '../core/errors.js';
import { app, activeSession, clientOf } from './state.svelte.js';

const DEBOUNCE = 400;
const CURSOR_DELAY = 1500;

function schemaOf(s) {
  const out = {};
  for (const o of (s && s.objects) || []) out[o.name] = (o.columns || []).map((c) => (typeof c === 'string' ? c : c.name));
  return out;
}

export function startLiveCheck(editor) {
  let version = 0;
  let timer = null;
  let curTimer = null;
  let stopped = false;
  let lexer = [];
  let engineOther = [];
  let engineCur = [];

  const apply = (includeCur) => {
    if (stopped) return;
    editor.setDiagnostics([...lexer, ...engineOther, ...(includeCur ? engineCur : [])]);
  };

  async function check() {
    timer = null;
    const v = version;
    const doc = editor.getValue();
    const stmts = splitStatements(doc);
    lexer = [];
    for (const s of stmts) {
      for (const l of lintStatement(s.text)) lexer.push({ from: s.start + l.range.from, to: s.start + l.range.to, severity: l.level, message: l.message });
    }
    clearTimeout(curTimer);
    if (!doc.trim()) { engineOther = []; engineCur = []; editor.setDiagnostics([]); return; }
    const s = activeSession();
    if (!s) { engineOther = []; engineCur = []; apply(true); return; }
    if (app.running) { apply(true); return; }
    const sid = s.id;
    let res;
    try {
      res = await clientOf(sid).call('check', { sql: doc });
    } catch { return; }
    if (stopped || v !== version || app.activeId !== sid) return;
    const sel = editor.getSelection();
    const ci = statementIndexAt(stmts, sel.from);
    const schema = schemaOf(activeSession());
    engineOther = [];
    engineCur = [];
    for (const r of res.results) {
      if (r.ok) continue;
      const text = doc.slice(r.start, r.end);
      const info = explainError(r.error, text, schema);
      const rg = info.range && info.range.to > info.range.from ? info.range : { from: 0, to: text.length };
      const d = { from: r.start + rg.from, to: r.start + rg.to, severity: 'error', message: info.detail ? `${info.title}\n${info.detail}` : info.title };
      const idx = stmts.findIndex((x) => x.start === r.start);
      (idx >= 0 && idx === ci ? engineCur : engineOther).push(d);
    }
    apply(engineCur.length === 0);
    if (engineCur.length) curTimer = setTimeout(() => { if (v === version) apply(true); }, CURSOR_DELAY);
  }

  const off = editor.onChange(() => {
    version++;
    clearTimeout(timer);
    timer = setTimeout(check, DEBOUNCE);
  });

  return function stop() {
    stopped = true;
    clearTimeout(timer);
    clearTimeout(curTimer);
    off();
  };
}
