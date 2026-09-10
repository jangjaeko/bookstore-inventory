// BPL 인보이스 12열 (로마자 열이 없는 형태).
// 발행지("경기도, 파주시")가 도서명 자리를 뺏어가던 버그의 회귀 테스트를 겸합니다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BUILTIN_PRESETS, buildPlan, guessMapping, splitRows } from "../lib/parse.ts";

const T = (...c) => c.join("\t");
const MAP = BUILTIN_PRESETS.bpl12.mapping;

// ISBN │ Title.Kor │ Unit Price │ 15% Discount │ Net Price │ Copies │ Amount │
// Author.Kor │ Pub. Date │ Pub. City │ Publisher │ Subject
const HEADER = T("ISBN","Title. Kor","Unit Price","15% Discount","Net Price","Copies","Amount","Author. Kor","Pub. Date","Pub. City","Publisher","Subject");
const SECTION = T("Teen FIC", "", "", "", "", "", "Teen 수량 확인필", "", "", "", "", "");

const BOOKS = [
  T("9791167031754","신상문구점","$33.00 ","($4.95)","$28.05 ","1","$28.05 ","김선영 글","202509","서울시","특별한서재","KOR YA FIC > GEN"),
  T("9791167031969","나만의 방","$31.00 ","($4.65)","$26.35 ","2","$52.70 ","뤼도비크 르콩트 저/장소미 역","202605","서울시","특별한서재","YA FIC > GEN"),
  T("9791130682228","AI에게 고백하지 마세요","$35.00 ","($5.25)","$29.75 ","1","$29.75 ","김혜정 저","202607","경기도, 파주시","다산책방","KOR YA FIC > GEN"),
  T("9791130677576","삼도천 환생 고등학교","$35.00 ","($5.25)","$29.75 ","2","$59.50 ","범유진 저","202606","경기도, 파주시","다산책방","KOR YA FIC > GEN"),
  T("9791194273448","오디세이아","$48.00 ","($7.20)","$40.80 ","2","$81.60 ","질리언 크로스 저/호메로스 원저/닐 패커 그림/장은수 해설/윤영 역","202607","서울시","더숲","YA FIC > GEN"),
  T("9791198792136","흔들리는 것들의 시선에서","$33.50 ","($5.03)","$28.47 ","1","$28.47 ","이꽃님 저","202607","서울시","이끌","KOR YA FIC > GEN"),
  T("9791141617790","아스파라거스","$29.50 ","($4.43)","$25.07 ","1","$25.07 ","김양미 저","202607","경기도, 파주시","문학동네","KOR YA FIC > GEN"),
  T("9791175910812","너무 늦은 안녕은 없다","$34.00 ","($5.10)","$28.90 ","2","$57.80 ","김하연 저","202606","경기도, 파주시","위즈덤하우스","KOR YA FIC > GEN"),
  T("9791130676296","곰 가문과 마법 소녀들 1","$38.50 ","($5.78)","$32.72 ","1","$32.72 ","그레이시 김 저/김선영 역","202607","경기도, 파주시","다산책방","YA FIC > GEN"),
  T("9791130681870","폭염 대피소","$32.50 ","($4.88)","$27.62 ","2","$55.24 ","박지숙, 김새벽, 김민정 저","202607","경기도, 파주시","다산책방","KOR YA FIC > GEN"),
  T("9788936457471","파란 파란","$33.00 ","($4.95)","$28.05 ","2","$56.10 ","유지현 저","202604","경기도, 파주시","창비","KOR YA FIC > GEN"),
  T("9791167556011","먹고 싶다, 수박","$27.00 ","($4.05)","$22.95 ","2","$45.90 ","장주식 저/김연제 그림","202608","서울시","우리학교","KOR YA FIC > GEN"),
  T("9791124232163","골볼","$33.50 ","($5.03)","$28.47 ","1","$28.47 ","서성환 저","202607","서울시","안녕로빈","KOR YA FIC > GEN"),
  T("9788936457488","안녕, 미스터 타이거","$33.50 ","($5.03)","$28.47 ","2","$56.94 ","나혜림 저","202605","경기도, 파주시","창비","KOR YA FIC > GEN"),
  T("9791193811719","지붕 위의 방","$35.50 ","($5.33)","$30.17 ","1","$30.17 ","러스킨 본드 저/박산호 역","202602","서울시","생각학교","YA FIC > GEN"),
  T("9791130666662","두 개의 달","$33.50 ","($5.03)","$28.47 ","1","$28.47 ","도미야스 요코 저/이구름 역","202506","경기도, 파주시","다산어린이","YA FIC > GEN"),
  T("9791194442141","검지의 힘","$32.50 ","($4.88)","$27.62 ","1","$27.62 ","이선주 저","202504","경기도, 파주시","돌베개","KOR YA FIC > GEN"),
  T("9791193162682","가상 인간 이서","$34.00 ","($5.10)","$28.90 ","1","$28.90 ","구선아 저","202608","서울시","책폴","KOR YA FIC > GEN"),
  T("9791168343917","너를 미워했던 여름","$32.00 ","($4.80)","$27.20 ","1","$27.20 ","이로아 저","202605","서울시","래빗홀","KOR YA FIC > GEN"),
];

const TEXT = [HEADER, SECTION, ...BOOKS].join("\n");
const parse = (mapping = MAP) => {
  const { rows } = splitRows(TEXT, "auto");
  return { rows, plan: buildPlan(rows, mapping, new Set()) };
};
const items = (mapping) => parse(mapping).plan.filter((p) => p.status === "new").map((p) => p.item);

test("양식이 12열이고 출고 문서다", () => {
  assert.equal(MAP.length, 12);
  assert.equal(BUILTIN_PRESETS.bpl12.direction, "out");
  assert.equal(splitRows(TEXT, "auto").rows[0].length, 12);
});

test("모든 값이 제자리에 들어간다", () => {
  const [first] = items();
  assert.equal(first.isbn, "9791167031754");
  assert.equal(first.title, "신상문구점");
  assert.equal(first.cad, 33, "Unit Price");
  assert.equal(first.qty, 1, "Copies");
  assert.equal(first.author, "김선영 글");
  assert.equal(first.pubDate, "202509");
  assert.equal(first.publisher, "특별한서재");
  assert.equal(first.subject, "KOR YA FIC > GEN");
});

test("발행지(Pub. City)는 어디에도 들어가지 않는다", () => {
  for (const it of items()) {
    for (const [field, v] of Object.entries(it)) {
      assert.ok(v !== "서울시" && v !== "경기도, 파주시", `${field} 에 발행지가 들어감: ${v}`);
    }
  }
});

test("수량은 Copies 열에서 온다", () => {
  assert.deepEqual(
    items().slice(0, 6).map((i) => i.qty),
    [1, 2, 1, 2, 2, 1],
  );
});

test("구역 제목 줄(Teen FIC)은 걸러진다", () => {
  const { rows, plan } = parse();
  const kept = plan.filter((p) => p.status === "new" || p.status === "update");
  assert.equal(kept.length, BOOKS.length);
  const dropped = plan.filter((p) => !["new", "update"].includes(p.status)).map((p) => rows[p.idx][0]);
  assert.ok(dropped.includes("Teen FIC"));
  assert.ok(dropped.includes("ISBN"), "머리글도 걸러짐");
});

// ── 자동 감지 회귀 테스트 ───────────────────────────────────────
// 예전에는 "경기도, 파주시"(8자)가 책 제목보다 길어서 도서명 자리를 뺏고,
// 밀려난 제목 열이 출판사로 들어갔습니다.
test("자동 감지가 발행지를 도서명으로 착각하지 않는다", () => {
  const { rows } = splitRows(TEXT, "auto");
  const g = guessMapping(rows);
  assert.equal(g.indexOf("title"), 1, "도서명은 2열(Title. Kor)");
  assert.equal(g.indexOf("publisher"), 10, "출판사는 11열(Publisher)");
  assert.equal(g[9], "", "10열(Pub. City)은 쓰지 않음");
  assert.equal(g.indexOf("isbn"), 0);
  assert.equal(g.indexOf("author"), 7);
  assert.equal(g.indexOf("pubDate"), 8);
  assert.equal(g.indexOf("subject"), 11);
  assert.equal(g.indexOf("qty"), 5, "수량은 Copies");
});

test("자동 감지로 읽어도 값이 제자리에 들어간다", () => {
  const { rows } = splitRows(TEXT, "auto");
  const [first] = items(guessMapping(rows));
  assert.equal(first.title, "신상문구점");
  assert.equal(first.publisher, "특별한서재");
  assert.equal(first.author, "김선영 글");
});

test("도시가 제목보다 길어도 제목을 고른다 (핵심 규칙)", () => {
  // 제목은 거의 다 서로 다르고, 도시는 몇 개가 반복됩니다.
  // 길이만 보면 도시가 이기므로 "길이 × 다양함" 으로 판단해야 합니다.
  const rows = [
    T("ISBN", "제목", "도시"),
    T("9791167031754", "골볼", "경기도, 파주시"),
    T("9791167031969", "딜리버", "경기도, 파주시"),
    T("9791130682228", "인트로", "경기도, 파주시"),
    T("9791130677576", "파란 파란", "서울특별시 강남구"),
    T("9791194273448", "두 개의 달", "서울특별시 강남구"),
  ].join("\n");
  const g = guessMapping(splitRows(rows, "auto").rows);
  assert.equal(g.indexOf("title"), 1, "짧아도 값이 다양한 열이 도서명");
});
