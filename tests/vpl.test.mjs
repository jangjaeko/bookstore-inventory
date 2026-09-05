// VPL 주문 엑셀 (선박 16열, A열 TOTAL 포함).
// 실제 파일에서 그대로 가져온 행들이라 엑셀이 만들어내는 지저분한 형태가 다 들어 있습니다:
//   · 셀 안 줄바꿈을 큰따옴표로 감싼 제목
//   · ISBN 에 "/절판" 이 붙은 행
//   · 가격·무게가 통째로 빈 행
//   · 메모 줄, 완전히 빈 줄
import { test } from "node:test";
import assert from "node:assert/strict";
import { BUILTIN_PRESETS, buildPlan, guessMapping, makeMatchKey, splitRows } from "../lib/parse.ts";

const T = (...c) => c.join("\t");
const SHIP = BUILTIN_PRESETS.shipping.mapping;

// TOTAL │ ISBN │ title │ Unit Price │ 15% DC │ After DC │ Copies │ Amount │
// Author │ Pub.Date │ Place Of Publication │ Publisher │ Subject │ Copies │ KRW │ Gram
const HEADER = T("TOTAL","ISBN","title","Unit Price","15% DC","After DC","Copies","Amount","Author","Pub.Date","Place Of Publication","Publisher","Subject ","Copies","KRW","Gram");

const NORMAL = [
  T("1","9788972754190","악의","$37.00 ","($5.55)","$31.45 ","1","$31.45 ","히가시노 게이고 저/양윤옥 역","200807","","현대문학","FIC > MYS","1","$14,000","464 "),
  T("1","9791194930136","장미와 나이프","$41.50 ","($6.23)","$35.27 ","1","$35.27 ","히가시노 게이고 저/김윤경 역","202506","","반타","FIC > MYS","1","$18,000","376 "),
  T("2","9788954646079","바깥은 여름","$37.00 ","($5.55)","$31.45 ","2","$62.90 ","김애란 저","201706","","문학동네","국내도서 > 소설/시/희곡 > 테마소설 > 영화와 드라마 원작","3","$16,000","346 "),
];

// ISBN 에 "/절판" 이 붙고 수량이 0 인 행
const DISCONTINUED = T("0","9788979197686/절판","방과 후(절판)","$37.50 ","($5.63)","$31.87 ","1","$31.87 ","히가시노 게이고 저","200707","","창해(새우와 고래)","FIC > MYS","0","$13,500","510 ");

// 가격 일부가 빈 행 (After DC·Amount 없음)
const PARTIAL = T("1","9791163898078","방과 후 (개정판)","$35.00","","","1","","히가시노 게이고 저/양윤옥 역","201907","","소미미디어","FIC > MYS","1","$14,800","422 ");

// ★ 셀 안에 줄바꿈이 든 제목 — 엑셀이 큰따옴표로 감싸서 내보냅니다.
const MULTILINE = [
  T("1","9791193153710",'"\n너를 아끼며 살아라 "',"","","","","","","","","더블북","","1","",""),
  T("1","9791192366487",'"\n매일 만들어 먹고 싶은 별미 솥밥, 이색 덮밥"',"","","","","","","","","레시피팩토리(단행)","request 30c","1","",""),
  T("1","9791193904251",'"\n소득혁명 : 당신의 자산이 스스로 일하게 하라 "',"","","","","","","","","서삼독","","1","",""),
];

// 가격·무게가 전혀 없는 행
const NO_PRICE = T("1","9791164459704","싯다르타 = Siddhartha","","","","","","","","","더스토리","","1","","");

// 잡음: 메모 줄, 완전히 빈 줄, 0 만 있는 줄
const BLANK = T(...Array(16).fill(""));
const ZERO_ONLY = T("0", ...Array(12).fill(""), "0", "", "");

const TEXT = [
  HEADER,
  ...NORMAL,
  DISCONTINUED,
  PARTIAL,
  BLANK,
  ...MULTILINE,
  NO_PRICE,
  ZERO_ONLY,
].join("\n");

const parse = () => {
  const { rows } = splitRows(TEXT, "auto");
  return { rows, plan: buildPlan(rows, SHIP, new Set()) };
};
const items = () => parse().plan.filter((p) => p.status === "new").map((p) => p.item);

test("VPL 헤더가 기존 16열 선박 양식과 정확히 맞는다", () => {
  const { rows } = splitRows(TEXT, "auto");
  assert.equal(Math.max(...rows.map((r) => r.length)), 16);
  assert.equal(SHIP.length, 16);
  // 머리글로 인식되어 걸러져야 함
  assert.equal(buildPlan(rows, SHIP, new Set())[0].status, "header");
});

test("셀 안 줄바꿈이 든 제목이 한 권으로 읽힌다", () => {
  // 줄 단위로 잘랐다면 3권이 6줄로 쪼개져 제목 없는 행이 생깁니다.
  const found = items().map((i) => i.title);
  assert.ok(found.includes("너를 아끼며 살아라"), `실제: ${JSON.stringify(found)}`);
  assert.ok(found.includes("매일 만들어 먹고 싶은 별미 솥밥, 이색 덮밥"));
  assert.ok(found.includes("소득혁명 : 당신의 자산이 스스로 일하게 하라"));
});

test("줄바꿈이 제목 안에 남지 않는다", () => {
  for (const it of items()) {
    assert.ok(!/[\r\n]/.test(it.title), `제목에 줄바꿈: ${JSON.stringify(it.title)}`);
    assert.equal(it.title, it.title.trim());
  }
});

test("줄바꿈 제목 행도 ISBN·출판사·수량이 제자리에 있다", () => {
  const it = items().find((i) => i.title === "너를 아끼며 살아라");
  assert.equal(it.isbn, "9791193153710");
  assert.equal(it.publisher, "더블북");
  assert.equal(it.qty, 1);
  assert.equal(it.krw, undefined, "KRW 가 비어 있으면 값이 없어야 함");
  assert.equal(it.weight, undefined);
});

test("정상 행의 모든 값이 제자리에 들어간다", () => {
  const [first] = items();
  assert.equal(first.qty, 1, "수량은 A열 TOTAL");
  assert.equal(first.isbn, "9788972754190");
  assert.equal(first.title, "악의");
  assert.equal(first.cad, 37, "Unit Price");
  assert.equal(first.author, "히가시노 게이고 저/양윤옥 역");
  assert.equal(first.pubDate, "200807");
  assert.equal(first.publisher, "현대문학", "Place Of Publication 이 아니라 Publisher");
  assert.equal(first.subject, "FIC > MYS");
  assert.equal(first.krw, 14000, "$14,000 → 14000");
  assert.equal(first.weight, 464);
});

test("수량은 Copies 가 아니라 A열 TOTAL 에서 온다", () => {
  const it = items().find((i) => i.title === "바깥은 여름");
  assert.equal(it.qty, 2, "A열 TOTAL=2 (뒤쪽 Copies 열은 3)");
});

test("ISBN 에 '/절판' 이 붙어도 같은 책으로 식별된다", () => {
  const it = items().find((i) => i.title === "방과 후(절판)");
  assert.equal(it.isbn, "9788979197686/절판", "원문은 그대로 보존");
  assert.equal(makeMatchKey(it), "i:9788979197686", "매칭은 숫자만으로");
  assert.equal(it.qty, 0, "TOTAL 0 → 0권");
});

test("가격이 일부 비어도 나머지는 정상이다", () => {
  const it = items().find((i) => i.title === "방과 후 (개정판)");
  assert.equal(it.cad, 35);
  assert.equal(it.krw, 14800);
  assert.equal(it.weight, 422);
  assert.equal(it.qty, 1);
});

test("가격·무게가 전혀 없어도 도서로 읽힌다", () => {
  const it = items().find((i) => i.title === "싯다르타 = Siddhartha");
  assert.equal(it.isbn, "9791164459704");
  assert.equal(it.publisher, "더스토리");
  assert.equal(it.cad, undefined);
  assert.equal(it.weight, undefined);
});

test("빈 줄과 0 만 있는 줄은 버려진다", () => {
  const { plan } = parse();
  const kept = plan.filter((p) => p.status === "new" || p.status === "update");
  // 정상 3 + 절판 1 + 가격일부 1 + 줄바꿈 3 + 가격없음 1 = 9권
  assert.equal(kept.length, 9);
});

test("자동 감지도 이 양식을 읽어낸다", () => {
  const { rows } = splitRows(TEXT, "auto");
  const g = guessMapping(rows);
  assert.equal(g.indexOf("isbn"), 1);
  assert.equal(g.indexOf("title"), 2);
  assert.equal(g.indexOf("author"), 8);
  assert.equal(g.indexOf("pubDate"), 9);
  assert.equal(g.indexOf("publisher"), 11, "10열(발행지)이 아니라 11열(출판사)");
  assert.equal(g.indexOf("subject"), 12);
  assert.equal(g.indexOf("weight"), 15);
});

test("따옴표 안의 구분자는 셀을 나누지 않는다", () => {
  // CSV 로 붙여넣었을 때 제목 속 쉼표가 열을 밀어내면 안 됩니다.
  const { rows } = splitRows('제목,수량\n"솥밥, 이색 덮밥",3', "comma");
  assert.deepEqual(rows[1], ["솥밥, 이색 덮밥", "3"]);
});

test('"" 는 따옴표 한 글자로 푼다', () => {
  const { rows } = splitRows('a\t"그는 ""안녕"" 했다"\tb', "tab");
  assert.deepEqual(rows[0], ["a", '그는 "안녕" 했다', "b"]);
});
