# SQLPad

SQLite 파일을 브라우저에서 열어 테이블 구조를 보고 쿼리를 연습하는 웹앱이다. 서버가 필요 없다.

## 바로 쓰기

`dist/sqlpad.html`을 브라우저로 연다. 왼쪽 위의 데이터베이스 아이콘에서 샘플(Chinook, Northwind)을 열거나, SQLite 파일을 창에 끌어다 놓는다.

| 동작 | 방법 |
|---|---|
| 커서가 있는 문 실행 | Ctrl+Enter (선택 영역이 있으면 선택 영역) |
| 전체 실행 | Ctrl+Shift+Enter |
| 테이블 구조 보기 | 왼쪽 목록에서 테이블 선택 |
| 열 이름 넣기 | 테이블 옆 화살표로 열 목록을 펼친 뒤 열 선택 |

## 개발

```
npm install
npm run build    # dist/sqlpad.html
npm test
```

구조와 설계는 `docs/DESIGN.md`, 코드 에이전트용 작업 규칙은 `AGENTS.md`에 있다.
