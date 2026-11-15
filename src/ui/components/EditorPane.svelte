<script>
  import { onMount, tick } from 'svelte';
  import { app, activeSession } from '../state.svelte.js';
  import { createEditor } from '../editor.js';
  import { startLiveCheck } from '../livecheck.js';
  import {
    ref, run, cancelRun, insertExample, setEditorSql, openDrawer,
    addTab, selectTab, closeTab, renameTab, stepTab, onTabKey, onEditorChange, tabLabel,
  } from '../actions.js';

  const KEYS = ['(', ')', ',', "'", '"', '*', '=', '<', '>', '%', '_', '.', ';', '||', '-', '/'];
  let box;
  let ready = $state(false);
  let editingId = $state(null);
  let editVal = $state('');
  let tabsEl;

  const s = $derived(activeSession());

  onMount(() => {
    // 편집기와 탭 자동 저장(변경 500ms 뒤, actions.js 의 saveTabsSoon)
    const editor = createEditor(box, {
      onRun: (mode) => run(mode),
      onChange: onEditorChange,
      onTab: onTabKey,
    });
    ref.editor = editor;
    const stopLive = startLiveCheck(editor);
    ready = true;
    return () => { stopLive(); editor.view.destroy(); ref.editor = null; };
  });

  // 활성 DB 의 테이블·열 이름을 자동완성에 넘긴다.
  $effect(() => {
    if (!ready) return;
    if (!s) { ref.editor.setSchema(null); return; }
    const schema = {};
    for (const o of s.objects) schema[o.name] = (o.columns || []).map((c) => c.name);
    const sel = app.selected && app.selected.sid === s.id ? app.selected.name : null;
    ref.editor.setSchema(schema, sel);
  });

  const keep = (e) => e.preventDefault();

  // 활성 탭이 가려져 있으면 보이게 스크롤한다.
  $effect(() => {
    const id = app.activeTab;
    if (!id || !tabsEl) return;
    tick().then(() => {
      const el = tabsEl && tabsEl.querySelector(`[data-tab-id="${id}"]`);
      if (el && el.scrollIntoView) el.scrollIntoView({ inline: 'nearest', block: 'nearest' });
    });
  });

  function startRename(t) {
    editingId = t.id;
    editVal = t.name || t.auto;
  }
  function commitRename() {
    if (editingId === null) return;
    const id = editingId;
    editingId = null;
    renameTab(id, editVal);
    ref.editor.focus();
  }
  function cancelRename() {
    editingId = null;
    ref.editor.focus();
  }
  const focusInput = (el) => { el.focus(); el.select(); };

  function onTabKeydown(e, t) {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      stepTab(e.key === 'ArrowRight' ? 1 : -1);
      tick().then(() => { const el = tabsEl && tabsEl.querySelector('.qtab[aria-selected="true"]'); if (el) el.focus(); });
    } else if (e.key === 'F2') {
      e.preventDefault();
      startRename(t);
    }
  }
</script>

<section class="editor-pane" aria-label="쿼리 편집기">
  <div class="editor-head">
    <div class="qtabs-wrap">
      <div class="qtabs" role="tablist" aria-label="쿼리 탭" bind:this={tabsEl}>
        {#each app.tabs as t (t.id)}
          {@const on = t.id === app.activeTab}
          <div class="qtab-item" class:active={on} role="presentation">
            {#if editingId === t.id}
              <input class="qtab-edit" aria-label="탭 이름" bind:value={editVal} use:focusInput
                onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitRename(); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelRename(); } }}
                onblur={commitRename} />
            {:else}
              <button class="qtab" type="button" role="tab" data-tab-id={t.id} aria-selected={on ? 'true' : 'false'} tabindex={on ? 0 : -1}
                title="{tabLabel(t)} (더블클릭: 이름 바꾸기)" onclick={() => selectTab(t.id)} ondblclick={() => startRename(t)} onkeydown={(e) => onTabKeydown(e, t)}><span class="qtab-t">{tabLabel(t)}</span></button>
            {/if}
            <button class="qtab-close" type="button" aria-label="탭 닫기" title="탭 닫기 (Alt+W)" tabindex="-1" onclick={() => closeTab(t.id)}><svg class="ic"><use href="#i-x"/></svg></button>
          </div>
        {/each}
      </div>
      <button id="btn-tab-add" class="qtab-add" type="button" aria-label="새 탭" title="새 탭 (Alt+N)" onclick={() => addTab()}><svg class="ic"><use href="#i-plus"/></svg></button>
    </div>
    <svg class="ic sub"><use href="#i-db"/></svg>
    <span id="active-label" class="active-label">{s ? s.name : '열린 DB 없음'}</span>
  </div>
  <div class="editor" id="editor-box" bind:this={box}></div>
  <div id="keybar" class="keybar" aria-label="기호 입력">
    {#each KEYS as k (k)}
      <button type="button" tabindex="-1" data-key={k} aria-label="{k} 입력" onpointerdown={keep} onmousedown={keep} onclick={() => ref.editor.insertText(k)}>{k}</button>
    {/each}
  </div>
  <div class="editor-actions">
    <div class="grp">
      <button id="btn-example" class="btn" type="button" disabled={!s} onclick={insertExample}>예시 넣기</button>
      <button id="btn-clear" class="icon-btn" type="button" aria-label="편집기 비우기" title="편집기 비우기" onclick={() => setEditorSql('', { focus: true })}><svg class="ic"><use href="#i-eraser"/></svg></button>
      <button id="btn-save" class="icon-btn" type="button" aria-label="쿼리 저장" title="쿼리 저장" onclick={() => openDrawer('saved')}><svg class="ic"><use href="#i-bookmark"/></svg></button>
    </div>
    <div class="grp">
      <button id="btn-cancel" class="btn danger" type="button" hidden={!app.running} onclick={cancelRun}><svg class="ic"><use href="#i-stop"/></svg>취소</button>
      <button id="btn-run-all" class="icon-btn" type="button" aria-label="전체 실행" title="전체 실행 (Ctrl+Shift+Enter)" disabled={app.running} onclick={() => run('all')}><svg class="ic"><use href="#i-play-all"/></svg></button>
      <button id="btn-run" class="btn primary" type="button" title="선택 영역 또는 커서가 있는 문 실행 (Ctrl+Enter)" disabled={app.running} onclick={() => run('current')}><svg class="ic"><use href="#i-play"/></svg>실행</button>
    </div>
  </div>
</section>
