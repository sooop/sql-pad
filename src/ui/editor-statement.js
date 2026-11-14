// 커서가 속한 SQL 문의 줄에 배경 클래스(cm-stmt-current)를 건다.
// 주 선택 영역이 비어 있을 때만 적용한다. 선택 영역이 있으면 선택이 실행 대상이므로 아무것도 걸지 않는다.
import { StateField } from '@codemirror/state';
import { Decoration, EditorView } from '@codemirror/view';
import { statementRangeAt } from '../core/sqlsplit.js';

const currentLine = Decoration.line({ class: 'cm-stmt-current' });

function computeDecorations(state) {
  const sel = state.selection.main;
  if (!sel.empty) return Decoration.none;
  const range = statementRangeAt(state.doc.toString(), sel.head);
  if (!range) return Decoration.none;
  const first = state.doc.lineAt(range.from).number;
  const last = state.doc.lineAt(range.to).number;
  const ranges = [];
  for (let n = first; n <= last; n++) ranges.push(currentLine.range(state.doc.line(n).from));
  return Decoration.set(ranges);
}

const currentStatementField = StateField.define({
  create(state) {
    return computeDecorations(state);
  },
  update(value, tr) {
    // 문서나 선택이 바뀐 트랜잭션에서만 다시 계산한다.
    if (!tr.docChanged && !tr.selection) return value;
    return computeDecorations(tr.state);
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** 현재 문 줄 강조 확장. */
export function currentStatementHighlight() {
  return currentStatementField.extension;
}
