// 여러 문이 섞인 SQL 텍스트를 문 단위로 나눈다.
// 문자열, 따옴표 식별자, 주석 안의 세미콜론과 CREATE TRIGGER ... BEGIN ... END 본문은 나누지 않는다.
import { tokenize } from './lexer.js';

/**
 * @returns {{start:number,end:number,text:string,segStart:number,segEnd:number}[]}
 *   start/end: 문 본문 범위(앞뒤 공백, 주석, 끝 세미콜론 제외). segStart/segEnd: 문이 차지하는 구간(세미콜론 포함).
 */
export function splitStatements(sql) {
  const tokens = tokenize(sql);
  const stmts = [];
  let segStart = 0;
  let startContent = -1;
  let endContent = -1;
  let words = [];
  let inTrigger = false;
  let inBody = false;
  let caseDepth = 0;

  const flush = (segEnd) => {
    if (startContent >= 0) {
      stmts.push({ start: startContent, end: endContent, text: sql.slice(startContent, endContent), segStart, segEnd });
    }
    startContent = -1;
    endContent = -1;
    words = [];
    inTrigger = false;
    inBody = false;
    caseDepth = 0;
  };

  for (const t of tokens) {
    if (t.type === 'ws' || t.type === 'comment') continue;
    if (t.type === 'punct' && t.text === ';' && !inBody) {
      flush(t.end);
      segStart = t.end;
      continue;
    }
    if (startContent < 0) startContent = t.start;
    endContent = t.end;
    if (t.type === 'word' || t.type === 'keyword') {
      const up = t.text.toUpperCase();
      words.push(up);
      if (!inTrigger && words.length <= 3 && words[0] === 'CREATE') {
        const w = words.slice(1);
        if (w[0] === 'TRIGGER' || ((w[0] === 'TEMP' || w[0] === 'TEMPORARY') && w[1] === 'TRIGGER')) inTrigger = true;
      }
      if (inTrigger) {
        if (!inBody && up === 'BEGIN') inBody = true;
        else if (inBody) {
          if (up === 'CASE') caseDepth++;
          else if (up === 'END') {
            if (caseDepth > 0) caseDepth--;
            else inBody = false;
          }
        }
      }
    }
  }
  flush(sql.length);
  return stmts;
}

/** 캐럿 위치(pos)가 속한 문의 인덱스. 문이 없으면 -1. */
export function statementIndexAt(stmts, pos) {
  if (!stmts.length) return -1;
  for (let i = 0; i < stmts.length; i++) {
    if (pos <= stmts[i].segEnd) return i;
  }
  return stmts.length - 1;
}

/**
 * 캐럿 위치(pos)가 속한 문의 본문 범위. Ctrl+Enter 가 실행하는 문과 같은 규칙을 쓴다.
 * @returns {{from:number,to:number}|null} 문 본문(start..end). 문이 없으면 null.
 */
export function statementRangeAt(sql, pos) {
  const stmts = splitStatements(sql);
  const i = statementIndexAt(stmts, pos);
  if (i < 0) return null;
  return { from: stmts[i].start, to: stmts[i].end };
}

/** 문의 첫 단어(대문자). SELECT, INSERT, WITH 등. */
export function statementKind(text) {
  const t = tokenize(text).find((x) => x.type === 'word' || x.type === 'keyword');
  return t ? t.text.toUpperCase() : '';
}
