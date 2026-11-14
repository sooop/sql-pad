# SQLPad 설계

## 요약

SQLPad는 SQLite 파일을 브라우저에서 열어 테이블 구조를 확인하고 쿼리를 연습하는 웹앱이다. 서버 없이 단일 HTML 파일(`dist/sqlpad.html`, 약 4.6MB)로 동작한다. 파일 열기, 테이블과 스키마 보기, CodeMirror 6 편집기(자동완성, 멀티 커서), 쿼리 실행, 내역 관리까지 구현했고, 코어 단위 테스트 16건과 Chrome 실제 동작 테스트 21건을 통과한다. 다음 작업은 이 문서의 「확장 후보」에서 고른다.

## 샘플 DB 조사

공개된 연습용 SQLite DB는 다음과 같다. 내장 여부는 이 프로젝트에서 정한 것이다.

| DB | 내용과 규모 | 라이선스 | 내장 |
|---|---|---|---|
| Chinook | 음반 판매점. 11개 테이블, 약 3,500곡 | MIT | 예 |
| Northwind | 식품 무역 회사. 테이블 13개와 뷰 | MIT | 예(축소본) |
| Sakila | DVD 대여점. 16개 테이블 | BSD 3조항 | 아니오 |
| Employees | 직원과 급여. 직원 30만 명, 급여 284만 행 | 확인 못 함 | 아니오 |
| World | 국가, 도시, 언어 3개 테이블 | 확인 못 함 | 아니오 |
| Lahman 야구 기록 | 선수와 경기 기록 | 확인 못 함 | 아니오 |

- Chinook은 `lerocha/chinook-database` 릴리스의 `Chinook_Sqlite.sqlite`(v1.4.5)를 받았다. sqlitetutorial.net 튜토리얼이 쓰는 DB도 Chinook이다.
- Northwind는 `jpwhite3/northwind-SQLite3`의 `dist/northwind.db`를 받았다. 이 파일은 24.7MB이고 주문 상세가 609,283행이라 내장하기에 크다. 2012년 주문(654건)만 남기고 `VACUUM`해 1.3MB로 줄였다.
- Sakila의 SQLite 버전은 `bradleygrant/sakila-sqlite3`, `jOOQ`, `sq.io` 등에서 받을 수 있다. 약 5MB로 알려져 있으나 직접 내려받아 크기를 확인하지는 않았다.
- Employees와 World의 SQLite 변환본은 `fracpete/employees-db-sqlite`와 `aa8y/sqlite-dataset`에 있다. 라이선스는 해당 저장소에서 확인해야 한다.
- 작은 학습용 DB로 `codecrafters-io/sample-sqlite-databases`(`sample.db`, `superheroes.db`)가 있다.

Sakila를 추가할 때는 `AGENTS.md`의 「샘플 DB 추가」 절차를 따른다.

## 구조

```
src/core/      DOM이 없는 로직. 워커, 화면, node 테스트가 같은 파일을 쓴다.
  lexer.js       SQL 토크나이저
  sqlsplit.js    여러 문 분리, 커서 위치의 문 찾기
  highlight.js   구문 강조 HTML
  format.js      이스케이프, CSV/TSV, 크기·시간 표기
  engine.js      sql.js 위의 DB 엔진(열기, 스키마, 상세, 실행, 미리보기, 내보내기)
  history.js     내역과 저장한 쿼리의 순수 로직(중복 합치기, 검색, 백업 병합)
src/worker/entry.js   워커 진입점. 메시지를 engine 호출로 바꾼다.
src/ui/        화면
  app.js         상태, 렌더, 동작, 이벤트 연결
  editor.js      CodeMirror 6 편집기 래퍼
  editor-statement.js  현재 문 강조(커서가 속한 문의 줄 표시)
  template.html  마크업과 아이콘 스프라이트
  styles.css     테마(CSS 변수), 레이아웃
  store.js       IndexedDB, localStorage, 메모리 순 저장소와 설정
  dropzone.js    파일 드롭
  worker-client.js  Blob 워커 요청/응답과 취소
  samples.js     내장 샘플 목록과 예시 쿼리
scripts/build.mjs  단일 HTML 생성
samples/       내장 DB 파일과 출처
test/          core.test.mjs(단위), e2e.test.mjs(Chrome)
```

실행 흐름은 다음과 같다.

1. 사용자가 파일을 열면 `Session`이 만들어지고 DB 하나당 워커 하나가 뜬다.
2. 워커는 `initSqlJs`로 wasm을 올리고 `engine.open`으로 파일 바이트를 연다.
3. 화면은 `schema`, `detail`, `preview`, `run`, `export` 요청만 보낸다. 결과는 JSON으로 복제 가능한 값(BLOB은 `{$blob: 바이트 수}`)으로 돌아온다.
4. 쿼리 취소는 워커를 종료하고 새로 만든 뒤 처음 열었던 바이트로 DB를 다시 연다.

## 설계 결정

- **엔진은 sql.js(SQLite를 WASM으로 컴파일한 것)를 쓴다.** 서버 없이 `file://`로 열 수 있고, 외부 호스트 접근이 막힌 환경에서도 동작한다. 빌드 때 wasm을 base64로 HTML에 넣는다.
- **DB 하나에 워커 하나를 둔다.** 오래 걸리는 쿼리를 `terminate`로 끊을 수 있다. 여러 DB를 한 워커에 두면 취소 때 모두 다시 열어야 한다.
- **쓰기 쿼리를 허용하되 메모리에서만 반영한다.** CREATE, INSERT 같은 연습이 가능하다. 사이드바에 "변경됨"을 표시하고, 처음 상태로 되돌리기와 DB 파일 저장을 제공한다. 취소하면 변경 내용도 처음 상태로 돌아간다.
- **형식은 내용으로 판별한다.** 파일 열기와 드롭은 앞 16바이트가 `SQLite format 3`이면 DB, UTF-8 텍스트이면 SQL로 처리한다. 확장자를 보지 않는다.
- **내역은 실행한 SQL만 저장한다.** 같은 SQL은 한 건으로 합치고 최신순으로 둔다. 편집기 내용은 초안으로 저장되어 새로고침 뒤 복원된다.
- **편집기는 CodeMirror 6을 쓴다.** 투명 textarea를 겹치는 구조로는 멀티 커서와 자동완성 팝업을 만들기 어렵다. esbuild 번들에 들어가 `file://`와 외부 접근이 막힌 환경에서도 동작한다. 번들 크기는 약 400KB 늘어난다.
- **결과는 최대 1,000행까지 표시한다.** 100, 1,000, 5,000 중에서 고른다. 한도를 넘는 행은 가져오지 않고 "이후 행은 표시하지 않음"을 알린다. 전체 행 수는 세지 않는다.
- **표시 문구는 한국어, 색은 CSS 변수로 둔다.** 테마는 오프화이트 바탕에 주황 강조이고 다크 모드를 지원한다.

## 구현 범위

구현한 것:

- 파일 열기(버튼, 드롭, 복수 파일), 내장 샘플 2종, 여러 DB 동시 열기
- 테이블과 뷰 목록(행 수, 열 펼치기, 이름 검색)
- 선택한 테이블의 스키마(열, 외래 키, 인덱스, 트리거), 데이터 미리보기(페이지 이동), DDL
- 구문 강조 편집기(CodeMirror 6), 줄번호, 커서 위치 문 실행(Ctrl+Enter), 전체 실행(Ctrl+Shift+Enter), 실행 취소, 자동완성, Tab 들여쓰기, 멀티 커서, 찾기/바꾸기, 현재 문 표시, 초안 저장
- 여러 문 결과를 칩으로 전환, 결과 복사(탭 구분), CSV 저장(BOM, CRLF)
- 내역, 저장한 쿼리, 검색, 백업 내보내기와 가져오기
- 좁은 화면 대응(사이드바 패널, 기호 입력 줄)

## 확장 후보

우선순위 순이다. 각 항목은 한 번에 하나씩 끝낼 수 있는 크기다.

1. 결과 열 정렬과 필터. 표시한 행만 정렬하는지 서버 쪽 정렬인지 먼저 정한다.
2. `EXPLAIN QUERY PLAN` 결과 보기
3. 열린 DB를 IndexedDB에 보관해 새로고침 뒤에도 유지
4. CSV 가져오기(파일을 테이블로 만든다)
5. ERD(외래 키로 테이블 관계 그리기)
6. 편집기 탭(쿼리 여러 개 동시 편집)
7. 학습 모드(문제와 정답 쿼리를 두고 결과를 비교)
8. Sakila 등 샘플 추가

## 검증 현황

- 코어 단위 테스트 16건: 문 분리, 현재 문 범위, 구문 강조, CSV, 엔진, 내역 병합
- Chrome 실제 동작 테스트 21건: 샘플 열기부터 취소, 내역, 드롭, 테마, 모바일 폭(390px), Tab 들여쓰기, 자동완성, 멀티 커서, 현재 문 강조까지
- 확인하지 못한 것: iOS와 Android 실기기의 키보드와 확대 동작, Firefox와 Safari, Claude 아티팩트 뷰어 안에서의 Blob 워커 동작, CodeMirror의 모바일 가상 키보드 동작
- 미정: 내장 샘플 외 DB의 라이선스(위 표에서 "확인 못 함")
