// 진입점. App 을 마운트하고 테스트와 디버깅용 window.__sqlpad 를 노출한다.
import { mount } from 'svelte';
import App from './App.svelte';
import { app } from './state.svelte.js';
import { run, openSample, handleFiles, ref, addTab, closeTab, selectTab } from './actions.js';

mount(App, { target: document.getElementById('root') });

window.__sqlpad = {
  state: app, run, openSample, handleFiles, liveCheck: true,
  get editor() { return ref.editor; },
  getSql: () => ref.editor.getValue(),
  setSql: (t) => ref.editor.setValue(t),
  setCursor: (p) => ref.editor.setCursor(p),
  tabs: {
    list: () => app.tabs.map((t) => ({ ...t })),
    active: () => app.activeTab,
    add: (doc, opts) => addTab(doc, opts),
    close: (id) => closeTab(id),
    select: (id) => selectTab(id),
  },
};
