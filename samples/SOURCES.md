# 내장 샘플 DB 출처

| 파일 | 원본 | 라이선스 | 변경 내용 |
|---|---|---|---|
| `chinook.sqlite` | lerocha/chinook-database 릴리스 v1.4.5 `Chinook_Sqlite.sqlite` (https://github.com/lerocha/chinook-database) | MIT | `VACUUM`으로 빈 페이지 제거(1.07MB에서 0.83MB) |
| `northwind.sqlite` | jpwhite3/northwind-SQLite3 `dist/northwind.db` (https://github.com/jpwhite3/northwind-SQLite3). Microsoft Access 2000 Northwind를 SQLite용으로 옮긴 것 | MIT | 2013년 이후 주문과 해당 주문 상세를 삭제하고 `VACUUM`(24.7MB에서 1.3MB). 남은 주문은 654건, 주문 상세는 25,521행 |

각 원본의 라이선스 전문은 위 저장소에서 확인한다. Chinook은 저장소의 `LICENSE.md`에서 MIT 문구를 확인했다. Northwind의 MIT는 저장소 목록 정보에서 확인했고 `LICENSE` 파일은 열어 보지 않았다.
