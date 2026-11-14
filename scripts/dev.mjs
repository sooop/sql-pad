// 개발 서버: src/ 와 samples/ 를 감시해 다시 빌드하고 http://localhost:5178 로 제공한다. 빌드가 끝나면 브라우저가 새로고침한다.
//   npm run dev
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildHtml, writeHtml } from './build.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 5178;
const RELOAD = "<script>new EventSource('/events').onmessage=()=>location.reload()</script>";

let html = '';
let lastError = '';
const clients = new Set();

async function rebuild() {
  const t = Date.now();
  try {
    const r = await buildHtml();
    writeHtml(r.html);
    html = r.html.replace('</body>', RELOAD + '\n</body>');
    lastError = '';
    console.log(`빌드 완료 ${Date.now() - t}ms  ${(r.html.length / 1024 / 1024).toFixed(2)} MB`);
  } catch (e) {
    lastError = String((e && e.message) || e);
    console.error('빌드 실패:\n' + lastError);
  }
  for (const res of clients) res.write('data: reload\n\n');
}

let timer = 0;
let building = false;
let again = false;
function schedule() {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    if (building) { again = true; return; }
    building = true;
    do { again = false; await rebuild(); } while (again);
    building = false;
  }, 150);
}
for (const dir of ['src', 'samples']) {
  fs.watch(path.join(root, dir), { recursive: true }, schedule);
}

http
  .createServer((req, res) => {
    if (req.url === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(': ok\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (req.url === '/' || req.url.startsWith('/?') || req.url === '/sqlpad.html') {
      if (!html) {
        res.writeHead(lastError ? 500 : 503, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(lastError || '빌드 중입니다. 잠시 뒤 새로고침하세요.');
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(html);
      return;
    }
    res.writeHead(404);
    res.end();
  })
  .listen(PORT, () => console.log(`http://localhost:${PORT}`));

await rebuild();
