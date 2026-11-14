<script>
  import { app, settings } from '../state.svelte.js';
  import { cycleTheme, openDrawer } from '../actions.js';

  const THEME_LABEL = { auto: '자동', light: '라이트', dark: '다크' };
  const themeLabel = $derived(`테마: ${THEME_LABEL[settings.theme]}`);
  const count = $derived(app.history.length);
</script>

<header class="topbar">
  <button id="btn-nav" class="icon-btn only-narrow" type="button" aria-label="파일과 테이블" title="파일과 테이블" aria-expanded={app.navOpen} aria-controls="sidebar" onclick={() => (app.navOpen = !app.navOpen)}><svg class="ic"><use href="#i-menu"/></svg></button>
  <h1 class="brand">SQLPad</h1>
  <div class="spacer"></div>
  <button id="btn-theme" class="icon-btn" type="button" aria-label={themeLabel} title={themeLabel} onclick={cycleTheme}><svg class="ic"><use href="#i-theme"/></svg></button>
  <button id="btn-history" class="icon-btn has-badge" type="button" aria-label="내역과 저장한 쿼리" title="내역과 저장한 쿼리" aria-expanded={app.drawer.open} aria-controls="drawer" onclick={() => openDrawer('history')}><svg class="ic"><use href="#i-clock"/></svg><span id="history-badge" class="badge" hidden={!count}>{count > 99 ? '99+' : count}</span></button>
</header>
