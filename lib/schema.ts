import {
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * 재고 도서 1종 = 1행.
 *
 * matchKey 는 "같은 책인지" 판단하는 기준값이며 UNIQUE 입니다.
 *   - ISBN 이 있으면  "i:9791130681887"
 *   - 없으면(예: 선박 엑셀의 "판매용")  "t:도서명|저자"  (공백 제거 + 소문자)
 * 엑셀을 여러 번 붙여넣어도 같은 책이 중복 등록되지 않도록 이 컬럼으로 UPSERT 합니다.
 */
export const books = pgTable(
  "books",
  {
    id: serial("id").primaryKey(),
    matchKey: text("match_key").notNull().unique(),

    isbn: text("isbn").notNull().default(""),
    title: text("title").notNull(),
    author: text("author").notNull().default(""),
    publisher: text("publisher").notNull().default(""),
    /** YYYYMM 형식 문자열 (예: "202607"). 연·월만 쓰므로 date 타입을 쓰지 않습니다. */
    pubDate: text("pub_date").notNull().default(""),
    subject: text("subject").notNull().default(""),

    /** 한국 정가(원). 정수. */
    krw: integer("krw"),
    /** 캐나다 판매가. 0.5 단위라 부동소수점으로 충분합니다. */
    cad: doublePrecision("cad"),
    /** 무게(g). 선박비 계산용. */
    weight: integer("weight"),

    location: text("location").notNull().default(""),
    memo: text("memo").notNull().default(""),

    qty: integer("qty").notNull().default(0),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("books_title_idx").on(t.title),
    index("books_isbn_idx").on(t.isbn),
    index("books_updated_idx").on(t.updatedAt),
  ],
);

/** 입출고 이력. 수량이 바뀔 때마다 한 줄씩 쌓입니다. */
export const stockLogs = pgTable(
  "stock_logs",
  {
    id: serial("id").primaryKey(),
    bookId: integer("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    /** 변화량 (+입고 / -출고) */
    delta: integer("delta").notNull(),
    /** 변화 후 수량 */
    qtyAfter: integer("qty_after").notNull(),
    /** "엑셀 입고", "직접 수정", "일괄 출고" 등 */
    reason: text("reason").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("stock_logs_book_idx").on(t.bookId, t.createdAt)],
);

/**
 * 엑셀 붙여넣기 열 매핑 양식.
 * mapping 은 열 순서대로의 필드키 배열입니다. 예:
 *   ["qty","isbn","title","cad","","","","","author","pubDate","","publisher","subject","","krw","weight"]
 * 빈 문자열은 "사용 안 함".
 */
export const importPresets = pgTable("import_presets", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  mapping: jsonb("mapping").$type<string[]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Book = typeof books.$inferSelect;
export type NewBook = typeof books.$inferInsert;
export type StockLog = typeof stockLogs.$inferSelect;
export type ImportPreset = typeof importPresets.$inferSelect;
