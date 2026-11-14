// 저장소: IndexedDB -> localStorage -> 메모리 순으로 조용히 폴백한다. 설정은 localStorage에 마지막 값만 둔다.
const mem = new Map();
let idbPromise = null;

function openIdb() {
  if (idbPromise) return idbPromise;
  idbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open('sqlpad', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return idbPromise;
}

function idbRequest(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const store = db.transaction('kv', mode).objectStore('kv');
    const req = fn(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function kvGet(key, fallback) {
  const db = await openIdb();
  if (db) {
    try {
      const v = await idbRequest(db, 'readonly', (s) => s.get(key));
      return v === undefined ? fallback : v;
    } catch { /* 다음 저장소로 */ }
  }
  try {
    const v = localStorage.getItem('sqlpad.kv.' + key);
    if (v !== null) return JSON.parse(v);
  } catch { /* 다음 저장소로 */ }
  return mem.has(key) ? mem.get(key) : fallback;
}

export async function kvSet(key, value) {
  const db = await openIdb();
  if (db) {
    try {
      await idbRequest(db, 'readwrite', (s) => s.put(value, key));
      return;
    } catch { /* 다음 저장소로 */ }
  }
  try {
    localStorage.setItem('sqlpad.kv.' + key, JSON.stringify(value));
    return;
  } catch { /* 다음 저장소로 */ }
  mem.set(key, value);
}

// ---- 설정(localStorage, 마지막 값만) ----
const SETTINGS_KEY = 'sqlpad.settings';
const DEFAULTS = { theme: 'auto', maxRows: 1000, editorH: 260, previewSize: 50 };
const VALID = {
  theme: (v) => ['auto', 'light', 'dark'].includes(v),
  maxRows: (v) => [100, 1000, 5000].includes(v),
  editorH: (v) => Number.isFinite(v) && v >= 120 && v <= 1200,
  previewSize: (v) => [25, 50, 100, 200].includes(v),
};

export function loadSettings() {
  const out = { ...DEFAULTS };
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    for (const k of Object.keys(DEFAULTS)) if (VALID[k](raw[k])) out[k] = raw[k];
  } catch { /* 기본값 사용 */ }
  return out;
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch { /* 저장소를 쓸 수 없어도 앱은 동작한다 */ }
}
