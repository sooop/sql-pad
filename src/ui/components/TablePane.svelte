<script>
  import { app, settings } from '../state.svelte.js';
  import { highlightHtml } from '../../core/highlight.js';
  import { fmtN, setDetailTab, loadPreview, setPreviewSize, insertSelectForDetail } from '../actions.js';
  import { gridHtml } from './grid.js';

  const d = $derived(app.detail);
  const p = $derived(app.preview);
  const ORIGIN = { c: 'CREATE INDEX', u: 'UNIQUE 제약', pk: '기본 키' };
  const SUBS = [['schema', '스키마'], ['data', '데이터'], ['ddl', 'DDL']];
  const size = $derived(settings.previewSize);
  const to = $derived(p && p.data ? p.offset + p.data.rows.length : 0);
  const from = $derived(p && p.data && p.data.rows.length ? p.offset + 1 : 0);
  const hasNext = $derived(p && p.data ? (d.rowCount !== null ? to < d.rowCount : p.data.rows.length === size) : false);
</script>

{#if !app.selected}
  <!-- 선택한 테이블 없음 -->
{:else if !d}
  <div class="pane-empty" role="status">불러오는 중…</div>
{:else if d.error}
  <div class="err-box" role="alert">{d.error}</div>
{:else}
  <div class="table-head"><span class="nm">{d.name}</span><span class="tag">{d.type === 'view' ? '뷰' : '테이블'}</span>{#if d.rowCount !== null}<span class="meta-text">{fmtN(d.rowCount)}행</span>{/if}<span class="spacer"></span><button class="btn sm" type="button" data-act="insert-select" onclick={insertSelectForDetail}>SELECT 넣기</button></div>
  <div class="subtabs">
    {#each SUBS as [k, label] (k)}
      <button class="chip" type="button" data-act="sub" data-sub={k} aria-pressed={app.detailTab === k} onclick={() => setDetailTab(k)}>{label}</button>
    {/each}
  </div>
  {#if app.detailTab === 'schema'}
    <div class="pane-scroll">
      <table class="info"><thead><tr><th>#</th><th>이름</th><th>타입</th><th>키</th><th>제약</th><th>기본값</th></tr></thead><tbody>
        {#each d.columns as c (c.cid)}
          <tr><td>{c.cid}</td><td class="mono">{c.name}</td><td class="mono">{c.type}</td><td>{c.pk ? 'PK' + (c.pk > 1 ? ' ' + c.pk : '') : ''}</td><td>{c.notnull ? 'NOT NULL' : ''}</td><td class="mono">{c.dflt === null || c.dflt === undefined ? '' : c.dflt}</td></tr>
        {/each}
      </tbody></table>
      {#if d.foreignKeys.length}
        <div class="sec-title">외래 키</div>
        <table class="info"><thead><tr><th>열</th><th>참조 테이블</th><th>참조 열</th><th>UPDATE</th><th>DELETE</th></tr></thead><tbody>
          {#each d.foreignKeys as f, i (i)}
            <tr><td class="mono">{f.from}</td><td class="mono">{f.table}</td><td class="mono">{f.to}</td><td>{f.onUpdate}</td><td>{f.onDelete}</td></tr>
          {/each}
        </tbody></table>
      {/if}
      {#if d.indexes.length}
        <div class="sec-title">인덱스</div>
        <table class="info"><thead><tr><th>이름</th><th>열</th><th>유일</th><th>생성 방식</th></tr></thead><tbody>
          {#each d.indexes as ix, i (i)}
            <tr><td class="mono">{ix.name}</td><td class="mono">{ix.columns.join(', ')}</td><td>{ix.unique ? '예' : ''}</td><td>{ORIGIN[ix.origin] || ix.origin}</td></tr>
          {/each}
        </tbody></table>
      {/if}
      {#if d.triggers.length}
        <div class="sec-title">트리거</div>
        <table class="info"><tbody>
          {#each d.triggers as t, i (i)}<tr><td class="mono">{t.name}</td></tr>{/each}
        </tbody></table>
      {/if}
    </div>
  {:else if app.detailTab === 'ddl'}
    <div class="pane-scroll"><pre class="ddl">{@html highlightHtml(d.ddl || '-- DDL 없음')}</pre></div>
  {:else if !p || p.loading}
    <div class="pane-empty" role="status">불러오는 중…</div>
  {:else if p.error}
    <div class="err-box" role="alert">{p.error}</div>
  {:else}
    <div class="meta-row"><span class="meta-text" role="status">{fmtN(from)}–{fmtN(to)}{d.rowCount === null ? '' : ' / ' + fmtN(d.rowCount)}</span><span class="spacer"></span>
      <select id="preview-size" class="select-sm" aria-label="페이지 크기" value={size} onchange={(e) => setPreviewSize(Number(e.currentTarget.value))}>
        {#each [25, 50, 100, 200] as n (n)}<option value={n}>{n}행씩</option>{/each}
      </select>
      <button class="icon-btn" type="button" data-act="prev" aria-label="이전 페이지" title="이전 페이지" disabled={p.offset <= 0} onclick={() => loadPreview(Math.max(0, p.offset - settings.previewSize))}><svg class="ic"><use href="#i-chevron-left"/></svg></button>
      <button class="icon-btn" type="button" data-act="next" aria-label="다음 페이지" title="다음 페이지" disabled={!hasNext} onclick={() => loadPreview(p.offset + settings.previewSize)}><svg class="ic"><use href="#i-chevron"/></svg></button></div>
    <div class="pane-scroll">{@html gridHtml(p.data.columns, p.data.rows, p.offset)}</div>
  {/if}
{/if}
