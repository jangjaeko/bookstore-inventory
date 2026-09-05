/**
 * 서버의 Book(Date 포함)과 클라이언트의 JSON 응답(날짜가 문자열) 양쪽에서
 * 그대로 쓸 수 있도록, 날짜를 뺀 구조적 타입만 요구합니다.
 */
export type BookLike = {
  isbn: string;
  title: string;
  author: string;
  publisher: string;
  pubDate: string;
  subject: string;
  krw: number | null;
  cad: number | null;
  weight: number | null;
  qty: number;
  location: string;
  memo: string;
};

/** 엑셀 셀 하나로 들어갈 값 */
type Cell = string | number | null | undefined;

const cad = (v: number | null) => (v == null ? "" : v.toFixed(2));
const row = (cells: Cell[]) => cells.map((c) => (c == null ? "" : String(c))).join("\t");

/**
 * 선박 엑셀 양식 한 줄. Chrome 확장(Case 2)과 컬럼 순서가 같습니다.
 *
 * ISBN │ 제목 │ CAD │ 빈칸 │ 빈칸 │ 수량 │ 빈칸 │ Author │ Pub.Date │ 빈칸 │ Publisher │ Subject │ 수량 │ KRW │ Weight
 *
 * 엑셀의 B열부터 붙여넣으면 A열(TOTAL)만 비고 나머지가 정확히 맞습니다.
 * 확장에서 Copies 가 늘 1이던 두 자리에 실제 재고 수량이 들어갑니다.
 */
export function buildShippingRow(b: BookLike): string {
  return row([
    b.isbn, b.title, cad(b.cad), "", "", b.qty, "",
    b.author, b.pubDate, "", b.publisher, b.subject,
    b.qty, b.krw, b.weight,
  ]);
}

/**
 * SALES 양식 한 줄 (확장 Case 1과 동일).
 * CAD │ 빈칸 │ Title │ Publisher │ Author │ 수량 │ KRW │ Weight
 */
export function buildSalesRow(b: BookLike): string {
  return row([cad(b.cad), "", b.title, b.publisher, b.author, b.qty, b.krw, b.weight]);
}

/**
 * LBI 양식 (확장 Case 3과 동일). 책 1권이 2줄을 씁니다.
 */
export function buildLbiRows(b: BookLike): string {
  const line1 = row([b.isbn, "", cad(b.cad), "", "", b.qty, "", "", b.pubDate, "", "", b.subject]);
  const line2 = row(["", b.title, "", "", "", "", "", b.author, "", "", b.publisher, ""]);
  return line1 + "\n" + line2;
}

export const COPY_FORMATS = {
  shipping: { label: "선박 양식", build: buildShippingRow, multiline: false },
  sales: { label: "SALES 양식", build: buildSalesRow, multiline: false },
  lbi: { label: "LBI 양식 (2줄)", build: buildLbiRows, multiline: true },
} as const;

export type CopyFormatKey = keyof typeof COPY_FORMATS;

/** 엑셀에서 한글이 깨지지 않도록 BOM을 붙인 CSV */
export function buildCsv(books: BookLike[]): string {
  const head = ["ISBN", "도서명", "저자", "출판사", "출간", "Subject", "정가(KRW)", "CAD", "무게(g)", "수량", "위치", "메모"];
  const esc = (v: Cell) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [head.map(esc).join(",")];
  for (const b of books) {
    lines.push(
      [b.isbn, b.title, b.author, b.publisher, b.pubDate, b.subject, b.krw, b.cad, b.weight, b.qty, b.location, b.memo]
        .map(esc)
        .join(","),
    );
  }
  return "﻿" + lines.join("\r\n");
}

// ─────────────────────────────────────────────────────────────
// Subject 분류 묶기
// ─────────────────────────────────────────────────────────────

/**
 * 첫 조각만 떼면 의미가 없어 한 단계 더 들어가야 하는 뿌리 분류들.
 * 예: "KOR > Learning English > ..." 에서 "KOR" 은 절반 이상의 책에 붙어 있어
 *     걸러내는 의미가 없습니다. "KOR > Learning English" 여야 쓸모가 있습니다.
 */
const BROAD_ROOTS = new Set(["kor", "국내도서", "해외도서", "외국도서"]);

/** Subject 를 나누는 구분자: " > " 또는 " - " (Self-Help 처럼 붙어 있는 하이픈은 제외) */
const SUBJECT_SPLIT = /\s*>\s*|\s+-\s+/;

/**
 * Subject 를 "보기" 기준으로 쓸 큰 분류로 자릅니다.
 *
 *   "KOR FIC > GEN SS"                  → "KOR FIC"
 *   "FIC - GEN SS"                      → "FIC"
 *   "KOR Essays"                        → "KOR Essays"   (구분자 없으면 통째로)
 *   "KOR > Learning English > Writing"  → "KOR > Learning English"
 *   "국내도서 > 어린이 > 1-2학년 > …"      → "국내도서 > 어린이"
 */
export function subjectGroup(subject: string | null | undefined): string {
  const parts = String(subject ?? "")
    .split(SUBJECT_SPLIT)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.length) return "";
  if (parts.length > 1 && BROAD_ROOTS.has(parts[0].toLowerCase())) {
    return `${parts[0]} > ${parts[1]}`;
  }
  return parts[0];
}

/** 큰 분류를 뺀 나머지 세부 분류. "KOR FIC > GEN SS" → "GEN SS" */
export function subjectDetail(subject: string | null | undefined): string {
  const full = String(subject ?? "").trim();
  const group = subjectGroup(full);
  if (!group || full === group) return "";
  return full.slice(group.length).replace(/^\s*(>|-)\s*/, "").trim();
}

/**
 * 큰 분류에 속하는 Subject 를 SQL 로 찾기 위한 조건.
 * 정확히 같거나, 뒤에 구분자가 이어지는 것만 고릅니다.
 * (단순 접두어 검색이면 "FIC" 가 "FICTION" 까지 잡아 버립니다)
 */
export function subjectGroupPatterns(group: string): { exact: string; gt: string; dash: string } {
  return { exact: group, gt: `${group} >%`, dash: `${group} -%` };
}

// ─── 표시용 포맷 ───
export const fmtInt = (n: number | null | undefined) =>
  n == null ? "" : n.toLocaleString("ko-KR");

export function fmtDateTime(value: Date | string): string {
  const d = typeof value === "string" ? new Date(value) : value;
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
