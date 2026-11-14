<script>
  import { onMount } from 'svelte';
  import { app, activeSession } from '../state.svelte.js';
  import { createEditor } from '../editor.js';
  import { kvSet } from '../store.js';
  import { ref, run, cancelRun, insertExample, setEditorSql, openDrawer } from '../actions.js';

  const KEYS = ['(', ')', ',', "'", '"', '*', '=', '<', '>', '%', '_', '.', ';', '||', '-', '/'];
  let box;
  let ready = $state(false);
  let draftTimer = 0;

  const s = $derived(activeSession());

  onMount(() => {
    // 편집기와 초안 자동 저장(변경 500ms 뒤)
    const editor = createEditor(box, {
      onRun: (mode) => run(mode),
      onChange: (text) => {
        clearTimeout(draftTimer);
        draftTimer = setTimeout(() => kvSet('draft', text), 500);
      },
    });
    ref.editor = editor;
    ready = true;
    return () => { clearTimeout(draftTimer); editor.view.destroy(); ref.editor = null; };
  });

  // 활성 DB 의 테이블·열 이름을 자동완성에 넘긴다.
  $effect(() => {
    if (!ready) return;
    if (!s) { ref.editor.setSchema(null); return; }
    const schema = {};
    for (const o of s.objects) schema[o.name] = (o.columns || []).map((c) => c.name);
    ref.editor.setSchema(schema);
  });

  const keep = (e) => e.preventDefault();
</script>

<section class="editor-pane" aria-label="쿼리 편집기">
  <div class="editor-head">
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
