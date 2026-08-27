// BPL 도서관 납품 인보이스(출고 문서) 파싱 검증.
// 실제 인보이스에서 그대로 가져온 행들이라 구역 제목·예산 행·따옴표 ISBN 등이 섞여 있습니다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BUILTIN_PRESETS, buildPlan, guessMapping, makeMatchKey, splitRows } from "../lib/parse.ts";

const T = (...c) => c.join("\t");
const BPL = BUILTIN_PRESETS.bpl.mapping;

// ISBN │ Title │ Title.Kor │ Other Title │ Unit Price │ 15% Discount │ Net Price │
// Author │ Author.Kor │ Pub.City │ Pub.City.Kor │ Publisher │ Publisher.Kor │
// Pub.Date │ Subject │ Copies │ Amount
const HEADER = T("ISBN","Title","Title. Kor","Other Title","Unit Price","15% Discount","Net Price","Author","Author. Kor","Pub.City","Pub.City. Kor","Publisher","Publisher. Kor","Pub. Date","Subject","Copies","Amount");

const SECTION = (name) => T(name, ...Array(16).fill(""));
const BLANKISH = T(...Array(17).fill(""));

const BOOKS = [
  T("9791165704049","Isang neungnyeokja","이상능력자","","$36.50 ","($5.48)","$31.02 ","Ham, Seol-gi (Author)","함설기 저","Seoul-si","서울시","Changbigyoyuk","창비교육","202603","KOR TEEN FIC > GEN ","2","$62.04 "),
  // ISBN 이 따옴표 + 공백으로 감싸여 들어오는 행
  T('"    9791174760548"',"Pandemoniom","판데모니움","","$39.50 ","($5.93)","$33.57 ","Yu, Sang-a (Author)","유상아 저","Seoul-si","서울시","Sowonnamu","소원나무","202603","KOR TEEN FIC > GEN ","2","$67.14 "),
  T("9788936457457","Hogu","호구","","$35.00 ","($5.25)","$29.75 ","Gim, Min-seo (Author)","김민서 저","Seoul-si","서울시","Changbi","창비","202603","KOR TEEN FIC > GEN ","2","$59.50 "),
  T("9791130674490","Reokki peonchi","럭키 펀치","","$37.00 ","($5.55)","$31.45 ","I, Song-hyeon (Author)","이송현 저","Gyeonggi-do Seongnam-si","경기도 성남시","Dasanchaekbang","다산책방","202602","KOR TEEN FIC > GEN ","2","$62.90 "),
  T("9788936431631","Gugeo gyogwaseo jakpum ilkgi Jung2 soseol [ gaejeongpan ]","국어 교과서 작품 읽기 중2 소설 [ 개정판 ]","","$35.00 ","($5.25)","$29.75 ","Gim, Mi-yeong (Editor); Seo, Deok-hui (Editor)","김미영, 서덕희 공편","Seoul-si","서울시","Changbi","창비","202511","KOR TEEN FIC > GEN ","2","$59.50 "),
  T("9788976047908","Chinguga sarajyeotda","친구가 사라졌다","","$38.50 ","($5.78)","$32.72 ","Kaneshiro, Kazuki (Author); Yang, Eok-gwan (Translator)","가네시로 가즈키 저/양억관 역","Seoul-si","서울시","Munyechunchusa","문예춘추사","202604","Teen FIC","1","$32.72 "),
  // Copies 0 — 주문했지만 나가지 않은 행
  T("9791175910423","A, ige cheolhagiguna! ‘wae’ga ‘nae saenggak’i doeneun sungan","아, 이게 철학이구나! ‘왜’가 ‘내 생각’이 되는 순간","","$43.50 ","($6.53)","$36.97 ","Ji, Ha-neul (Author; Illustrator)","지하늘 글그림","Gyeonggi-do Paju-si","경기도 파주시","Wisdomhouse","위즈덤하우스","202603","KOR TEEN > Philosophy","0","$0.00 "),
  // 원제(Other Title)가 있는 행
  T("9791167742063","Gyeongheomui myeoljong","경험의 멸종","The Extinction of Experience: Being Human in a Disembodied World","$47.50 ","($7.13)","$40.37 ","Rosen, Christine (Author); I, Yeong-rae (Translator)","크리스틴 로젠 저/이영래 역","Seoul-si","서울시","Across","어크로스","202505","KOR Social Science > Sociology > General","1","$40.37 "),
  // 한글 제목 자리에 메모가 들어간 행 (ISBN 은 정상)
  T("9788925588735","Peurojekteu heilmeri","Qty. increased upon request ","Project Hail Mary","$56.00 ","($8.40)","$47.60 ","Weir, Andy (Author); Gang, Dong-hyeok (Translator)","앤디 위어 저; 강동혁 역","Seoul-si","서울시","Rhkorea(RHK)","알에이치코리아(RHK)","202602"," FIC > SF","5","$238.00 "),
  // 저자에 접미어가 없는 행
  T("9791140714575","Misulgwane gan halmi","미술관에 간 할미","","$51.50 ","($7.73)","$43.77 ","Halmi (Author)","할미","Seoul-si","서울시","Thequest","더퀘스트","202506","KOR Arts > Fine Arts / General","1","$43.77 "),
];

// 예산·합계 행: 앞쪽 열이 비고 한참 오른쪽에만 값이 있습니다.
const BUDGET = T("","","","","","","","","2026 Teen Budget (ME+CA+Mc)","$4,500.00 ","Request","Budget Spent","Budget Spent %","Budget Left","Teen Total ","38C","1203.13c");
const SUBTOTAL = T("Subtotal", ...Array(13).fill(""), "TEEN & ADULT ", "414", "$15,588.90");
const GST = T("GST (5% )", ...Array(15).fill(""), "$779.44 ");
const TOTAL = T("Total Amount Due (CAD)", ...Array(15).fill(""), "$16,368.34");

const TEXT = [
  HEADER,
  SECTION("Teen FIC"),
  ...BOOKS.slice(0, 6),
  BLANKISH,
  SECTION("Teen NON-FIC"),
  ...BOOKS.slice(6, 7),
  BUDGET,
  SECTION(" Requests - Jan, Feb, Mar 2026"),
  ...BOOKS.slice(7),
  SECTION("MYS"),
  SECTION("Classics"),
  SUBTOTAL,
  GST,
  TOTAL,
].join("\n");

const parse = (mapping = BPL) => {
  const { rows } = splitRows(TEXT, "auto");
  return { rows, plan: buildPlan(rows, mapping, new Set()) };
};
const items = () => parse().plan.filter((p) => p.status === "new").map((p) => p.item);

test("탭만 있는 빈 행은 아예 읽히지 않는다", () => {
  const withBlank = splitRows(TEXT, "auto").rows.length;
  const withoutBlank = splitRows(TEXT.split("\n").filter((l) => l !== BLANKISH).join("\n"), "auto").rows.length;
  assert.equal(withBlank, withoutBlank, "빈 행이 있으나 없으나 읽히는 행 수는 같아야 함");
});

test("도서 행만 남고 구역 제목·예산·합계는 전부 걸러진다", () => {
  const { plan } = parse();
  const kept = plan.filter((p) => p.status === "new" || p.status === "update");
  assert.equal(kept.length, BOOKS.length, "도서 10행만 남아야 함");

  // 걸러진 행들이 실제로 그 행들인지 확인
  const { rows } = splitRows(TEXT, "auto");
  const droppedFirstCells = plan
    .filter((p) => p.status !== "new" && p.status !== "update")
    .map((p) => rows[p.idx][0]);
  for (const label of ["Teen FIC", "Teen NON-FIC", "MYS", "Classics", "Subtotal", "GST (5% )", "Total Amount Due (CAD)", "ISBN"]) {
    assert.ok(droppedFirstCells.includes(label), `"${label}" 행이 걸러져야 함`);
  }
});

test("따옴표와 공백으로 감싸인 ISBN 을 정리한다", () => {
  const pan = items().find((i) => i.title === "판데모니움");
  assert.equal(pan.isbn, "9791174760548");
  assert.equal(makeMatchKey(pan), "i:9791174760548");
});

test("로마자가 아니라 한글 제목·저자·출판사를 가져온다", () => {
  const first = items()[0];
  assert.equal(first.title, "이상능력자");
  assert.equal(first.author, "함설기 저");
  assert.equal(first.publisher, "창비교육");
  assert.equal(first.pubDate, "202603");
  assert.equal(first.subject, "KOR TEEN FIC > GEN");
  assert.equal(first.qty, 2, "Copies 열이 출고 수량");
  assert.equal(first.cad, 36.5, "Unit Price 를 판매가로");
});

test("도시(서울시)를 출판사로 착각하지 않는다", () => {
  for (const it of items()) {
    assert.notEqual(it.publisher, "서울시");
    assert.notEqual(it.publisher, "경기도 파주시");
  }
});

test("Copies 0 인 행도 읽되 수량 0 으로 둔다", () => {
  const zero = items().find((i) => i.title.startsWith("아, 이게 철학이구나!"));
  assert.equal(zero.qty, 0);
});

test("원제(Other Title)는 도서명을 밀어내지 않는다", () => {
  const it = items().find((i) => i.title === "경험의 멸종");
  assert.ok(it, "한글 제목으로 찾을 수 있어야 함");
  assert.equal(it.qty, 1);
});

test("한글 제목이 깨진 행도 ISBN 으로는 같은 책을 가리킨다", () => {
  const odd = items().find((i) => i.isbn === "9788925588735");
  assert.equal(odd.title, "Qty. increased upon request", "원문 그대로 들어옴");
  // 재고에 있는 같은 ISBN 의 책과 이어집니다 (그래서 출고 시 서지정보 갱신을 꺼야 함).
  assert.equal(makeMatchKey(odd), "i:9788925588735");
});

test("열 자동 감지도 한글 열을 골라낸다", () => {
  const { rows } = splitRows(TEXT, "auto");
  const guessed = guessMapping(rows);
  const at = (field) => guessed.indexOf(field);
  assert.equal(at("isbn"), 0);
  assert.equal(at("title"), 2, "1열(로마자)이 아니라 2열(한글)");
  assert.equal(at("author"), 8, "7열(로마자)이 아니라 8열(한글)");
  assert.equal(at("publisher"), 12, "10열(도시)이 아니라 12열(한글 출판사)");
  assert.equal(at("pubDate"), 13);
  assert.equal(at("subject"), 14);
  assert.equal(at("qty"), 15, "Copies");
  assert.equal(at("cad"), 4, "Unit Price");
  assert.equal(at("krw"), -1, "BPL 인보이스에는 원화 정가가 없다");
  assert.equal(at("weight"), -1, "무게도 없다");
});

test("선박 엑셀로 넣은 책을 BPL 인보이스로 다시 찾아낸다", () => {
  // 선박(입고) 쪽에서 만들어질 matchKey 와 BPL(출고) 쪽 matchKey 가 같아야
  // 입고한 책을 출고로 차감할 수 있습니다.
  const inbound = { isbn: "9788936457457", title: "호구", author: "김민서 글" };
  const outbound = items().find((i) => i.title === "호구");
  assert.equal(makeMatchKey(inbound), makeMatchKey(outbound), "ISBN 이 같으면 저자 표기가 달라도 같은 책");
});
