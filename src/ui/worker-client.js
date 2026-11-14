// Blob 워커용 요청/응답 클라이언트. 취소는 워커를 종료하고 새로 만드는 방식이다.
export function createWorkerClient(source) {
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  let worker = null;
  let seq = 0;
  const pending = new Map();

  const rejectAll = (message) => {
    for (const p of pending.values()) p.reject(new Error(message));
    pending.clear();
  };

  const start = () => {
    worker = new Worker(url);
    worker.onmessage = (e) => {
      const { id, ok, result, error } = e.data;
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      ok ? p.resolve(result) : p.reject(new Error(error));
    };
    worker.onerror = () => {
      rejectAll('worker');
      start();
    };
  };
  start();

  return {
    call(type, payload) {
      const id = ++seq;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker.postMessage({ id, type, payload });
      });
    },
    /** 진행 중인 요청을 모두 취소(reject 'cancelled')하고 빈 워커로 다시 시작한다. */
    restart() {
      worker.terminate();
      rejectAll('cancelled');
      start();
    },
    dispose() {
      worker.terminate();
      rejectAll('cancelled');
      URL.revokeObjectURL(url);
    },
  };
}
