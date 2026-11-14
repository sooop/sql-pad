// 단일 HTML(dist/sqlpad.html)을 만든다.
//   node scripts/build.mjs               샘플 DB 포함
//   node scripts/build.mjs --no-samples  샘플 제외(파일 열기와 드롭으로만 사용)
// 들어가는 것: UI 번들(esbuild), 워커 소스(sql.js + core 엔진), sql-wasm.wasm(base64), samples/*.sqlite(base64)
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const withSamples = !process.argv.includes('--no-samples');
const read = (p) => fs.readFileSync(path.join(root, p));
const bundle = async (entry) =>
  (await build({ entryPoints: [path.join(root, entry)], bundle: true, format: 'iife', target: 'es2020', write: false, legalComments: 'none' }))
    .outputFiles[0].text;

const sqljsDir = path.join(root, 'node_modules/sql.js/dist');
const workerSource = read('node_modules/sql.js/dist/sql-wasm.js').toString('utf8') + '\n;\n' + (await bundle('src/worker/entry.js'));
const appJs = await bundle('src/ui/app.js');

const samples = {};
if (withSamples) {
  for (const f of fs.readdirSync(path.join(root, 'samples')).filter((x) => /\.(sqlite|db)$/.test(x))) {
    samples[path.parse(f).name] = read(`samples/${f}`).toString('base64');
  }
}
const assets = { worker: workerSource, wasm: fs.readFileSync(path.join(sqljsDir, 'sql-wasm.wasm')).toString('base64'), samples };

// <script> 안에 안전하게 넣기 위한 이스케이프
const safeJson = JSON.stringify(assets).replace(/</g, '\\u003c');
const safeJs = appJs.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');

const html = read('src/ui/template.html')
  .toString('utf8')
  .replace('/*__STYLE__*/', () => read('src/ui/styles.css').toString('utf8'))
  .replace('/*__ASSETS__*/', () => safeJson)
  .replace('/*__SCRIPT__*/', () => safeJs);

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const out = path.join(root, 'dist/sqlpad.html');
fs.writeFileSync(out, html);
console.log(`dist/sqlpad.html  ${(html.length / 1024 / 1024).toFixed(2)} MB  samples: ${Object.keys(samples).join(', ') || '(none)'}`);
