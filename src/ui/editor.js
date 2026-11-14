// 편집기: CodeMirror 6 래퍼. 색과 글꼴은 styles.css 의 `.editor .cm-*` 와 CSS 변수로 정한다(JS 테마를 쓰지 않는다).
import { EditorState, EditorSelection, Compartment, Prec } from '@codemirror/state';
import {
  EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightActiveLine,
  drawSelection, rectangularSelection, crosshairCursor,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  HighlightStyle, syntaxHighlighting, bracketMatching, indentOnInput, indentUnit,
} from '@codemirror/language';
import { autocompletion, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { sql, SQLite, SQLDialect } from '@codemirror/lang-sql';
import { tags } from '@lezer/highlight';
import { currentStatementHighlight } from './editor-statement.js';

// lang-sql 의 styleTags: Keyword/Type/Bool/Null -> keyword/typeName/bool/null, String/Bytes -> string,
// Number/Bits -> number, QuotedIdentifier -> special(string), Line/BlockComment -> comment. 연산자·괄호·식별자는 본문색.
const highlightStyle = HighlightStyle.define([
  { tag: [tags.keyword, tags.typeName, tags.bool, tags.null], class: 't-kw' },
  { tag: tags.string, class: 't-str' },
  { tag: tags.special(tags.string), class: 't-id' },
  { tag: tags.number, class: 't-num' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], class: 't-cm' },
]);

// SQLite 식별자는 대소문자를 가리지 않는다. 기본 방언은 대문자가 든 이름(Artist)을 백틱으로 감싸므로 바꾼다.
// 인용이 필요한 이름("Order Details")은 표준 큰따옴표로 감싼다.
const SQLITE = SQLDialect.define({ ...SQLite.spec, caseInsensitiveIdentifiers: true, identifierQuotes: '"`' });

const PHRASES = {
  Find: '찾기', Replace: '바꾸기', next: '다음', previous: '이전', all: '모두',
  'match case': '대소문자 구분', regexp: '정규식', 'by word': '단어 단위',
  replace: '바꾸기', 'replace all': '모두 바꾸기', close: '닫기',
  'Go to line': '줄로 이동', go: '이동',
  'Current match': '현재 일치', 'current match': '현재 일치',
  'replaced $ matches': '$개 바꿈', 'replaced match on line $': '$번 줄에서 바꿈',
  'on line': '줄', Completions: '자동완성',
  'Selection deleted': '선택 영역 삭제', 'Folded lines': '접은 줄', 'Unfolded lines': '펼친 줄',
};

/** 위/아래 줄의 같은 열에 커서를 추가한다. */
function addCursorVertically(dir) {
  return (view) => {
    const { state } = view;
    const ranges = [...state.selection.ranges];
    for (const r of state.selection.ranges) {
      const line = state.doc.lineAt(r.head);
      const col = r.head - line.from;
      const n = line.number + dir;
      if (n < 1 || n > state.doc.lines) continue;
      const t = state.doc.line(n);
      ranges.push(EditorSelection.cursor(t.from + Math.min(col, t.length)));
    }
    if (ranges.length === state.selection.ranges.length) return true;
    view.dispatch({ selection: EditorSelection.create(ranges, state.selection.mainIndex), scrollIntoView: true });
    return true;
  };
}

export function createEditor(parent, { onRun = () => {}, onChange = () => {} } = {}) {
  const sqlConf = new Compartment();
  const sqlExt = (schema) => sql({ dialect: SQLITE, schema: schema || undefined, upperCaseKeywords: true });

  const runKeys = Prec.highest(keymap.of([
    { key: 'Mod-Enter', run: () => { onRun('current'); return true; } },
    { key: 'Mod-Shift-Enter', run: () => { onRun('all'); return true; } },
  ]));

  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: '',
      extensions: [
        runKeys,
        sqlConf.of(sqlExt(null)),
        syntaxHighlighting(highlightStyle),
        lineNumbers(), highlightActiveLineGutter(), highlightActiveLine(),
        history(), drawSelection(),
        EditorState.allowMultipleSelections.of(true),
        rectangularSelection(), crosshairCursor(),
        bracketMatching(), closeBrackets(), indentOnInput(),
        indentUnit.of('  '), EditorState.tabSize.of(2),
        autocompletion({ activateOnTyping: true }),
        highlightSelectionMatches(),
        currentStatementHighlight(),
        EditorState.phrases.of(PHRASES),
        EditorView.contentAttributes.of({
          id: 'sql', 'aria-label': 'SQL', spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off',
        }),
        keymap.of([
          { key: 'Ctrl-Alt-ArrowUp', run: addCursorVertically(-1) },
          { key: 'Ctrl-Alt-ArrowDown', run: addCursorVertically(1) },
          // completionKeymap 은 autocompletion() 이 최고 우선순위로 직접 등록하므로 여기 넣지 않는다
          ...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab,
        ]),
        EditorView.updateListener.of((u) => { if (u.docChanged) onChange(u.state.doc.toString()); }),
      ],
    }),
  });

  return {
    view,
    getValue: () => view.state.doc.toString(),
    setValue(text, { focus = false, cursor = 'end' } = {}) {
      const pos = cursor === 'start' ? 0 : typeof cursor === 'number' ? Math.min(Math.max(0, cursor), text.length) : text.length;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        selection: { anchor: pos },
        scrollIntoView: true,
      });
      if (focus) view.focus();
    },
    getSelection() {
      const r = view.state.selection.main;
      return { from: r.from, to: r.to };
    },
    setCursor(pos) {
      const p = Math.min(Math.max(0, pos), view.state.doc.length);
      view.dispatch({ selection: { anchor: p }, scrollIntoView: true });
    },
    insertText(text) {
      view.dispatch(view.state.replaceSelection(text), { scrollIntoView: true, userEvent: 'input' });
      view.focus();
    },
    setSchema(schema) {
      view.dispatch({ effects: sqlConf.reconfigure(sqlExt(schema)) });
    },
    focus: () => view.focus(),
  };
}
