// 파일 드롭 영역. 확장자/MIME 판별은 최소한으로 하고 최종 판정은 읽기와 파싱 결과로 한다.

/** 확장자 또는 MIME 중 하나만 맞아도 통과. 확장자도 type도 없는 파일은 통과시키고 파싱에서 거른다. */
export function matchesFile(file, { exts = [], mimes = [] } = {}) {
  if (!exts.length && !mimes.length) return true;
  const name = file.name.toLowerCase();
  const type = (file.type || '').toLowerCase();
  if (exts.some((e) => name.endsWith(e))) return true;
  if (type && mimes.some((m) => (m.endsWith('/*') ? type.startsWith(m.slice(0, -1)) : type === m))) return true;
  return !type && !/\.[^./\\]+$/.test(name);
}

export const hasFiles = (e) => !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');

export function bindDropZone(el, { onFiles, onReject, accept, multiple = false }) {
  let depth = 0;
  const mark = (on) => el.toggleAttribute('data-dragover', on);
  el.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.stopPropagation(); depth++; mark(true); });
  el.addEventListener('dragover', (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; });
  el.addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) mark(false); });
  el.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); e.stopPropagation(); depth = 0; mark(false);
    const all = Array.from(e.dataTransfer.files); // await 전에 복사해야 한다
    const ok = all.filter((f) => matchesFile(f, accept));
    const use = multiple ? ok : ok.slice(0, 1);
    if (ok.length < all.length || use.length < ok.length) onReject && onReject({ rejected: all.filter((f) => !ok.includes(f)), ignored: ok.length - use.length });
    if (use.length) onFiles(use);
  });
}

// 영역 밖에 놓아도 브라우저가 파일을 열어 앱을 벗어나지 않게 한다(파일 드래그에 한함)
for (const type of ['dragover', 'drop']) {
  window.addEventListener(type, (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (type === 'dragover') e.dataTransfer.dropEffect = 'none';
  });
}
