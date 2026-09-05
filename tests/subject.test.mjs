// Subject 를 "보기" 기준으로 쓸 큰 분류로 자르는 규칙.
// 실제 재고에 들어 있는 값들을 그대로 넣어 검증합니다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { subjectDetail, subjectGroup, subjectGroupPatterns } from "../lib/format.ts";

test("첫 조각이 큰 분류가 된다", () => {
  assert.equal(subjectGroup("KOR FIC > GEN SS"), "KOR FIC");
  assert.equal(subjectGroup("KOR YA FIC > GEN"), "KOR YA FIC");
  assert.equal(subjectGroup("FIC > CLASSICS"), "FIC");
  assert.equal(subjectGroup("Economics > Investing > Stocks/ETF"), "Economics");
});

test("구분자가 없으면 통째로 쓴다", () => {
  assert.equal(subjectGroup("KOR Essays"), "KOR Essays");
  assert.equal(subjectGroup("Classics"), "Classics");
});

test("띄어쓴 하이픈도 구분자로 본다", () => {
  assert.equal(subjectGroup("FIC - GEN SS"), "FIC");
});

test("붙어 있는 하이픈은 단어의 일부로 남긴다", () => {
  // Self-Help 를 "Self" 로 자르면 안 됩니다.
  assert.equal(subjectGroup("Self-Help > Success"), "Self-Help");
  assert.equal(subjectGroup("KOR Self-Help > Life Attitude"), "KOR Self-Help");
  assert.equal(subjectGroup("KOR Parenting > Child-Rearing"), "KOR Parenting");
});

test("첫 조각만으로 의미가 없는 뿌리는 한 단계 더 들어간다", () => {
  // "KOR" 이나 "국내도서" 는 절반 이상의 책에 붙어 있어 걸러내는 의미가 없습니다.
  assert.equal(subjectGroup("KOR > Learning English > English Writing"), "KOR > Learning English");
  assert.equal(
    subjectGroup("국내도서 > 어린이 > 1-2학년 > 1-2학년 만화/애니메이션 > 1-2학년 학습만화"),
    "국내도서 > 어린이",
  );
  assert.equal(subjectGroup("국내도서 > 소설/시/희곡 > 테마소설 > 영화와 드라마 원작"), "국내도서 > 소설/시/희곡");
});

test("비어 있으면 빈 문자열", () => {
  assert.equal(subjectGroup(""), "");
  assert.equal(subjectGroup(null), "");
  assert.equal(subjectGroup("   "), "");
  assert.equal(subjectGroup(" > > "), "");
});

test("세부 분류는 큰 분류를 뺀 나머지", () => {
  assert.equal(subjectDetail("KOR FIC > GEN SS"), "GEN SS");
  assert.equal(subjectDetail("Economics > Investing > Stocks/ETF"), "Investing > Stocks/ETF");
  assert.equal(subjectDetail("FIC - GEN SS"), "GEN SS");
  assert.equal(subjectDetail("KOR > Learning English > English Writing"), "English Writing");
  assert.equal(subjectDetail("KOR Essays"), "", "구분자가 없으면 세부 분류도 없음");
  assert.equal(subjectDetail(""), "");
});

test("큰 분류 + 세부 분류로 원래 값을 되짚을 수 있다", () => {
  for (const s of [
    "KOR FIC > GEN SS",
    "Economics > Investing > Stocks/ETF",
    "KOR > Learning English > English Writing",
    "KOR Essays",
  ]) {
    const joined = [subjectGroup(s), subjectDetail(s)].filter(Boolean).join(" > ");
    assert.equal(joined.replace(/\s+/g, " "), s.replace(/\s*>\s*/g, " > "));
  }
});

test("SQL 조건이 이름만 비슷한 분류를 잡지 않는다", () => {
  const p = subjectGroupPatterns("FIC");
  assert.equal(p.exact, "FIC");
  assert.equal(p.gt, "FIC >%");
  assert.equal(p.dash, "FIC -%");

  // LIKE 패턴을 흉내내서 확인 (% 는 뒤에 아무거나)
  const matches = (subject) =>
    subject === p.exact || subject.startsWith("FIC >") || subject.startsWith("FIC -");
  assert.ok(matches("FIC"));
  assert.ok(matches("FIC > CLASSICS"));
  assert.ok(matches("FIC - GEN SS"));
  assert.ok(!matches("FICTION > GEN"), "FICTION 은 FIC 가 아님");
  assert.ok(!matches("KOR FIC > GEN"), "KOR FIC 은 별도 분류");
});
