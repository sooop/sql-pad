<script>
  import { tick } from 'svelte';
  import { cheat } from './cheat-state.svelte.js';
  import { lookupWord } from './cheatsheet.js';
  import { onMount } from 'svelte';
  import { app, settings } from './state.svelte.js';
  import { boot, handleFiles, closeDrawer, loadStores, openDrawer, ref } from './actions.js';
  import { bindDropZone } from './dropzone.js';
  import Topbar from './components/Topbar.svelte';
  import Sidebar from './components/Sidebar.svelte';
  import EditorPane from './components/EditorPane.svelte';
  import Splitter from './components/Splitter.svelte';
  import ResultsPane from './components/ResultsPane.svelte';
  import TablePane from './components/TablePane.svelte';
  import Drawer from './components/Drawer.svelte';

  // 테마(html[data-theme]), 편집기 높이, 좁은 화면 사이드바(body.nav-open)
  $effect(() => {
    const root = document.documentElement;
    if (settings.theme === 'auto') root.removeAttribute('data-theme');
    else root.dataset.theme = settings.theme;
  });
  $effect(() => {
    document.documentElement.style.setProperty('--editor-h', settings.editorH + 'px');
  });
  $effect(() => {
    document.body.classList.toggle('nav-open', app.navOpen);
  });

  const hasTable = $derived(!!app.selected);
  const bottom = $derived(app.bottom === 'table' && hasTable ? 'table' : 'results');

  onMount(() => {
    bindDropZone(document.body, { onFiles: handleFiles, multiple: true, accept: {}, onReject: () => {} });
    boot();
  });

  function onF1(e) {
    if (document.activeElement?.id !== 'sql' || !ref.editor) return;
    e.preventDefault();
    const st = ref.editor.view.state;
    const r = st.wordAt(st.selection.main.head);
    const word = r ? st.sliceDoc(r.from, r.to) : '';
    const hit = lookupWord(word);
    cheat.query = hit ? '' : word;
    cheat.openId = hit ? hit.id : null;
    openDrawer('cheat');
    if (hit) tick().then(() => document.querySelector(`[data-cs-id="${hit.id}"]`)?.scrollIntoView({ block: 'nearest' }));
  }
  function onKeydown(e) {
    if (e.key === 'F1') { onF1(e); return; }
    if (e.key !== 'Escape') return;
    if (app.sampleMenu) { app.sampleMenu = false; document.getElementById('btn-samples')?.focus(); }
    else if (app.drawer.open) closeDrawer();
    else if (app.navOpen) app.navOpen = false;
  }
  async function onFocus() {
    await loadStores();
  }
  function onDocClick(e) {
    if (app.sampleMenu && !e.target.closest('.menu-wrap')) app.sampleMenu = false;
  }
  function onFileChange(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length) handleFiles(files);
  }
</script>

<svelte:window onkeydown={onKeydown} onfocus={onFocus} />
<svelte:document onclick={onDocClick} />

<div id="app" inert={app.drawer.open}>
  <Topbar />
  <div class="body">
    <Sidebar />
    <main class="main" id="main">
      <EditorPane />
      <Splitter />
      <section class="panel" aria-label="결과">
        <div class="tabs" role="tablist">
          <button id="tab-results" class="tab" role="tab" type="button" aria-selected={bottom === 'results'} aria-controls="pane-results" onclick={() => (app.bottom = 'results')}>결과</button>
          <button id="tab-table" class="tab" role="tab" type="button" aria-selected={bottom === 'table'} aria-controls="pane-table" hidden={!hasTable} onclick={() => (app.bottom = 'table')}>{hasTable ? app.selected.name : '테이블'}</button>
        </div>
        <div id="pane-results" class="pane" role="tabpanel" aria-labelledby="tab-results" hidden={bottom !== 'results'}><ResultsPane /></div>
        <div id="pane-table" class="pane" role="tabpanel" aria-labelledby="tab-table" hidden={bottom !== 'table'}><TablePane /></div>
      </section>
    </main>
  </div>
</div>

<div id="drop-overlay" class="drop-overlay"><span>놓아서 열기</span></div>
<input id="file-input" type="file" multiple hidden onchange={onFileChange}>

<Drawer />
