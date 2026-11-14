# SQLPad 작업 안내 (코드 에이전트용)

SQLite 파일을 브라우저에서 열어 쿼리를 연습하는 단일 HTML 웹앱이다. 구조와 설계 결정은 `docs/DESIGN.md`에 있다.

## 명령

```
npm install          # sql.js, esbuild
npm run build        # dist/sqlpad.html 생성 (--no-samples 를 붙이면 샘플 제외)
npm test             # 단위 테스트 + e2e. playwright나 Chrome이 없으면 e2e만 건너뛴다
SQLPAD_SHOTS=/tmp/shots node --test test/e2e.test.mjs   # 스크린샷 저장
```

e2e는 `dist/sqlpad.html`을 연다. Chrome은 Linux, Windows, macOS 기본 설치 경로에서 찾고, 다른 곳에 있으면 `SQLPAD_CHROME` 환경 변수로 경로를 준다. UI를 고친 뒤에는 `npm run build`를 먼저 실행한다. 편집기 값은 `window.__sqlpad.getSql()`/`setSql()`로 읽고 쓴다(contenteditable이라 `page.fill`을 쓰지 않는다).

## 작업 규칙

- DOM이 필요 없는 로직은 `src/core/`에 둔다. 워커와 node 테스트가 이 파일을 그대로 쓰므로 `document`, `window`를 쓰지 않는다.
- DB 접근은 화면에서 직접 하지 않고 워커 요청으로 한다. 새 요청을 추가하려면 `engine.js`에 함수를 만들고 `src/worker/entry.js`의 `handlers`에 연결한 뒤 `app.js`에서 `session.client.call('이름', 인자)`로 부른다.
- 반환값은 `postMessage`로 복제할 수 있는 값만 쓴다. `Uint8Array` BLOB은 `engine.js`가 `{$blob: n}`으로 바꾼다.
- 사용자 입력과 DB 값은 `esc()`(`escapeHtml`)를 거쳐 `innerHTML`에 넣는다. 속성값에도 쓴다.
- 파일을 고칠 때는 `Edit`나 스크립트로 부분 수정한다. 파일 전체를 다시 쓰지 않는다. 바이너리(.sqlite)는 텍스트 도구로 열지 않는다.
- 큰 DB 데이터는 코드(`sqlite3`, `python3 -I`)로 가공한다.

## 화면 규칙

- 표시 문구는 한국어이고 이모지를 쓰지 않는다. 화면에 안내 문구를 상시로 두지 않고, 설명은 `title`(호버)로 둔다.
- 색은 `styles.css`의 CSS 변수만 쓴다. 새 색이 필요하면 변수를 먼저 추가하고 다크 모드 값도 정한다.
- 모서리가 둥근 요소에 한 변만 굵은 색 테두리를 주지 않는다. 상태는 네 변 테두리, 배경색, 글자색으로 구분한다.
- 좁고 반복되는 자리의 단순 버튼은 아이콘이다. `template.html`의 `<symbol>`을 추가하고 `aria-label`과 `title`을 붙인다. 터치 영역은 28px 이상이다.
- 글꼴 선언은 `--font`, `--mono` 변수를 쓴다. 웹폰트를 받지 않는다.
- 터치 기기와 좁은 화면에서 입력 필드 글자는 16px 이상이다(`--code-size`).
- 가끔 쓰는 기능은 서랍(`#drawer`)이나 팝오버에 둔다. 서랍을 열면 `#app`에 `inert`를 걸고, Esc와 바깥 클릭으로 닫고, 닫으면 이전 포커스로 돌아간다.

## 알아둘 점

- 편집기는 CodeMirror 6(`src/ui/editor.js`)이다. 색과 글꼴은 JS 테마를 쓰지 않고 `styles.css`의 `.editor .cm-*` 선택자와 CSS 변수로 지정한다. 구문 강조는 `HighlightStyle`이 기존 클래스(`t-kw` 등)에 매핑하고, 현재 문 강조는 `src/ui/editor-statement.js`에 있다. 스키마 자동완성은 `editor.setSchema()`에 `{테이블: [열]}`을 넘긴다. 편집기 내용은 초안(`kvSet('draft', ...)`)으로 저장된다.
- 워커 소스는 `sql-wasm.js` 뒤에 `src/worker/entry.js` 번들을 이어 붙인 것이다(`scripts/build.mjs`). 워커 안에서 `import`로 sql.js를 가져오지 않는다.
- `<input type="file">`에 `accept`를 두지 않았다. iOS에서 `.sqlite` 같은 확장자 파일이 비활성으로 보일 수 있어서다. 형식은 읽은 내용으로 판별한다.
- 저장소는 `store.js`가 IndexedDB, localStorage, 메모리 순으로 조용히 넘어간다. 저장소를 못 써도 앱은 동작해야 한다.
- Node 22의 `node --test`는 디렉터리 대신 글롭을 받는다(`'test/*.test.mjs'`).
- 디버깅용으로 `window.__sqlpad`에 `state`, `run`, `openSample`, `handleFiles`, `editor`, `getSql`, `setSql`, `setCursor`가 노출되어 있다.

## 샘플 DB 추가

1. 파일을 `samples/<id>.sqlite`로 둔다. 크기는 수 MB 이하를 권장한다(HTML에 base64로 들어가 약 1.33배가 된다). 필요하면 `VACUUM`으로 줄인다.
2. `src/ui/samples.js`의 `SAMPLES`에 `id`, `file`, `label`, `desc`, `examples`를 추가한다. `id`는 파일 이름에서 확장자를 뺀 것과 같아야 한다.
3. `samples/SOURCES.md`에 출처, 라이선스, 변경 내용을 적는다.
4. `test/e2e.test.mjs`에 예시 쿼리가 오류 없이 실행되는지 확인하는 테스트를 추가한다(Northwind 예시 테스트를 따른다).

## 쿼리 실행 방식

- `splitStatements`가 문자열, 주석, 트리거 본문의 세미콜론을 무시하고 문을 나눈다.
- 오류가 난 문까지만 결과에 담고 뒤 문은 실행하지 않는다.
- SELECT는 `maxRows`까지만 읽고 중단한다. `truncated`가 `true`이면 더 있다는 뜻이다.
- `dirty`는 쓰기가 일어났다는 표시이고, `schemaChanged`는 CREATE, DROP, ALTER가 있었다는 표시이다. 화면은 이 값으로 사이드바와 선택한 테이블을 다시 불러온다.
