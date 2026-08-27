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

// ─── 표시용 포맷 ───
export const fmtInt = (n: number | null | undefined) =>
  n == null ? "" : n.toLocaleString("ko-KR");

export function fmtDateTime(value: Date | string): string {
  const d = typeof value === "string" ? new Date(value) : value;
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
