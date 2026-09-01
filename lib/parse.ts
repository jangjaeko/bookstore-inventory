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
export type Preset = {
  name: string;
  mapping: string[] | null;
  /** 이 문서가 매입(in)인지 납품·판매(out)인지. 양식을 고르면 방향이 따라옵니다. */
  direction?: "in" | "out";
  /** 한 권이 두 줄에 걸쳐 있는 양식인지 (LBI 인보이스) */
  multiRow?: boolean;
};

export const BUILTIN_PRESETS: Record<string, Preset> = {
  auto: { name: "자동 감지", mapping: null },
  shipping: {
    name: "선박 양식 · 16열 (A열 TOTAL 포함)",
    // TOTAL │ ISBN │ 제목 │ Unit Price │ 15% DC │ After DC │ Copies │ Amount │
    // Author │ Pub.Date │ (빈칸) │ Publisher │ Subject │ TOTAL │ KRW │ Weight
    mapping: [
      "qty", "isbn", "title", "cad", "", "", "", "",
      "author", "pubDate", "", "publisher", "subject", "", "krw", "weight",
    ],
  },
  shipping15: {
    name: "선박 양식 · 15열 (ISBN부터)",
    // 위 양식에서 맨 앞 TOTAL 열이 빠진 형태. Chrome 확장이 복사해 주는 그대로입니다.
    // ISBN │ 제목 │ Unit Price │ 15% DC │ After DC │ Copies │ Amount │
    // Author │ Pub.Date │ (빈칸) │ Publisher │ Subject │ TOTAL │ KRW │ Weight
    //
    // 수량은 Copies(6열, 늘 1)가 아니라 TOTAL(13열)에서 가져옵니다.
    mapping: [
      "isbn", "title", "cad", "", "", "", "",
      "author", "pubDate", "", "publisher", "subject", "qty", "krw", "weight",
    ],
  },
  sales: {
    name: "SALES 양식",
    // 캐나다가격 │ (빈칸) │ Title │ Publisher │ Author │ Copies │ KRW │ Weight
    mapping: ["cad", "", "title", "publisher", "author", "qty", "krw", "weight"],
  },
  bpl: {
    name: "BPL 인보이스 (납품)",
    // ISBN │ Title(로마자) │ Title. Kor │ Other Title │ Unit Price │ 15% Discount │
    // Net Price │ Author(로마자) │ Author. Kor │ Pub.City │ Pub.City. Kor │
    // Publisher(로마자) │ Publisher. Kor │ Pub. Date │ Subject │ Copies │ Amount
    //
    // 로마자 열은 쓰지 않고 한글 열만 씁니다 (재고에 쌓인 YES24 서지정보와 맞추기 위해).
    mapping: [
      "isbn", "", "title", "", "cad", "", "", "",
      "author", "", "", "", "publisher", "pubDate", "subject", "qty", "",
    ],
    direction: "out",
  },
  lbi: {
    name: "LBI 인보이스 (납품, 2줄)",
    // NO │ ISBN │ Title │ Unit Price │ 15% Discount │ Net Price │ Copies │ Amount │ Author │ Pub. Date
    //
    // 한 권이 두 줄입니다.
    //   윗줄: 번호 · ISBN · 로마자 제목 · 금액 · 권수 · 로마자 저자 · 출간
    //   아랫줄: 한글 제목(Title 열) · 한글 저자(Author 열)
    // 아랫줄 값이 윗줄을 덮어써서 결국 한글 제목·저자가 남습니다.
    mapping: ["", "isbn", "title", "cad", "", "", "qty", "", "author", "pubDate"],
    direction: "out",
    multiRow: true,
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

  const rows = lines.map((l) => split(l).map(unquote));
  const width = Math.max(...rows.map((r) => r.length));
  for (const r of rows) while (r.length < width) r.push("");
  return { rows, delim };
}

/**
 * 엑셀은 앞뒤 공백이나 특수문자가 든 셀을 큰따옴표로 감싸서 복사합니다.
 * 예: BPL 인보이스의 ISBN 이 `"    9791174760548"` 로 들어옴.
 * 따옴표를 벗기고 안쪽의 `""` 이스케이프도 풀어 줍니다.
 */
function unquote(cell: string): string {
  const t = cell.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    return t.slice(1, -1).replace(/""/g, '"').trim();
  }
  return t;
}

const HEADER_WORDS = [
  "total", "isbn", "title", "author", "publisher", "subject", "krw", "copies",
  "amount", "unit price", "net price", "after dc", "discount", "dc", "pub.date",
  "pub. date", "pubdate", "series", "price", "other title", "pub.city", "pub. city",
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

/** 중앙값. 값이 없으면 0. */
function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
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
      /**
       * 대푯값은 평균이 아니라 중앙값을 씁니다.
       * 인보이스 맨 아래 합계 행("414" 같은 값)이 한 줄만 섞여도 평균은 크게 흔들려서
       * 수량 열을 무게 열로 오인하게 됩니다. 중앙값은 그런 이상치에 끄떡없습니다.
       */
      median: median(nums),
      subject: ratio((v) => v.includes(">")),
      author: ratio((v) => /(글|그림|역|저|지음|옮김|원저|감수|편저|공편)\s*$/.test(v)),
      textish: ratio((v) => /[^\d,.$()\-\s]/.test(v)),
      /** 한글이 들어 있는 비율. BPL 인보이스처럼 로마자·한글 열이 쌍으로 있을 때 한글 쪽을 고르는 데 씁니다. */
      hangul: ratio((v) => /[가-힣]/.test(v)),
      /** 글자 길이의 중앙값. 도서명(길다)과 출판사·도시(짧다)를 가르는 데 씁니다. */
      medianLen: median(vals.map((v) => v.length)),
      /** 서로 다른 값의 비율. 출판사(다양함)와 도시(몇 개 안 됨)를 가르는 데 씁니다. */
      distinct: vals.length ? new Set(vals).size / vals.length : 0,
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

  /**
   * 글자 열을 고를 때, 한글이 든 열이 하나라도 있으면 그중에서만 고릅니다.
   * BPL 인보이스는 로마자/한글 열이 쌍으로 있는데 재고는 한글로 쌓여 있어서
   * 항상 한글 쪽을 골라야 같은 책으로 이어집니다.
   */
  const pickText = (score: (s: (typeof stats)[number]) => number) => {
    const isText = (s: (typeof stats)[number]) => !s.empty && !mapping[s.col] && s.textish > 0.6;
    const hasHangul = stats.some((s) => isText(s) && s.hangul > 0.5);
    return pickBest((s) => (isText(s) && (!hasHangul || s.hangul > 0.5) ? score(s) : 0), 0);
  };

  // 특징이 뚜렷한 것부터 먼저 확정합니다.
  take(pickBest((s) => s.isbn, 0.5), "isbn");
  take(pickBest((s) => s.ym, 0.5), "pubDate");
  take(pickBest((s) => s.subject, 0.5), "subject");
  take(pickText((s) => s.author), "author");

  // $ 열이 여러 개(Unit Price / DC / Net Price / Amount)면 가장 왼쪽 = 판매가
  const money = stats.find((s) => !s.empty && !mapping[s.col] && s.money > 0.5);
  if (money) take(money.col, "cad");

  // 도서명 = 남은 글자 열 중 가장 긴 것.
  take(pickText((s) => s.medianLen), "title");
  // 출판사 = 값이 가장 다양한 열. (도시 열은 "서울시"가 반복돼 다양성이 낮습니다.)
  take(pickText((s) => s.distinct), "publisher");

  // 숫자 열: 값이 크면 정가(₩), 중간이면 무게(g), 작으면 수량
  take(pickBest((s) => (s.numeric > 0.6 && s.median >= 3000 ? s.median : 0), 0), "krw");
  take(pickBest((s) => (s.numeric > 0.6 && s.median >= 20 && s.median < 3000 ? 1 : 0), 0), "weight");
  const qty = stats.find((s) => !s.empty && !mapping[s.col] && s.numeric > 0.6 && s.median < 500);
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
    } else if (field === "isbn") {
      // 엑셀에서 온 ISBN 은 안쪽에 공백이 섞여 있기도 합니다("979 11 3068 1887").
      // 정상 ISBN 이면 붙여서 저장하고, "판매용" 같은 값은 원문 그대로 둡니다.
      const compact = raw.replace(/\s+/g, "");
      out.isbn = /^[\dXx-]+$/.test(compact) && isValidIsbn(compact) ? compact : raw;
    } else {
      out[field] = raw;
    }
  });
  return out as ParsedRow;
}

// ─────────────────────────────────────────────────────────────
// 반영 계획 (미리보기 + 서버 검증에 동일하게 사용)
// ─────────────────────────────────────────────────────────────
export type PlanStatus =
  | "new" // 재고에 없던 책
  | "update" // 재고에 이미 있는 책
  | "merged" // 윗줄 도서에 합쳐진 이어지는 줄 (2줄 양식)
  | "header" // 머리글
  | "empty" // 도서명·ISBN 둘 다 없는 줄 (구역 제목, 합계, 예산 …)
  | "noTitle"; // ISBN 은 있는데 도서명이 없는 줄

export type PlanEntry = { idx: number; status: PlanStatus; item?: ParsedRow; matchKey?: string };

export type PlanOptions = {
  /**
   * 한 권이 여러 줄에 걸쳐 있는 양식(LBI 인보이스).
   * ISBN 이 있는 줄이 한 권의 시작이고, ISBN 없이 도서명만 있는 줄은 윗줄에 합칩니다.
   * 합칠 때 아랫줄의 값이 이깁니다 — LBI 는 아랫줄에 한글 제목·저자가 오기 때문입니다.
   */
  multiRow?: boolean;
};

/**
 * @param existingKeys 이미 재고에 있는 matchKey 집합
 */
export function buildPlan(
  rows: string[][],
  mapping: string[],
  existingKeys: Set<string>,
  options: PlanOptions = {},
): PlanEntry[] {
  const { multiRow = false } = options;
  const entries: PlanEntry[] = rows.map((_, idx) => ({ idx, status: "empty" }));

  // 현재 열려 있는(아직 아랫줄을 더 받을 수 있는) 도서
  let openIdx = -1;
  let openItem: ParsedRow | null = null;

  /** 열려 있던 도서를 확정해 결과에 적습니다. */
  const close = () => {
    if (openIdx < 0 || !openItem) return;
    if (!openItem.title) {
      entries[openIdx] = { idx: openIdx, status: "noTitle", item: openItem };
    } else {
      const matchKey = makeMatchKey(openItem);
      entries[openIdx] = {
        idx: openIdx,
        status: existingKeys.has(matchKey) ? "update" : "new",
        item: openItem,
        matchKey,
      };
    }
    openIdx = -1;
    openItem = null;
  };

  rows.forEach((row, idx) => {
    if (isHeaderRow(row)) {
      close();
      entries[idx] = { idx, status: "header" };
      return;
    }

    const item = rowToItem(row, mapping);

    // 이어지는 줄인가? — ISBN 이 없고, 도서명이 있고, 위에 열린 도서가 있을 때만.
    // (도서명을 요구하는 덕분에 예산·합계 줄이 앞 도서에 잘못 붙지 않습니다.)
    if (multiRow && openItem && item.title && !isValidIsbn(item.isbn)) {
      Object.assign(openItem, item); // 값이 있는 항목만 덮어씀 (rowToItem 이 빈 값은 뺍니다)
      entries[idx] = { idx, status: "merged" };
      return;
    }

    close();

    if (!item.title && !item.isbn) {
      entries[idx] = { idx, status: "empty" };
      return;
    }

    openIdx = idx;
    openItem = item;
    if (!multiRow) close(); // 한 줄 = 한 권인 양식은 바로 확정
  });

  close();
  return entries;
}
