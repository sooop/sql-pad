// 값 표시, 이스케이프, 구분자 텍스트(CSV/TSV) 변환.

export function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

export function quoteIdent(name) {
  return '"' + String(name).replace(/"/g, '""') + '"';
}

/** 따옴표가 필요 없는 단순 식별자는 그대로, 아니면 따옴표로 감싼다. */
export function identForSql(name) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : quoteIdent(name);
}

export function humanBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function formatDuration(ms) {
  return ms < 1 ? '<1 ms' : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
}

/** 워커가 BLOB을 {$blob: 바이트 수}로 바꿔 보낸다. */
export function isBlobCell(v) {
  return v !== null && typeof v === 'object' && '$blob' in v;
}

export function cellToText(v) {
  if (v === null || v === undefined) return 'NULL';
  if (isBlobCell(v)) return `[BLOB ${v.$blob} B]`;
  return String(v);
}

/**
 * 결과를 구분자 텍스트로 만든다.
 * @param {{sep?:string, bom?:boolean, crlf?:boolean, nullText?:string}} opt
 */
export function toDelimited(columns, rows, { sep = ',', bom = false, crlf = false, nullText = '' } = {}) {
  const needsQuote = new RegExp(`[${sep === '\t' ? '\\t' : sep}"\\r\\n]`);
  const esc = (v) => {
    const s = v === null || v === undefined ? nullText : isBlobCell(v) ? cellToText(v) : String(v);
    return needsQuote.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const nl = crlf ? '\r\n' : '\n';
  const lines = [columns.map(esc).join(sep), ...rows.map((r) => r.map(esc).join(sep))];
  return (bom ? '﻿' : '') + lines.join(nl) + nl;
}
