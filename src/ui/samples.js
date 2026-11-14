// 내장 샘플 DB 메타데이터와 예시 쿼리. DB 파일 자체는 samples/ 폴더에 있고 빌드 때 HTML에 base64로 들어간다.
// 새 샘플을 추가하려면 samples/에 파일을 넣고 여기에 항목을 더한 뒤 samples/SOURCES.md에 출처를 적는다.

export const SAMPLES = [
  {
    id: 'chinook',
    file: 'chinook.sqlite',
    label: 'Chinook',
    desc: '음반 판매점. 아티스트, 앨범, 트랙, 청구서 등 11개 테이블',
    examples: `-- 아티스트 20명
SELECT * FROM Artist LIMIT 20;

-- 앨범이 많은 아티스트 상위 10명
SELECT ar.Name AS Artist, COUNT(*) AS Albums
FROM Artist ar
JOIN Album al ON al.ArtistId = ar.ArtistId
GROUP BY ar.ArtistId
ORDER BY Albums DESC
LIMIT 10;

-- 장르별 매출
SELECT g.Name AS Genre, ROUND(SUM(il.UnitPrice * il.Quantity), 2) AS Revenue
FROM InvoiceLine il
JOIN Track t ON t.TrackId = il.TrackId
JOIN Genre g ON g.GenreId = t.GenreId
GROUP BY g.GenreId
ORDER BY Revenue DESC;

-- 국가별 고객 지출 순위 (윈도 함수)
SELECT c.Country, c.FirstName || ' ' || c.LastName AS Customer,
       ROUND(SUM(i.Total), 2) AS Spent,
       RANK() OVER (PARTITION BY c.Country ORDER BY SUM(i.Total) DESC) AS RankInCountry
FROM Customer c
JOIN Invoice i ON i.CustomerId = c.CustomerId
GROUP BY c.CustomerId
ORDER BY c.Country, RankInCountry;
`,
  },
  {
    id: 'northwind',
    file: 'northwind.sqlite',
    label: 'Northwind',
    desc: '식품 무역 회사. 고객, 주문, 제품, 공급업체 (2012년 주문만 수록)',
    examples: `-- 비싼 제품 10개
SELECT ProductName, UnitPrice FROM Products ORDER BY UnitPrice DESC LIMIT 10;

-- 국가별 주문 수와 매출
SELECT c.Country,
       COUNT(DISTINCT o.OrderID) AS Orders,
       ROUND(SUM(od.UnitPrice * od.Quantity * (1 - od.Discount)), 2) AS Sales
FROM Orders o
JOIN Customers c ON c.CustomerID = o.CustomerID
JOIN "Order Details" od ON od.OrderID = o.OrderID
GROUP BY c.Country
ORDER BY Sales DESC;

-- 월별 주문 수
SELECT strftime('%Y-%m', OrderDate) AS Month, COUNT(*) AS Orders
FROM Orders
GROUP BY Month
ORDER BY Month;

-- 카테고리별 제품 수와 평균 가격
SELECT cat.CategoryName, COUNT(*) AS Products, ROUND(AVG(p.UnitPrice), 2) AS AvgPrice
FROM Products p
JOIN Categories cat ON cat.CategoryID = p.CategoryID
GROUP BY cat.CategoryID
ORDER BY AvgPrice DESC;
`,
  },
];

export function sampleForName(name) {
  const n = String(name).toLowerCase();
  return SAMPLES.find((s) => n.startsWith(s.id)) || null;
}

/** 샘플이 아닌 DB용 기본 예시: 첫 테이블을 조회한다. */
export function genericExample(objects) {
  const first = objects.find((o) => o.type === 'table') || objects[0];
  if (!first) return `SELECT name, type FROM sqlite_master;\n`;
  const q = /^[A-Za-z_][A-Za-z0-9_]*$/.test(first.name) ? first.name : '"' + first.name.replace(/"/g, '""') + '"';
  return `SELECT * FROM ${q} LIMIT 100;\n`;
}
