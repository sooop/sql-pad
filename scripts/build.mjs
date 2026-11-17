// 단일 HTML(dist/sqlpad.html)을 만든다.
//   node scripts/build.mjs               샘플 DB 포함
//   node scripts/build.mjs --no-samples  샘플 제외(파일 열기와 드롭으로만 사용)
// 들어가는 것: UI 번들(esbuild + esbuild-svelte), 워커 소스(sql.js + core 엔진), sql-wasm.wasm(base64), samples/*.sqlite(base64)
import { build } from 'esbuild';
import sveltePlugin from 'esbuild-svelte';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p));
// src/ui/icons 의 PNG 를 data URI 로 만든다(icon-forge 로 생성, 단일 파일에도 favicon 이 들어가도록)
const icon = (f) => 'data:image/png;base64,' + read(`src/ui/icons/${f}`).toString('base64');
const bundle = async (entry, plugins = []) =>
  (await build({
    entryPoints: [path.join(root, entry)], bundle: true, format: 'iife', target: 'es2020', write: false, legalComments: 'none',
    plugins, logLevel: 'warning',
  })).outputFiles[0].text;

/** dist/sqlpad.html 의 내용을 만들어 돌려준다. dev 서버가 반복 호출한다. */
export async function buildHtml({ withSamples = true } = {}) {
  const sqljsDir = path.join(root, 'node_modules/sql.js/dist');
  const workerSource = read('node_modules/sql.js/dist/sql-wasm.js').toString('utf8') + '\n;\n' + (await bundle('src/worker/entry.js'));
  const appJs = await bundle('src/ui/main.js', [sveltePlugin({ compilerOptions: { css: 'injected' } })]);

  const samples = {};
  if (withSamples) {
    for (const f of fs.readdirSync(path.join(root, 'samples')).filter((x) => /\.(sqlite|db)$/.test(x))) {
      samples[path.parse(f).name] = read(`samples/${f}`).toString('base64');
    }
  }
  const assets = { worker: workerSource, wasm: fs.readFileSync(path.join(sqljsDir, 'sql-wasm.wasm')).toString('base64'), samples };

  // <script> 안에 안전하게 넣기 위한 이스케이프
  const safeJson = JSON.stringify(assets).replace(/</g, '\u003c');
  const safeJs = appJs.replace(/<\/script/gi, '<\/script').replace(/<!--/g, '<\!--');

  const html = read('src/ui/template.html')
    .toString('utf8')
    .replace('/*__ICON32__*/', () => icon('favicon-32x32.png'))
    .replace('/*__ICON16__*/', () => icon('favicon-16x16.png'))
    .replace('/*__ICON180__*/', () => icon('apple-touch-icon.png'))
    .replace('/*__STYLE__*/', () => read('src/ui/styles.css').toString('utf8'))
    .replace('/*__ASSETS__*/', () => safeJson)
    .replace('/*__SCRIPT__*/', () => safeJs);
  return { html, samples: Object.keys(samples) };
}

export function writeHtml(html) {
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  const out = path.join(root, 'dist/sqlpad.html');
  fs.writeFileSync(out, html);
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { html, samples } = await buildHtml({ withSamples: !process.argv.includes('--no-samples') });
  writeHtml(html);
  console.log(`dist/sqlpad.html  ${(html.length / 1024 / 1024).toFixed(2)} MB  samples: ${samples.join(', ') || '(none)'}`);
}
