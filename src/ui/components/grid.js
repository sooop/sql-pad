// 결과 표 HTML. 행이 최대 5,000개라 컴포넌트 대신 문자열로 만들어 {@html} 로 넣는다. 모든 값은 esc() 를 거친다.
import { escapeHtml as esc, cellToText, isBlobCell } from '../../core/format.js';

export function gridHtml(columns, rows, rowOffset = 0) {
  const head = `<tr><th class="rn">#</th>${columns.map((c) => `<th title="${esc(c)}">${esc(c)}</th>`).join('')}</tr>`;
  const body = rows
    .map((r, i) => {
      const tds = r
        .map((v) => {
          if (v === null || v === undefined) return '<td class="null">NULL</td>';
          if (isBlobCell(v)) return `<td class="blob">${esc(cellToText(v))}</td>`;
          if (typeof v === 'number') return `<td class="num">${esc(v)}</td>`;
          const s = String(v);
          return `<td title="${esc(s.length > 400 ? s.slice(0, 400) + '…' : s)}">${esc(s)}</td>`;
        })
        .join('');
      return `<tr><td class="rn">${rowOffset + i + 1}</td>${tds}</tr>`;
    })
    .join('');
  return `<table class="grid"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}
