// 앱 상태. 컴포넌트는 이 모듈의 app, settings 를 읽고, 바꾸는 일은 actions.js 의 함수로 한다.
// 세션은 평범한 객체로 app.sessions 에 두고(반응형), 워커 클라이언트와 처음 열었던 바이트는 반응형 밖의 runtimes 에 둔다.
// 반드시 app.sessions 에서 꺼낸 객체(getSession)를 고쳐야 화면이 갱신된다. 만든 직후의 원본 객체를 고치면 갱신되지 않는다.
import { createWorkerClient } from './worker-client.js';
import { loadSettings } from './store.js';

// ---------- 자산(빌드 때 HTML에 들어간 워커 소스, wasm, 샘플) ----------
export const b64ToBytes = (s) => {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
let assets = null;
let wasm = null;
export const getAssets = () => assets || (assets = JSON.parse(document.getElementById('assets').textContent));
const getWasm = () => wasm || (wasm = b64ToBytes(getAssets().wasm));

// ---------- 상태 ----------
export const settings = $state(loadSettings());

class AppState {
  sessions = $state([]);
  activeId = $state(null);
  selected = $state(null); // { sid, name }
  detailTab = $state('schema');
  bottom = $state('results'); // 'results' | 'table'
  resultActive = $state(0);
  running = $state(false);
  filter = $state('');
  notices = $state([]);
  busy = $state('');
  navOpen = $state(false);
  sampleMenu = $state(false);
  drawer = $state({ open: false, tab: 'history', query: '', shown: 30, confirm: null, importMsg: '', canSave: false });
  // 크고 통째로 교체되는 값은 깊은 반응형(proxy)으로 만들지 않는다. 항상 새 값으로 바꿔 넣는다.
  results = $state.raw(null); // { list } 실행 결과 목록
  detail = $state.raw(null); // 선택한 테이블 상세 또는 { error }
  preview = $state.raw(null); // { offset, loading? , error? , data? }
  history = $state.raw([]);
  saved = $state.raw([]);
  // 쿼리 편집기 탭. 문서(EditorState)는 반응형 밖의 tabStates 에 둔다.
  tabs = $state([]); // [{ id, name, auto }] name: 사용자가 정한 이름 또는 '', auto: 자동 이름
  activeTab = $state(null);
}
export const app = new AppState();

/** 탭 id -> EditorState (실행 취소 내역·커서 포함). 활성 탭의 최신 상태는 편집기 view 에 있다. */
export const tabStates = new Map();

export const getSession = (id) => app.sessions.find((s) => s.id === id) || null;
export const activeSession = () => getSession(app.activeId);

// ---------- 세션 런타임(워커 1개 = DB 1개) ----------
const runtimes = new Map(); // id -> { client, baseBytes }
export const clientOf = (id) => runtimes.get(id).client;
let sessionSeq = 0;

/** 워커를 띄워 DB 를 열고 세션 객체를 만든다. 실패하면 워커를 정리하고 던진다. */
export async function createSession(name, bytes, sampleId) {
  const id = ++sessionSeq;
  const client = createWorkerClient(getAssets().worker);
  try {
    await client.call('init', { wasm: getWasm() });
    const info = await client.call('open', { bytes });
    const objects = await client.call('schema');
    runtimes.set(id, { client, baseBytes: bytes });
    return { id, name, size: bytes.length, sampleId: sampleId || null, version: info.version, objects, dirty: false, expanded: {} };
  } catch (e) {
    client.dispose();
    throw e;
  }
}

export async function refreshSchema(id) {
  const s = getSession(id);
  s.objects = await clientOf(id).call('schema');
}

/** 워커를 새로 만들고 처음 열었던 상태로 되돌린다. */
export async function restoreSession(id) {
  const rt = runtimes.get(id);
  rt.client.restart();
  await rt.client.call('init', { wasm: getWasm() });
  const info = await rt.client.call('open', { bytes: rt.baseBytes });
  const s = getSession(id);
  s.version = info.version;
  await refreshSchema(id);
  s.dirty = false;
}

export function disposeSession(id) {
  const rt = runtimes.get(id);
  if (rt) rt.client.dispose();
  runtimes.delete(id);
}
