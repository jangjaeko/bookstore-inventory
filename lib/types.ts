import type { Book, ImportPreset, StockLog } from "./schema";

/** API 응답(JSON)에서는 timestamp 가 ISO 문자열로 옵니다. */
type Jsonified<T> = { [K in keyof T]: T[K] extends Date ? string : T[K] };

export type BookDTO = Jsonified<Book>;
export type StockLogDTO = Jsonified<StockLog>;
export type ImportPresetDTO = Jsonified<ImportPreset>;

export type Totals = { titles: number; copies: number; low: number; zero: number };

export type SortKey = "updated" | "title" | "qtyDesc" | "qtyAsc" | "added";
export type FilterKey = "all" | "inStock" | "low" | "zero";
