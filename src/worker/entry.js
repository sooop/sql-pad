// 워커 진입점. 빌드 시 sql.js(initSqlJs 전역) 소스 뒤에 이어 붙여 Blob 워커로 만든다.
// 메시지: { id, type, payload } -> { id, ok, result } | { id, ok:false, error }
import { createEngine } from '../core/engine.js';

let engine = null;

const handlers = {
  async init({ wasm }) {
    const SQL = await self.initSqlJs({ wasmBinary: wasm });
    engine = createEngine(SQL);
    return true;
  },
  open: ({ bytes }) => engine.open(bytes),
  schema: () => engine.schema(),
  detail: ({ name }) => engine.detail(name),
  run: ({ sql, maxRows }) => engine.run(sql, { maxRows }),
  check: ({ sql }) => engine.check(sql),
  preview: ({ name, limit, offset }) => engine.preview(name, { limit, offset }),
  export: () => engine.exportDb(),
};

self.onmessage = async (e) => {
  const { id, type, payload } = e.data;
  try {
    const fn = handlers[type];
    if (!fn) throw new Error(`알 수 없는 요청: ${type}`);
    const result = await fn(payload || {});
    const transfer = result instanceof Uint8Array ? [result.buffer] : [];
    self.postMessage({ id, ok: true, result }, transfer);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};
