// 편집기 진단 표시: 오류·경고 범위에 밑줄 장식을 건다. 범위는 문서 전체 기준 오프셋이다.
// 사용: extensions 에 diagnosticsExtension() 을 넣고, setDiagnostics(view, [{ from, to, severity, message }]) 로 갱신한다.
import { StateField, StateEffect, RangeSetBuilder } from '@codemirror/state';
import { EditorView, Decoration } from '@codemirror/view';

const setDiagnosticsEffect = StateEffect.define();

function build(list, doc) {
  const b = new RangeSetBuilder();
  const sorted = list
    .map((d) => ({ ...d, from: Math.max(0, Math.min(d.from, doc.length)), to: Math.max(0, Math.min(d.to, doc.length)) }))
    .filter((d) => d.to > d.from)
    .sort((a, c) => a.from - c.from || a.to - c.to);
  let last = -1;
  for (const d of sorted) {
    if (d.from < last) continue; // 겹치는 범위는 앞의 것만 표시한다
    const cls = d.severity === 'warning' ? 'cm-diag-warning' : 'cm-diag-error';
    b.add(d.from, d.to, Decoration.mark({ class: cls, attributes: d.message ? { title: d.message } : undefined }));
    last = d.to;
  }
  return b.finish();
}

const field = StateField.define({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) if (e.is(setDiagnosticsEffect)) return build(e.value, tr.state.doc);
    return tr.docChanged ? deco.map(tr.changes) : deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export function diagnosticsExtension() {
  return field;
}

/** @param list {{from:number,to:number,severity:'error'|'warning',message?:string}[]} */
export function setDiagnostics(view, list) {
  view.dispatch({ effects: setDiagnosticsEffect.of(list || []) });
}
