<script>
  import { cheat } from '../cheat-state.svelte.js';
  import { app, activeSession } from '../state.svelte.js';
  import { CHEATSHEET, searchCheatsheet } from '../cheatsheet.js';
  import { highlightHtml } from '../../core/highlight.js';
  import { ref, closeDrawer, copyText } from '../actions.js';

  const q = $derived(cheat.query.trim());
  const flat = $derived(q ? searchCheatsheet(q) : null);
  const isChinook = $derived((() => { const s = activeSession(); return !!s && (s.sampleId === 'chinook' || /chinook/i.test(s.name)); })());

  function focusOnMount(node) { node.focus(); }
  const toggle = (id) => { cheat.openId = cheat.openId === id ? null : id; };
  const btnTitle = (item) => (item.db === 'chinook' && !isChinook ? 'Chinook 샘플 기준 예시' : undefined);

  function insert(item) {
    const ed = ref.editor;
    if (!ed) return;
    const cur = ed.getValue();
    let text = item.snippet;
    let start = 0;
    if (cur.trim()) {
      const head = cur.replace(/\s*$/, '') + '\n\n';
      start = head.length;
      text = head + item.snippet;
    }
    ed.setValue(text, { cursor: start, focus: true });
    closeDrawer(false);
  }
</script>

{#snippet itemCard(item)}
  {@const open = cheat.openId === item.id}
  <div class="cs-item" data-cs-id={item.id}>
    <button class="cs-head" type="button" aria-expanded={open} onclick={() => toggle(item.id)}>
      <span class="cs-title">{item.title}</span>
      <code class="cs-syntax">{item.syntax}</code>
      <span class="cs-desc">{item.desc}</span>
    </button>
    {#if open}
      <pre class="cs-snippet">{@html highlightHtml(item.snippet)}</pre>
      <div class="cs-foot">
        <button class="btn sm primary" type="button" data-act="cs-insert" title={btnTitle(item)} onclick={() => insert(item)}>편집기에 넣기</button>
        <button class="btn sm" type="button" data-act="cs-copy" title={btnTitle(item)} onclick={() => copyText(item.snippet)}>복사</button>
        {#if item.ref}<a class="btn sm" href={item.ref} target="_blank" rel="noopener">문서</a>{/if}
      </div>
    {/if}
  </div>
{/snippet}

<div class="field-row cs-search"><input id="cs-search" type="search" placeholder="검색 (예: 날짜, join, 윈도)" aria-label="치트시트 검색" title="편집기에서 F1 을 누르면 커서 아래 단어를 찾는다" autocomplete="off" autocapitalize="off" spellcheck="false" value={cheat.query} oninput={(e) => { cheat.query = e.currentTarget.value; }} use:focusOnMount></div>
<div id="cs-list" class="cs-list">
  {#if flat}
    {#each flat as { item } (item.id)}{@render itemCard(item)}{/each}
    {#if !flat.length}<div class="meta-text">일치하는 항목이 없다</div>{/if}
  {:else}
    {#each CHEATSHEET as section (section.id)}
      <h3 class="cs-sec">{section.title}</h3>
      {#each section.items as item (item.id)}{@render itemCard(item)}{/each}
    {/each}
  {/if}
</div>
