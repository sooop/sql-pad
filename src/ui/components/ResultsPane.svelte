<script>
  import { app, settings } from '../state.svelte.js';
  import { formatDuration } from '../../core/format.js';
  import { fmtN, setMaxRows, copyResult, csvResult } from '../actions.js';
  import { gridHtml } from './grid.js';
  import ErrorHint from './ErrorHint.svelte';

  const list = $derived(app.results ? app.results.list : []);
  const cur = $derived(list[app.resultActive]);
  const chipLabel = (x) => (x.error ? '오류' : x.columns && x.columns.length ? `${fmtN(x.rows.length)}행` : x.changes != null ? `${fmtN(x.changes)}행 변경` : '완료');
</script>

{#if app.running}
  <div class="pane-empty" role="status">실행 중…</div>
{:else if app.results}
  {#if list.length > 1}
    <div class="chips">
      {#each list as x, i (i)}
        <button class="chip" class:err={x.error} type="button" data-act="chip" data-i={i} aria-pressed={i === app.resultActive} onclick={() => (app.resultActive = i)}>{i + 1} {x.kind || ''} · {chipLabel(x)}</button>
      {/each}
    </div>
  {/if}
  {#if !cur}
    <div class="pane-empty">실행할 문이 없습니다.</div>
  {:else if cur.info}
    <div class="ok-box" role="status">{cur.info}</div>
  {:else if cur.error}
    <ErrorHint error={cur.error} sql={cur.sql || ''} />
  {:else if !cur.columns.length}
    <div class="ok-box" role="status">{cur.kind} 완료{cur.changes != null ? ` · ${fmtN(cur.changes)}행 변경` : ''} · {formatDuration(cur.ms)}</div>
  {:else}
    <div class="meta-row"><span class="meta-text" role="status">{fmtN(cur.rows.length)}행{cur.truncated ? ' (이후 행은 표시하지 않음)' : ''} · {formatDuration(cur.ms)}</span><span class="spacer"></span>
      <select id="max-rows" class="select-sm" aria-label="최대 표시 행" title="최대 표시 행 (다음 실행부터 적용)" value={settings.maxRows} onchange={(e) => setMaxRows(Number(e.currentTarget.value))}>
        {#each [100, 1000, 5000] as n (n)}<option value={n}>{fmtN(n)}행까지</option>{/each}
      </select>
      <button class="icon-btn" type="button" data-act="copy-result" aria-label="결과 복사" title="결과 복사 (탭 구분)" onclick={copyResult}><svg class="ic"><use href="#i-copy"/></svg></button>
      <button class="icon-btn" type="button" data-act="csv-result" aria-label="CSV로 저장" title="CSV로 저장" onclick={csvResult}><svg class="ic"><use href="#i-download"/></svg></button>
    </div>
    <div class="pane-scroll">{@html gridHtml(cur.columns, cur.rows)}</div>
  {/if}
{/if}
