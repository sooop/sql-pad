<script>
  import { app } from '../state.svelte.js';
  import { escapeHtml as esc } from '../../core/format.js';
  import * as H from '../../core/history.js';
  import { bindDropZone } from '../dropzone.js';
  import {
    fmtN, closeDrawer, setDrawerTab, loadEntry, deleteEntry, clearAll, clearCancel, clearConfirm,
    exportBackup, copyBackup, importBackup, saveQuery, copyText,
  } from '../actions.js';

  const d = app.drawer;
  const TABS = [['history', '내역'], ['saved', '저장됨'], ['backup', '백업']];
  let json = $state('');
  let saveName = $state('');
  let fileEl = $state();

  const isSaved = $derived(d.tab === 'saved');
  const all = $derived(isSaved ? app.saved : app.history);
  const words = $derived(d.query.toLowerCase().split(/\s+/).filter(Boolean));
  const found = $derived(H.searchEntries(all, d.query));
  const shown = $derived(found.slice(0, d.shown));

  // 검색어 강조. 모든 조각은 esc() 를 거친다.
  function markHtml(text) {
    if (!words.length) return esc(text);
    const re = new RegExp('(' + words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi');
    return text.split(re).map((p, i) => (i % 2 ? `<mark>${esc(p)}</mark>` : esc(p))).join('');
  }
  const fmtTime = (ts) => new Date(ts).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
  const clip = (sql) => (sql.length > 600 ? sql.slice(0, 600) + '…' : sql);

  function dropJson(node) {
    bindDropZone(node, { accept: {}, onFiles: async (files) => { json = await files[0].text(); }, onReject: () => {} });
  }
  async function pickFile(e) {
    const f = e.currentTarget.files[0];
    if (!f) return;
    json = await f.text();
    e.currentTarget.value = '';
  }
  async function submit(e) {
    e.preventDefault();
    if (await saveQuery(saveName)) saveName = '';
  }
</script>

<div id="drawer-backdrop" class="backdrop" hidden={!d.open} onclick={closeDrawer} role="presentation"></div>
<!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
<aside id="drawer" class="drawer" role="dialog" aria-label="내역과 저장한 쿼리" hidden={!d.open}>
  <div class="drawer-head">
    <div class="tabs" role="tablist">
      {#each TABS as [k, label] (k)}
        <button class="tab" role="tab" type="button" data-dtab={k} aria-selected={d.tab === k} onclick={() => setDrawerTab(k)}>{label}</button>
      {/each}
    </div>
    <button id="drawer-close" class="icon-btn" type="button" aria-label="닫기" title="닫기" onclick={closeDrawer}><svg class="ic"><use href="#i-x"/></svg></button>
  </div>
  <div id="drawer-body" class="drawer-body">
    {#if d.open && d.tab === 'backup'}
      <div class="field-row"><button class="btn" type="button" data-act="d-export" onclick={exportBackup}><svg class="ic"><use href="#i-download"/></svg>내보내기</button>
        <button class="btn" type="button" data-act="d-copy-json" onclick={copyBackup}><svg class="ic"><use href="#i-copy"/></svg>JSON 복사</button></div>
      <textarea id="d-json" class="json-in drop-target" aria-label="백업 JSON" spellcheck="false" autocapitalize="off" autocomplete="off" bind:value={json} use:dropJson></textarea>
      <div class="field-row"><button class="btn" type="button" data-act="d-pick" onclick={() => fileEl.click()}>파일에서 가져오기</button><button class="btn primary" type="button" data-act="d-import" onclick={() => importBackup(json)}>가져오기</button></div>
      <div id="d-msg" class="meta-text" role="status">{d.importMsg}</div>
      <input id="d-file" type="file" accept=".json,application/json" hidden bind:this={fileEl} onchange={pickFile}>
    {:else if d.open}
      {#if isSaved}
        <form id="d-save-form" class="field-row" onsubmit={submit}><input id="d-name" class="text-in" type="text" placeholder="이름" aria-label="저장할 이름" maxlength="80" autocomplete="off" bind:value={saveName}><button class="btn primary" type="submit" disabled={!d.canSave}>저장</button></form>
      {/if}
      <div class="field-row"><input id="d-search" type="search" placeholder="검색" aria-label="검색" autocomplete="off" autocapitalize="off" spellcheck="false" value={d.query} oninput={(e) => { d.query = e.currentTarget.value; d.shown = 30; }}></div>
      <div id="d-tools" class="list-tools">
        {#if d.confirm === d.tab}
          <span class="meta-text">{fmtN(all.length)}건 모두 삭제할까요?</span><span class="grp"><button class="btn sm danger" type="button" data-act="d-clear-yes" onclick={clearConfirm}>삭제</button><button class="btn sm" type="button" data-act="d-clear-no" onclick={clearCancel}>취소</button></span>
        {:else}
          <span class="meta-text">{words.length ? `${fmtN(found.length)} / ` : ''}{fmtN(all.length)}건</span>{#if all.length}<button class="btn sm" type="button" data-act="d-clear" onclick={clearAll}>전체 삭제</button>{/if}
        {/if}
      </div>
      <div id="d-list">
        {#each shown as e (e.id)}
          <div class="entry" data-id={e.id}>
            {#if isSaved}<div class="entry-name">{@html markHtml(e.name)}</div>{/if}
            <pre class="entry-sql">{@html markHtml(clip(e.sql))}</pre>
            <div class="entry-foot"><span class="grow">{fmtTime(e.ts)}{e.dbName ? ' · ' + e.dbName : ''}</span>
              <button class="btn sm" type="button" data-act="d-load" onclick={() => loadEntry(e)}>불러오기</button>
              <button class="icon-btn" type="button" data-act="d-copy" aria-label="SQL 복사" title="SQL 복사" onclick={() => copyText(e.sql)}><svg class="ic"><use href="#i-copy"/></svg></button>
              <button class="icon-btn" type="button" data-act="d-del" aria-label="삭제" title="삭제" onclick={() => deleteEntry(e.id)}><svg class="ic"><use href="#i-trash"/></svg></button></div>
          </div>
        {/each}
        {#if found.length > shown.length}<button class="btn" type="button" data-act="d-more" onclick={() => (d.shown += 30)}>더 보기 ({fmtN(found.length - shown.length)})</button>{/if}
      </div>
    {/if}
  </div>
</aside>
