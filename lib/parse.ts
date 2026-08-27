/**
 * 엑셀에서 복사한 텍스트를 도서 데이터로 바꾸는 순수 함수 모음.
 * 클라이언트(미리보기)와 서버(실제 반영)가 같은 코드를 쓰기 위해 DOM 의존이 없습니다.
 */

// ─────────────────────────────────────────────────────────────
// 필드 정의
// ─────────────────────────────────────────────────────────────
export const FIELDS = [
  { key: "", label: "— 사용 안 함" },
  { key: "isbn", label: "ISBN" },
  { key: "title", label: "도서명" },
  { key: "author", label: "저자" },
  { key: "publisher", label: "출판사" },
  { key: "pubDate", label: "출간(YYYYMM)" },
  { key: "subject", label: "Subject 분류" },
  { key: "krw", label: "정가(₩)" },
  { key: "cad", label: "판매가(CAD)" },
  { key: "weight", label: "무게(g)" },
  { key: "qty", label: "수량" },
  { key: "location", label: "위치/서가" },
  { key: "memo", label: "메모" },
] as const;

export type FieldKey = (typeof FIELDS)[number]["key"];

export type ParsedRow = {
  isbn?: string;
  title?: string;
  author?: string;
  publisher?: string;
  pubDate?: string;
  subject?: string;
  krw?: number;
  cad?: number;
  weight?: number;
  qty?: number;
  location?: string;
  memo?: string;
};

const NUMERIC_FIELDS = new Set(["krw", "cad", "weight", "qty"]);

// ─────────────────────────────────────────────────────────────
// 기본 제공 양식
// ─────────────────────────────────────────────────────────────
export type Preset = { name: string; mapping: string[] | null };

export const BUILTIN_PRESETS: Record<string, Preset> = {
  auto: { name: "자동 감지", mapping: null },
  shipping: {
    name: "선박 양식",
    // TOTAL │ ISBN │ 제목 │ Unit Price │ 15% DC │ After DC │ Copies │ Amount │
    // Author │ Pub.Date │ (빈칸) │ Publisher │ Subject │ TOTAL │ KRW │ Weight
    mapping: [
      "qty", "isbn", "title", "cad", "", "", "", "",
      "author", "pubDate", "", "publisher", "subject", "", "krw", "weight",
    ],
  },
  sales: {
    name: "SALES 양식",
    // 캐나다가격 │ (빈칸) │ Title │ Publisher │ Author │ Copies │ KRW │ Weight
    mapping: ["cad", "", "title", "publisher", "author", "qty", "krw", "weight"],
  },
};

// ─────────────────────────────────────────────────────────────
// 값 정규화
// ─────────────────────────────────────────────────────────────
export function normIsbn(s: string | null | undefined): string {
  return String(s ?? "").toUpperCase().replace(/[^0-9X]/g, "");
}

export function isValidIsbn(s: string | null | undefined): boolean {
  const n = normIsbn(s);
  return n.length === 10 || n.length === 13;
}

/** "$34.50" · "($5.18)" · "15,000" → 숫자. 괄호(회계식 음수)는 절댓값으로 봅니다. */
export function toNumber(v: unknown): number | null {
  if (v == null) return null;
  const s = String(v).replace(/[^\d.\-]/g, "");
  if (!s || s === "-" || s === ".") return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * 같은 책인지 판단하는 키.
 * ISBN 이 있으면 ISBN 기준, 없으면(선박 엑셀의 "판매용" 등) 도서명+저자 기준.
 */
export function makeMatchKey(item: { isbn?: string | null; title?: string | null; author?: string | null }): string {
  const isbn = normIsbn(item.isbn);
  if (isbn.length >= 10) return "i:" + isbn;
  const norm = (s: string | null | undefined) => String(s ?? "").replace(/\s+/g, "").toLowerCase();
  return "t:" + norm(item.title) + "|" + norm(item.author);
}

// ─────────────────────────────────────────────────────────────
// 텍스트 → 2차원 배열
// ─────────────────────────────────────────────────────────────
export type Delimiter = "auto" | "tab" | "spaces" | "comma";

export function splitRows(text: string, mode: Delimiter = "auto"): { rows: string[][]; delim: Exclude<Delimiter, "auto"> } {
  const lines = text.replace(/\r/g, "").split("\n").filter((l) => l.trim() !== "");
  if (!lines.length) return { rows: [], delim: "tab" };

  let delim: Exclude<Delimiter, "auto">;
  if (mode === "auto") {
    // 엑셀에서 복사하면 항상 탭입니다. 탭이 없을 때만 다른 구분자를 추측합니다.
    if (lines.some((l) => l.includes("\t"))) delim = "tab";
    else if (lines.some((l) => /\S {2,}\S/.test(l))) delim = "spaces";
    else if (lines.some((l) => l.includes(","))) delim = "comma";
    else delim = "tab";
  } else {
    delim = mode;
  }

  const split =
    delim === "tab"
      ? (l: string) => l.split("\t")
      : delim === "spaces"
        ? (l: string) => l.split(/ {2,}/)
        : (l: string) => l.split(",");

  const rows = lines.map((l) => split(l).map((c) => c.trim()));
  const width = Math.max(...rows.map((r) => r.length));
  for (const r of rows) while (r.length < width) r.push("");
  return { rows, delim };
}

const HEADER_WORDS = [
  "total", "isbn", "title", "author", "publisher", "subject", "krw", "copies",
  "amount", "unit price", "after dc", "dc", "pub.date", "pubdate", "series", "price",
  "도서명", "제목", "저자", "출판사", "정가", "수량", "무게", "분류", "출간", "위치",
];

/** 머리글 행이면 true (알려진 머리글 단어가 2개 이상) */
export function isHeaderRow(row: string[]): boolean {
  const hits = row.filter((c) => {
    const v = c.trim().toLowerCase();
    return v.length > 0 && HEADER_WORDS.some((w) => v === w || v.startsWith(w));
  }).length;
  return hits >= 2;
}

// ─────────────────────────────────────────────────────────────
// 열 자동 감지
// ─────────────────────────────────────────────────────────────
export function guessMapping(rows: string[][]): string[] {
  const dataRows = rows.filter((r) => !isHeaderRow(r)).slice(0, 30);
  const width = rows.length ? Math.max(...rows.map((r) => r.length)) : 0;
  const mapping: string[] = new Array(width).fill("");
  const used = new Set<string>();

  const take = (col: number, field: string) => {
    if (col < 0 || used.has(field) || mapping[col]) return;
    mapping[col] = field;
    used.add(field);
  };

  const stats = Array.from({ length: width }, (_, c) => {
    const vals = dataRows.map((r) => (r[c] ?? "").trim()).filter(Boolean);
    const ratio = (fn: (v: string) => boolean) => (vals.length ? vals.filter(fn).length / vals.length : 0);
    const nums = vals.map(toNumber).filter((n): n is number => n != null);
    return {
      col: c,
      empty: vals.length === 0,
      isbn: ratio((v) => /^[\d-]+$/.test(v) && isValidIsbn(v)),
      ym: ratio((v) => /^(19|20)\d{2}(0[1-9]|1[0-2])$/.test(v)),
      money: ratio((v) => /^\(?-?\$/.test(v)),
      numeric: ratio((v) => /^\(?-?[\d,]+(\.\d+)?\)?$/.test(v)),
      avg: nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0,
      subject: ratio((v) => v.includes(">")),
      author: ratio((v) => /(글|그림|역|저|지음|옮김|원저|감수)\s*$/.test(v) || v.includes("/")),
      textish: ratio((v) => /[^\d,.$()\-\s]/.test(v)),
      avgLen: vals.length ? vals.reduce((a, b) => a + b.length, 0) / vals.length : 0,
    };
  });

  /** 아직 배정되지 않은 열 중 점수가 가장 높은 열 */
  const pickBest = (score: (s: (typeof stats)[number]) => number, min: number) => {
    let best = -1;
    let bestVal = min;
    for (const s of stats) {
      if (s.empty || mapping[s.col]) continue;
      const v = score(s);
      if (v > bestVal) {
        bestVal = v;
        best = s.col;
      }
    }
    return best;
  };

  // 특징이 뚜렷한 것부터 먼저 확정합니다.
  take(pickBest((s) => s.isbn, 0.5), "isbn");
  take(pickBest((s) => s.ym, 0.5), "pubDate");
  take(pickBest((s) => s.subject, 0.5), "subject");
  take(pickBest((s) => s.author, 0.5), "author");

  // $ 열이 여러 개(Unit Price / DC / After DC / Amount)면 가장 왼쪽 = 판매가
  const money = stats.find((s) => !s.empty && !mapping[s.col] && s.money > 0.5);
  if (money) take(money.col, "cad");

  // 남은 글자 열 중 평균 길이가 가장 긴 것 = 도서명, 그다음 = 출판사
  take(pickBest((s) => (s.textish > 0.6 ? s.avgLen : 0), 0), "title");
  take(pickBest((s) => (s.textish > 0.6 ? 1 : 0), 0), "publisher");

  // 숫자 열: 값이 크면 정가(₩), 중간이면 무게(g), 작으면 수량
  take(pickBest((s) => (s.numeric > 0.6 && s.avg >= 3000 ? s.avg : 0), 0), "krw");
  take(pickBest((s) => (s.numeric > 0.6 && s.avg >= 20 && s.avg < 3000 ? 1 : 0), 0), "weight");
  const qty = stats.find((s) => !s.empty && !mapping[s.col] && s.numeric > 0.6 && s.avg < 500);
  if (qty) take(qty.col, "qty");

  return mapping;
}

// ─────────────────────────────────────────────────────────────
// 행 → 도서 객체
// ─────────────────────────────────────────────────────────────
export function rowToItem(row: string[], mapping: string[]): ParsedRow {
  const out: Record<string, string | number> = {};
  mapping.forEach((field, i) => {
    if (!field) return;
    const raw = (row[i] ?? "").trim();
    if (!raw) return;
    if (NUMERIC_FIELDS.has(field)) {
      const n = toNumber(raw);
      if (n == null) return;
      out[field] = field === "cad" ? Math.abs(n) : Math.round(Math.abs(n));
    } else {
      out[field] = raw;
    }
  });
  return out as ParsedRow;
}

// ─────────────────────────────────────────────────────────────
// 반영 계획 (미리보기 + 서버 검증에 동일하게 사용)
// ─────────────────────────────────────────────────────────────
export type PlanStatus = "new" | "update" | "header" | "empty" | "noTitle";
export type PlanEntry = { idx: number; status: PlanStatus; item?: ParsedRow; matchKey?: string };

/**
 * @param existingKeys 이미 재고에 있는 matchKey 집합
 */
export function buildPlan(rows: string[][], mapping: string[], existingKeys: Set<string>): PlanEntry[] {
  return rows.map((row, idx) => {
    if (isHeaderRow(row)) return { idx, status: "header" as const };
    const item = rowToItem(row, mapping);
    if (!item.title && !item.isbn) return { idx, status: "empty" as const };
    if (!item.title) return { idx, status: "noTitle" as const, item };
    const matchKey = makeMatchKey(item);
    return {
      idx,
      status: existingKeys.has(matchKey) ? ("update" as const) : ("new" as const),
      item,
      matchKey,
    };
  });
}
