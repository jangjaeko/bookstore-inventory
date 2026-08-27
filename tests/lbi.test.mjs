// LBI 도서관 납품 인보이스 — 한 권이 두 줄에 걸쳐 있는 양식.
//   윗줄: NO · ISBN · 로마자 제목 · 금액 · Copies · 로마자 저자 · Pub.Date
//   아랫줄: 한글 제목(Title 열) · 한글 저자(Author 열)
// 실제 인보이스에서 그대로 가져온 행들입니다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BUILTIN_PRESETS, buildPlan, makeMatchKey, splitRows } from "../lib/parse.ts";

const T = (...c) => c.join("\t");
const LBI = BUILTIN_PRESETS.lbi.mapping;
const OPTS = { multiRow: true };

// NO │ ISBN │ Title │ Unit Price │ 15% Discount │ Net Price │ Copies │ Amount │ Author │ Pub. Date
const HEADER = T("NO","ISBN","Title","Unit Price","15% Discount","Net Price","Copies","Amount","Author","Pub. Date");
/** 구역 제목은 ISBN 열(2열)에 들어옵니다. */
const SECTION = (name) => T("", name, "", "", "", "", "", "", "", "");
/** 윗줄 + 아랫줄 한 쌍 */
const pair = (no, isbn, roman, price, dc, net, copies, amount, romanAuthor, date, korTitle, korAuthor) => [
  T(no, isbn, roman, price, dc, net, copies, amount, romanAuthor, date),
  T("", "", korTitle, "", "", "", "", "", korAuthor, ""),
];

const BOOKS = [
  ...pair("1","9791168343641"," Bulgeun kal [ gaejeongpan ]","$41.50","($6.23)","$35.27 ","1","$35.27 "," Jeong, Bora (Author)","202603","붉은 칼 (개정판)","정보라"),
  ...pair("2","9791124038192"," Naui Wanbyeokhan Jangnyesik","$44.00","($6.60)","$37.40 ","1","$37.40 "," Jo Hyeonseon (Author)","202601","나의 완벽한 장례식","조현선 저"),
  // 저자가 여럿인 행
  ...pair("3","9791130674643","Nungwa Dolmaengi","$43.50 ","($6.53)","$36.97 ","1","$36.97 ","Wi Sujeong, Kim Hyejin, Seong Hyeryeong, Lee Minjin, Jeong Ihyeon (Authors), 1 more","202601","눈과 돌멩이 2026 제49회 이상문학상 작품집","위수정, 김혜진, 성혜령, 이민진, 정이현 저 외 1명"),
  // ISBN 이 따옴표+공백으로 감싸인 행
  ...pair("9",'"    9791141615819"',"Yaksogui sedae","$43.50","($6.53)","$36.97 ","1","$36.97 ","Baek, Onyu (Author)","202603","약속의 세대","백온유"),
  // 한글 제목에 원제가 붙은 행
  ...pair("13","9791130681009","Tteonan Geoseun Doraoji Anneunda","$41.50","($6.23)","$35.27 ","1","$35.27 ","Julian Barnes (Author), Jeong Yeongmok (Translator)","202601","떠난 것은 돌아오지 않는다 = Departure(s)","줄리언 반스 저/정영목 역"),
  ...pair("33","9788949105833"," Mianhae! gwaenchana ajeossi","$29.50","($4.43)","$25.07 ","1","$25.07 ","Gim, Gyeong-hui (Author, Illustrator)","202602","미안해! 괜찮아 아저씨","김경희 글그림"),
];

// 구역 사이의 예산·합계 블록 (ISBN·도서명 열이 비어 있음)
const BUDGET = [
  T("", "", "", "", "", "", "", "", "($557.58)", "Spring (FEB)"),
  T("", "", "", "", "", "19C", "643.39C", "($643.39)", "Summer (JUN)", ""),
  T("", "", "", "", "", "", "", "", "$1,250.00 ", "Budget"),
  T("", "", "", "", "", "", "", "", "$16.03 ", "Budget Left"),
];

const TEXT = [
  HEADER,
  SECTION("ADULT FICTION"),
  ...BOOKS.slice(0, 10),
  ...BUDGET,
  SECTION("ADULT NON - FICTION"),
  ...BOOKS.slice(10),
].join("\n");

const parse = () => {
  const { rows } = splitRows(TEXT, "auto");
  return { rows, plan: buildPlan(rows, LBI, new Set(), OPTS) };
};
const items = () => parse().plan.filter((p) => p.status === "new").map((p) => p.item);

test("두 줄이 한 권으로 합쳐진다", () => {
  const { plan } = parse();
  const kept = plan.filter((p) => p.status === "new" || p.status === "update");
  assert.equal(kept.length, 6, "12줄이 6권으로");
  assert.equal(plan.filter((p) => p.status === "merged").length, 6, "아랫줄 6개는 윗줄에 합쳐짐");
});

test("아랫줄의 한글 제목·저자가 윗줄의 로마자를 덮어쓴다", () => {
  const first = items()[0];
  assert.equal(first.title, "붉은 칼 (개정판)");
  assert.equal(first.author, "정보라");
  // 윗줄에만 있던 값은 그대로 남습니다.
  assert.equal(first.isbn, "9791168343641");
  assert.equal(first.cad, 41.5);
  assert.equal(first.qty, 1);
  assert.equal(first.pubDate, "202603");
});

test("구역 제목과 예산·합계 블록은 도서로 잡히지 않는다", () => {
  const { rows, plan } = parse();
  const dropped = plan.filter((p) => !["new", "update", "merged"].includes(p.status));
  const labels = dropped.map((p) => rows[p.idx].find(Boolean) ?? "");
  assert.ok(labels.includes("ADULT FICTION"));
  assert.ok(labels.includes("ADULT NON - FICTION"));
  assert.equal(dropped.length, 1 + 2 + BUDGET.length, "머리글 1 + 구역제목 2 + 예산 4");
});

test("예산 줄이 앞 도서에 잘못 합쳐지지 않는다", () => {
  // 예산 줄에는 도서명이 없으므로 이어지는 줄로 보지 않습니다.
  const beforeBudget = items().find((i) => i.title === "떠난 것은 돌아오지 않는다 = Departure(s)");
  assert.equal(beforeBudget.qty, 1, "Copies 가 '19C' 같은 값으로 오염되지 않아야 함");
  assert.equal(beforeBudget.author, "줄리언 반스 저/정영목 역");
});

test("따옴표로 감싸인 ISBN 도 한 권으로 시작된다", () => {
  const it = items().find((i) => i.title === "약속의 세대");
  assert.equal(it.isbn, "9791141615819");
  assert.equal(makeMatchKey(it), "i:9791141615819");
  assert.equal(it.author, "백온유");
});

test("저자가 여럿인 행도 한글 표기를 가져온다", () => {
  const it = items().find((i) => i.title.startsWith("눈과 돌멩이"));
  assert.equal(it.author, "위수정, 김혜진, 성혜령, 이민진, 정이현 저 외 1명");
});

test("2줄 옵션을 끄면 같은 데이터가 두 권으로 잘못 갈라진다", () => {
  // 옵션의 존재 이유를 못 박아 두는 테스트입니다.
  const { rows } = splitRows(TEXT, "auto");
  const flat = buildPlan(rows, LBI, new Set()).filter((p) => p.status === "new");
  assert.equal(flat.length, 12, "6권이 아니라 12개로 잡힘");
  // 그리고 아랫줄은 ISBN 이 없어 제목+저자로 식별되므로 재고와 이어지지 않습니다.
  const korOnly = flat.find((p) => p.item.title === "붉은 칼 (개정판)");
  assert.equal(makeMatchKey(korOnly.item), "t:붉은칼(개정판)|정보라");
});

test("선박으로 입고한 책을 LBI 인보이스로 차감할 수 있다", () => {
  const inbound = { isbn: "9791124038192", title: "나의 완벽한 장례식", author: "조현선 저" };
  const outbound = items().find((i) => i.title === "나의 완벽한 장례식");
  assert.equal(makeMatchKey(inbound), makeMatchKey(outbound));
});

test("BPL 은 한 줄, LBI 는 두 줄 양식으로 선언돼 있다", () => {
  assert.equal(BUILTIN_PRESETS.bpl.multiRow, undefined);
  assert.equal(BUILTIN_PRESETS.lbi.multiRow, true);
  assert.equal(BUILTIN_PRESETS.bpl.direction, "out");
  assert.equal(BUILTIN_PRESETS.lbi.direction, "out");
  assert.equal(BUILTIN_PRESETS.shipping.direction, undefined, "선박은 입고(기본)");
});
