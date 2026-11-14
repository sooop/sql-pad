// 구문 강조용 HTML 생성. 입력은 항상 이스케이프한다.
import { tokenize } from './lexer.js';
import { escapeHtml } from './format.js';

const CLASS = { keyword: 't-kw', string: 't-str', number: 't-num', comment: 't-cm', ident: 't-id' };

export function highlightHtml(sql) {
  let html = '';
  for (const t of tokenize(sql)) {
    const cls = CLASS[t.type];
    html += cls ? `<span class="${cls}">${escapeHtml(t.text)}</span>` : escapeHtml(t.text);
  }
  // 마지막 줄바꿈이 pre에서 줄로 보이도록 한 글자를 덧붙인다
  return html + '\n';
}
