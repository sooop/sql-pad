<script>
  import { activeSession } from '../state.svelte.js';
  import { ref } from '../actions.js';
  import { explainError, lintStatement } from '../../core/errors.js';
  import { escapeHtml as esc } from '../../core/format.js';

  let { error, sql = '' } = $props();

  const schema = $derived.by(() => {
    const s = activeSession();
    const out = {};
    for (const o of (s && s.objects) || []) out[o.name] = (o.columns || []).map((c) => (typeof c === 'string' ? c : c.name));
    return out;
  });
  const info = $derived(explainError(error, sql, schema));
  const stmtHtml = $derived.by(() => {
    const r = info.range;
    if (!r || r.to <= r.from || r.from < 0 || r.to > sql.length) return esc(sql);
    return `${esc(sql.slice(0, r.from))}<mark class="err-mark">${esc(sql.slice(r.from, r.to))}</mark>${esc(sql.slice(r.to))}`;
  });
  const lints = $derived(
    sql
      ? lintStatement(sql).filter((x) => !(info.range && x.range.from === info.range.from && x.range.to === info.range.to))
      : [],
  );

  const norm = (t) => t.replace(/\s+/g, ' ');
  // 편집기 문서에서 실패한 문의 시작 위치. 못 찾으면 -1.
  function locate(doc) {
    const i = doc.indexOf(sql);
    if (i >= 0) return { base: i, map: (p) => p };
    // 공백 정규화 후 재시도: 정규화 문자열 위치를 원문 위치로 되돌리는 표를 만든다.
    const idx = [];
    let n = '';
    let prevWs = false;
    for (let k = 0; k < doc.length; k++) {
      const ws = /\s/.test(doc[k]);
      if (ws && prevWs) continue;
      n += ws ? ' ' : doc[k];
      idx.push(k);
      prevWs = ws;
    }
    const target = norm(sql).trim();
    const j = target ? n.indexOf(target) : -1;
    if (j < 0) return null;
    // sql 의 위치 p 를 정규화 좌표로: 앞부분을 정규화한 길이
    const lead = norm(sql).startsWith(' ') ? 1 : 0;
    return { base: idx[j], map: (p) => { const q = j + norm(sql.slice(0, p)).length - lead; return idx[Math.min(Math.max(q, 0), idx.length - 1)]; }, end: idx[j + target.length - 1] + 1 };
  }
  let canGoto = $state(false);
  $effect(() => {
    sql;
    const e = ref.editor;
    canGoto = !!(e && sql && locate(e.getValue()));
  });

  function goto() {
    const e = ref.editor;
    if (!e) return;
    const loc = locate(e.getValue());
    if (!loc) return;
    const r = info.range && info.range.to > info.range.from ? info.range : { from: 0, to: sql.length };
    const from = loc.map(r.from);
    let to = loc.map(r.to);
    if (to <= from) to = loc.end ?? from + (r.to - r.from);
    e.select(from, to);
    e.setDiagnostics([{ from, to, severity: 'error', message: info.title }]);
  }
</script>

<div class="err-box" role="alert">
  <div class="err-title">{info.title}</div>
  {#if info.detail}<div class="err-detail">{info.detail}</div>{/if}
  {#if info.suggestion}<div class="err-suggest">{info.suggestion}</div>{/if}
  {#if sql}<pre class="stmt">{@html stmtHtml}</pre>{/if}
  {#if lints.length}
    <div class="err-lint-head">함께 확인할 것</div>
    <ul class="err-lint">{#each lints as x, i (i)}<li>{x.message}</li>{/each}</ul>
  {/if}
  <div class="err-foot">
    <span class="err-raw">{error}</span>
    {#if canGoto}<button class="btn" type="button" data-act="goto-error" onclick={goto}>편집기에서 보기</button>{/if}
  </div>
</div>
