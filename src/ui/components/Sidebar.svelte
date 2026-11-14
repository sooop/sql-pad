<script>
  import { app } from '../state.svelte.js';
  import { activeSession } from '../state.svelte.js';
  import { humanBytes } from '../../core/format.js';
  import { SAMPLES } from '../samples.js';
  import { activate, closeSession, resetSession, exportSession, selectObject, insertColumn, dismissNotice, openSample, fmtN, quickSelect } from '../actions.js';

  const s = $derived(activeSession());
  const words = $derived(app.filter.toLowerCase().split(/\s+/).filter(Boolean));
  const objs = $derived(s ? s.objects.filter((o) => words.every((w) => o.name.toLowerCase().includes(w))) : []);
  const groups = $derived([['table', '테이블'], ['view', '뷰']].map(([type, label]) => ({ label, items: objs.filter((o) => o.type === type) })).filter((g) => g.items.length));

  function toggle(name) {
    s.expanded[name] = !s.expanded[name];
  }
  function select(name) {
    selectObject(name);
    app.navOpen = false;
  }
</script>

<div id="nav-backdrop" class="backdrop only-narrow" hidden={!app.navOpen} onclick={() => (app.navOpen = false)} role="presentation"></div>
<aside id="sidebar" class="sidebar" aria-label="파일과 테이블">
  <section class="files">
    <div class="sec-head">
      <h2>열린 파일</h2>
      <span class="sec-actions">
        <button id="btn-open" class="icon-btn" type="button" aria-label="파일 열기" title="파일 열기" onclick={() => document.getElementById('file-input').click()}><svg class="ic"><use href="#i-open"/></svg></button>
        <span class="menu-wrap">
          <button id="btn-samples" class="icon-btn" type="button" aria-label="샘플 DB" title="샘플 DB" aria-haspopup="true" aria-expanded={app.sampleMenu} aria-controls="sample-menu" onclick={(e) => { e.stopPropagation(); app.sampleMenu = !app.sampleMenu; }}><svg class="ic"><use href="#i-db"/></svg></button>
          <div id="sample-menu" class="popover" role="menu" hidden={!app.sampleMenu}>
            {#each SAMPLES as x (x.id)}
              <button type="button" role="menuitem" data-sample={x.id} onclick={() => { app.sampleMenu = false; openSample(x.id); }}><span class="pt">{x.label}</span><span class="pd">{x.desc}</span></button>
            {/each}
          </div>
        </span>
      </span>
    </div>
    <ul id="file-list" class="file-list">
      {#each app.sessions as f (f.id)}
        {@const active = f.id === app.activeId}
        <li class="file-item" class:active class:dirty={f.dirty} data-sid={f.id}>
          <button class="file-main" type="button" data-act="activate" aria-current={active ? 'true' : undefined} onclick={() => activate(f.id)}>
            <span class="file-name">{f.name}</span>
            <span class="file-meta">{humanBytes(f.size)} · SQLite {f.version}</span>
          </button>
          {#if active && f.dirty}
            <button class="icon-btn" type="button" data-act="reset" aria-label="처음 상태로 되돌리기" title="처음 상태로 되돌리기" onclick={resetSession}><svg class="ic"><use href="#i-undo"/></svg></button>
          {/if}
          {#if active}
            <button class="icon-btn" type="button" data-act="export" aria-label="DB 파일로 저장" title="DB 파일로 저장" onclick={exportSession}><svg class="ic"><use href="#i-download"/></svg></button>
          {/if}
          <button class="icon-btn" type="button" data-act="close" aria-label="닫기" title="닫기" onclick={() => closeSession(f.id)}><svg class="ic"><use href="#i-x"/></svg></button>
        </li>
      {/each}
    </ul>
    <div id="side-status" class="side-status" role="status" aria-live="polite">
      {#each app.notices as n (n.id)}
        <div class="notice" role="alert"><span>{n.text}</span><button class="icon-btn" type="button" data-act="notice-x" aria-label="닫기" title="닫기" onclick={() => dismissNotice(n.id)}><svg class="ic"><use href="#i-x"/></svg></button></div>
      {/each}
      {#if app.busy}<div>{app.busy}</div>{/if}
    </div>
  </section>
  <section class="tree-wrap">
    <div class="sec-head"><h2>테이블</h2></div>
    <div class="search-field">
      <svg class="ic"><use href="#i-search"/></svg>
      <input id="tree-filter" type="search" placeholder="이름 검색" aria-label="테이블 이름 검색" autocomplete="off" autocapitalize="off" spellcheck="false" bind:value={app.filter}>
    </div>
    <div id="tree" class="tree">
      {#each groups as g (g.label)}
        <div class="tree-group">{g.label} {g.items.length}</div>
        {#each g.items as o (o.name)}
          {@const open = !!s.expanded[o.name]}
          {@const sel = !!app.selected && app.selected.sid === s.id && app.selected.name === o.name}
          <div class="obj" data-name={o.name}>
            <div class="obj-row" class:selected={sel}>
              <button class="obj-toggle" type="button" data-act="toggle" aria-expanded={open} aria-label="{o.name} 열 목록" title="열 목록" onclick={() => toggle(o.name)}><svg class="ic"><use href="#i-chevron"/></svg></button>
              <button class="obj-name" type="button" data-act="select" aria-current={sel ? 'true' : undefined} title="Ctrl+클릭: 새 탭에서 조회" onclick={(e) => (e.ctrlKey || e.metaKey ? quickSelect(o.name) : select(o.name))}><svg class="ic"><use href={o.type === 'view' ? '#i-eye' : '#i-table'}/></svg><span class="t">{o.name}</span><span class="n">{o.rowCount === null ? '' : fmtN(o.rowCount)}</span></button>
              <button class="quick" type="button" aria-label="새 탭에서 조회" title="새 탭에서 조회" onclick={() => quickSelect(o.name)}><svg class="ic"><use href="#i-play"/></svg></button>
            </div>
            {#if open}
              <ul class="cols">
                {#each o.columns as c (c.name)}
                  <li><button class="col-btn" type="button" data-act="col" data-col={c.name} title="커서 위치에 열 이름 넣기" onclick={() => insertColumn(c.name)}><span>{c.name}</span>{#if c.pk}<span class="pk-tag">PK</span>{/if}<span class="ty">{c.type}</span></button></li>
                {/each}
              </ul>
            {/if}
          </div>
        {/each}
      {/each}
      {#if !groups.length && words.length && s}<div class="tree-empty">일치하는 항목이 없습니다</div>{/if}
    </div>
  </section>
</aside>
