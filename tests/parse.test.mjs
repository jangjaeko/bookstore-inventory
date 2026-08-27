// 실제 선박 엑셀에서 복사한 형태를 그대로 넣어 파서를 검증합니다.
//   실행: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BUILTIN_PRESETS,
  buildPlan,
  guessMapping,
  makeMatchKey,
  splitRows,
} from "../lib/parse.ts";

const T = (...cells) => cells.join("\t");

// 선박 엑셀 머리글. 2열(ISBN)과 16열(무게)에는 머리글이 없습니다.
const HEADER = T(
  "TOTAL", "", "BPL Series", "Unit Price", "15% DC", "After DC", "Copies", "Amount",
  "Author", "Pub.Date", "", "Publisher", "Subject", "TOTAL", "KRW", "",
);

const DATA = [
  T("5", "9791130681887", "독후감 숙제가 끝나지 않아", "$34.50", "($5.18)", "$29.32", "1", "$29.32", "누카가 미오 글/토티 그림/김지영 역", "202607", "", "다산어린이", "KOR JUR FIC > GEN (G1-6)", "5", "15000", "378"),
  T("2", "9788965468059", "레몬나무의 바다", "$43.00", "($6.45)", "$36.55", "1", "$36.55", "마리아 돌로레스 아길라 글/김난령 역", "202607", "", "밝은미래", "국내도서 > 어린이 > 3-4학년 > 3-4학년 그림/동화책 > 3-4학년 창작동화", "2", "19000", "458"),
  // KRW 에 쉼표가 들어간 행
  T("9", "9788949136059", "의자 게임", "$31.00", "($4.65)", "$26.35", "1", "$26.35", "유소정 글/오삼이 그림", "202606", "", "비룡소", "KOR JUR FIC > GEN (G3-6)", "9", "15,000", "246"),
  T("4", "9791141614072", "나나 올리브에게", "$33.50", "($5.03)", "$28.47", "1", "$28.47", "루리 글그림", "202511", "", "문학동네", "KOR JUR FIC > GEN (G1-2)", "4", "15000", "348"),
  T("4", "9791173320835", "하고 싶은 공부", "$34.50", "($5.18)", "$29.32", "1", "$29.32", "박현숙 글/함주해 그림", "202502", "", "김영사", "KOR JUR FIC > GEN", "4", "15500", "358"),
  T("4", "9788964965580", "섬뜩한 코바늘", "$33.00", "($4.95)", "$28.05", "1", "$28.05", "에런 레이놀즈 글/피터 브라운 그림/홍연미 역", "202607", "", "토토북", "KOR JUR FIC > GEN (G1-2)", "4", "15000", "332"),
  // ISBN 자리에 "판매용" 이 들어간 행
  T("2", "판매용", "긴긴밤", "$30.00", "($4.50)", "$25.50", "1", "$25.50", "루리 글그림", "202102", "", "문학동네", "국내도서 > 어린이 > 5-6학년 > 5-6학년 그림/동화책 > 5-6학년 창작동화", "2", "12500", "376"),
  // 제목에 쉼표가 들어간 행
  T("1", "9791124455074", "웹툰동화 다정한 말, 단단한 말", "$36.50", "($5.48)", "$31.02", "1", "$31.02", "고정욱 원저/돌배 글그림", "202607", "", "더블북", "KOR JUR FIC > GEN (G1-2)", "1", "17000", "348"),
];

const TEXT = [HEADER, ...DATA].join("\n");
const SHIPPING = BUILTIN_PRESETS.shipping.mapping;

const parseAll = (mapping = SHIPPING) => {
  const { rows } = splitRows(TEXT, "auto");
  return { rows, plan: buildPlan(rows, mapping, new Set()) };
};

test("엑셀 복사본은 탭 구분 16열로 읽힌다", () => {
  const { rows, delim } = splitRows(TEXT, "auto");
  assert.equal(delim, "tab");
  assert.equal(rows.length, 9);
  assert.equal(Math.max(...rows.map((r) => r.length)), 16);
});

test("열 자동 감지 결과가 선박 양식과 일치한다", () => {
  const { rows } = splitRows(TEXT, "auto");
  assert.deepEqual(guessMapping(rows), SHIPPING);
});

test("머리글 행은 걸러지고 데이터 8행만 남는다", () => {
  const { plan } = parseAll();
  assert.equal(plan[0].status, "header");
  assert.equal(plan.filter((p) => p.status === "new").length, 8);
});

test("수량은 Copies(1) 가 아니라 TOTAL 열에서 가져온다", () => {
  const { plan } = parseAll();
  assert.deepEqual(
    plan.slice(1).map((p) => p.item.qty),
    [5, 2, 9, 4, 4, 4, 2, 1],
  );
});

test("금액·무게·날짜가 올바르게 변환된다", () => {
  const first = parseAll().plan[1].item;
  assert.equal(first.cad, 34.5, "Unit Price($34.50) 를 CAD 로");
  assert.equal(first.krw, 15000);
  assert.equal(first.weight, 378);
  assert.equal(first.pubDate, "202607");
  assert.equal(first.author, "누카가 미오 글/토티 그림/김지영 역");
  assert.equal(first.publisher, "다산어린이");
  assert.equal(first.subject, "KOR JUR FIC > GEN (G1-6)");
});

test("KRW 의 천단위 쉼표와 제목 안의 쉼표를 구분한다", () => {
  const { plan } = parseAll();
  assert.equal(plan[3].item.krw, 15000, "'15,000' → 15000");
  assert.equal(plan[8].item.title, "웹툰동화 다정한 말, 단단한 말");
});

test("ISBN 자리의 '판매용' 은 원문을 보존하되 제목+저자로 식별한다", () => {
  const sale = parseAll().plan[7].item;
  assert.equal(sale.isbn, "판매용");
  assert.equal(makeMatchKey(sale), "t:긴긴밤|루리글그림");
  // 띄어쓰기가 달라도 같은 책으로 봅니다.
  assert.equal(makeMatchKey({ title: "긴 긴 밤", author: "루 리 글그림" }), makeMatchKey(sale));
});

test("ISBN 은 하이픈 유무와 상관없이 같은 책으로 식별한다", () => {
  const first = parseAll().plan[1].item;
  assert.equal(makeMatchKey(first), "i:9791130681887");
  assert.equal(makeMatchKey({ isbn: "979-11-3068-188-7", title: "제목이 달라도" }), makeMatchKey(first));
});

test("같은 파일을 다시 붙여넣으면 신규가 아니라 갱신으로 잡힌다", () => {
  const { rows, plan } = parseAll();
  const existing = new Set(plan.slice(1).map((p) => p.matchKey));
  const again = buildPlan(rows, SHIPPING, existing);
  assert.ok(again.slice(1).every((p) => p.status === "update"));
});

test("탭이 아니라 공백으로 붙여넣어도 8행을 읽어낸다", () => {
  // 채팅·메모장을 거치면 탭이 공백으로 바뀌고 빈 열이 사라집니다.
  const spaced = DATA.map((l) => l.split("\t").filter(Boolean).join("    ")).join("\n");
  const { rows, delim } = splitRows(spaced, "auto");
  assert.equal(delim, "spaces");
  const plan = buildPlan(rows, guessMapping(rows), new Set());
  assert.equal(plan.filter((p) => p.status === "new").length, 8);
  assert.equal(plan[0].item.title, "독후감 숙제가 끝나지 않아");
  assert.equal(plan[0].item.qty, 5);
  assert.equal(plan[0].item.krw, 15000);
});

test("SALES 양식(확장 Case 1)도 읽어낸다", () => {
  const sales = [
    T("34.50", "", "독후감 숙제가 끝나지 않아", "다산어린이", "누카가 미오 글/토티 그림/김지영 역", "3", "15000", "378"),
  ].join("\n");
  const { rows } = splitRows(sales, "auto");
  const [entry] = buildPlan(rows, BUILTIN_PRESETS.sales.mapping, new Set());
  assert.equal(entry.status, "new");
  assert.equal(entry.item.qty, 3);
  assert.equal(entry.item.cad, 34.5);
  assert.equal(entry.item.publisher, "다산어린이");
});

test("도서명 열이 비면 그 행은 건너뛴다", () => {
  const { rows } = splitRows(T("5", "9791130681887", "", "$34.50"), "auto");
  const [entry] = buildPlan(rows, ["qty", "isbn", "title", "cad"], new Set());
  assert.equal(entry.status, "noTitle");
});
