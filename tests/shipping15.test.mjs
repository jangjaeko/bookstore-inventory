// 앞의 TOTAL 열이 없는 선박 양식 (ISBN 부터 시작).
// 확장이 맨 뒤에 회원리뷰 열을 붙이기 전 15열과, 붙인 뒤 16열을 함께 검증합니다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BUILTIN_PRESETS, buildPlan, guessMapping, splitRows } from "../lib/parse.ts";

const T = (...c) => c.join("\t");
const MAP = BUILTIN_PRESETS.shipping15.mapping;

const ROWS = [
  T("9791190896337","우리 아기 알록달록 색깔 촉감책","$30.50 ","($4.58)","$25.92 ","1","$25.92 ","스텔라 배곳 그림","202201","","어스본코리아","Picture book (4–6)","1","13500","324"),
  T("9788934979968","놓지 마 어휘 한자어 4","$36.00 ","($5.40)","$30.60 ","1","$30.60 ","신태훈 글/나승훈 그림/정상은 감수","202201","","주니어김영사","KOR JUR Graphic Novel > Comic (G1-4)","1","15000","446"),
  T("9791168411692","흔한남매 별난 방탈출 5","$38.50 ","($5.78)","$32.72 ","1","$32.72 ","흔한남매 원저/김언정 글/차차 그림/흔한컴퍼니 감수","202205","","미래엔아이세움","KOR JUR Graphic Novel > Comic (G1-4)","1","16800","426"),
  T("9788950993511","Go Go 카카오프렌즈 18 오스트리아","$40.50 ","($6.08)","$34.42 ","1","$34.42 ","김미영 글/김정한 그림","202101","","아울북","KOR JUR Graphic Novel > Comic (G1-4)","1","16800","512"),
  // 무게가 비어 있는 행 — 그 값만 빠지고 나머지는 정상이어야 함
  T("9788949132075","기발하고 괴상하고 웃긴 과학 사전! 바다","$34.00 ","($5.10)","$28.90 ","1","$28.90 ","내셔널지오그래픽 키즈 저/신수진 역","202207","","비룡소","KOR JUR NON-FIC > Science (G3-6)","1","13000",""),
].join("\n");

const items = (mapping = MAP) =>
  buildPlan(splitRows(ROWS, "auto").rows, mapping, new Set())
    .filter((p) => p.status === "new")
    .map((p) => p.item);

test("15열 양식이 모든 값을 제자리에 넣는다", () => {
  const [first] = items();
  assert.equal(first.isbn, "9791190896337");
  assert.equal(first.title, "우리 아기 알록달록 색깔 촉감책");
  assert.equal(first.cad, 30.5);
  assert.equal(first.author, "스텔라 배곳 그림");
  assert.equal(first.pubDate, "202201");
  assert.equal(first.publisher, "어스본코리아");
  assert.equal(first.subject, "Picture book (4–6)");
  assert.equal(first.qty, 1);
  assert.equal(first.krw, 13500);
  assert.equal(first.weight, 324);
});

test("무게가 모두 들어온다", () => {
  assert.deepEqual(items().map((i) => i.weight), [324, 446, 426, 512, undefined]);
});

test("무게가 빈 행은 무게만 빠지고 나머지는 멀쩡하다", () => {
  const last = items().at(-1);
  assert.equal(last.weight, undefined);
  assert.equal(last.krw, 13000);
  assert.equal(last.title, "기발하고 괴상하고 웃긴 과학 사전! 바다");
  assert.equal(last.qty, 1);
});

test("자동 감지도 15열을 제대로 읽는다", () => {
  const guessed = guessMapping(splitRows(ROWS, "auto").rows);
  assert.equal(guessed.indexOf("isbn"), 0);
  assert.equal(guessed.indexOf("title"), 1);
  assert.equal(guessed.indexOf("cad"), 2);
  assert.equal(guessed.indexOf("author"), 7);
  assert.equal(guessed.indexOf("pubDate"), 8);
  assert.equal(guessed.indexOf("publisher"), 10);
  assert.equal(guessed.indexOf("subject"), 11);
  assert.equal(guessed.indexOf("krw"), 13);
  assert.equal(guessed.indexOf("weight"), 14);
});

test("16열 양식으로 15열을 읽으면 값이 밀린다 (경고가 필요한 이유)", () => {
  const [first] = items(BUILTIN_PRESETS.shipping.mapping.slice(0, 15));
  // ISBN 열이 수량으로, 제목 열이 ISBN 으로 밀립니다.
  assert.notEqual(first.isbn, "9791190896337");
  assert.equal(first.title, "$30.50");
});

// ── 확장이 회원리뷰 열을 붙인 뒤의 형태 (16열) ──
test("회원리뷰가 붙은 16열도 같은 값을 읽어낸다", () => {
  const withReview = ROWS.split("\n")
    .map((l) => l + "\t" + Math.floor(Math.random() * 500))
    .join("\n");
  const rows = splitRows(withReview, "auto").rows;
  assert.equal(Math.max(...rows.map((r) => r.length)), 16);

  const plan = buildPlan(rows, BUILTIN_PRESETS.shipping16r.mapping, new Set());
  const got = plan.filter((p) => p.status === "new").map((p) => p.item);
  const [first] = got;
  assert.equal(first.isbn, "9791190896337");
  assert.equal(first.title, "우리 아기 알록달록 색깔 촉감책");
  assert.equal(first.qty, 1);
  assert.equal(first.krw, 13500);
  assert.equal(first.weight, 324);
  assert.equal(first.publisher, "어스본코리아");
});

test("회원리뷰 값은 어디에도 저장되지 않는다", () => {
  const withReview = ROWS.split("\n").map((l) => l + "\t9999").join("\n");
  const rows = splitRows(withReview, "auto").rows;
  const got = buildPlan(rows, BUILTIN_PRESETS.shipping16r.mapping, new Set())
    .filter((p) => p.status === "new")
    .map((p) => p.item);
  for (const it of got) {
    for (const [field, v] of Object.entries(it)) {
      assert.notEqual(String(v), "9999", `${field} 에 회원리뷰가 들어감`);
    }
  }
  // 16열 양식의 마지막 칸은 "사용 안 함" 이어야 합니다.
  assert.equal(BUILTIN_PRESETS.shipping16r.mapping.length, 16);
  assert.equal(BUILTIN_PRESETS.shipping16r.mapping[15], "");
});

test("15열 양식과 16열 양식은 앞 15칸이 같다", () => {
  assert.deepEqual(
    BUILTIN_PRESETS.shipping16r.mapping.slice(0, 15),
    BUILTIN_PRESETS.shipping15.mapping,
  );
});
