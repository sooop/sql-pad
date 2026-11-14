<script>
  import { settings } from '../state.svelte.js';
  import { setEditorHeight, persistSettings } from '../actions.js';

  let drag = $state(null);

  function down(e) {
    drag = { y: e.clientY, h: settings.editorH };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function move(e) {
    if (drag) setEditorHeight(drag.h + e.clientY - drag.y);
  }
  function end() {
    if (drag) { drag = null; persistSettings(); }
  }
  function key(e) {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    setEditorHeight(settings.editorH + (e.key === 'ArrowDown' ? 24 : -24));
    persistSettings();
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions, a11y_no_noninteractive_tabindex -->
<div id="splitter" class="splitter" class:drag={!!drag} role="separator" aria-orientation="horizontal" aria-label="편집기 높이 조절" tabindex="0"
  onpointerdown={down} onpointermove={move} onpointerup={end} onpointercancel={end} onkeydown={key}></div>
