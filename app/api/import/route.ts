import { NextResponse } from "next/server";
import { inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { books, stockLogs, type NewBook } from "@/lib/schema";
import { buildPlan, makeMatchKey } from "@/lib/parse";
import { fail, handleError, str } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** 한 번에 보내는 INSERT 의 최대 행 수 */
const CHUNK = 400;

/** 입고: 수량을 더하거나(add) 덮어쓰거나(replace) 그대로 둠(skip) */
type InMode = "add" | "replace" | "skip";
/** in = 매입/입고(재고 증가), out = 납품/판매(재고 감소) */
type Direction = "in" | "out";
/** 이미 있는 책의 서지정보를 어디까지 새 값으로 바꿀지 */
type MetaMode = "all" | "safe" | "none";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const rows: string[][] = Array.isArray(body.rows) ? body.rows : [];
    const mapping: string[] = Array.isArray(body.mapping) ? body.mapping : [];
    const direction: Direction = body.direction === "out" ? "out" : "in";
    const mode: InMode = ["add", "replace", "skip"].includes(body.mode) ? body.mode : "add";
    // all  = 서지정보 전부 갱신
    // safe = 가격·분류·출간일만 갱신 (제목·저자·출판사는 그대로 둠)
    // none = 갱신 안 함
    const metaMode: MetaMode = ["all", "safe", "none"].includes(body.metaMode)
      ? body.metaMode
      : body.updateMeta === true // 예전 방식 호환
        ? "all"
        : "none";
    const multiRow = body.multiRow === true;
    // 이력에 남길 사유. 예: "BPL 납품 2026-08"
    const reason = (str(body.reason) || "").slice(0, 80);

    if (!rows.length) return fail("반영할 행이 없습니다.");
    if (!mapping.includes("title")) return fail("'도서명' 열이 지정되지 않았습니다.");
    if (rows.length > 5000) return fail("한 번에 5000행까지만 반영할 수 있습니다. 나눠서 붙여넣어 주세요.");

    // 1) 각 행을 도서 객체로. 머리글·빈 행·도서명 없는 행(구역 제목, 합계 등)을 걸러냅니다.
    const plan = buildPlan(rows, mapping, new Set(), { multiRow });
    const usable = plan.filter((p) => p.status === "new" || p.status === "update");
    // "merged" 는 윗줄에 합쳐진 줄이라 버려진 게 아닙니다. 제외 개수에서 빼 줍니다.
    const skippedRows = plan.filter(
      (p) => p.status === "header" || p.status === "empty" || p.status === "noTitle",
    ).length;
    if (!usable.length) return fail("반영할 수 있는 행이 없습니다. 열 지정을 확인해 주세요.");

    // 2) 붙여넣은 안에서 같은 책이 여러 번 나오면 미리 합칩니다.
    //    (Postgres 는 하나의 INSERT 에서 같은 행을 두 번 UPSERT 하지 못합니다.)
    const merged = new Map<string, NewBook>();
    for (const p of usable) {
      const it = p.item!;
      const matchKey = makeMatchKey(it);
      const qty = it.qty ?? 1;
      const prev = merged.get(matchKey);
      if (prev) {
        // 나중 행의 값이 이기되, 수량은 합칩니다(덮어쓰기 모드 제외).
        merged.set(matchKey, {
          ...prev,
          isbn: it.isbn || prev.isbn,
          title: it.title || prev.title,
          author: it.author || prev.author,
          publisher: it.publisher || prev.publisher,
          pubDate: it.pubDate || prev.pubDate,
          subject: it.subject || prev.subject,
          location: it.location || prev.location,
          memo: it.memo || prev.memo,
          krw: it.krw ?? prev.krw,
          cad: it.cad ?? prev.cad,
          weight: it.weight ?? prev.weight,
          qty: direction === "in" && mode === "replace" ? qty : prev.qty! + qty,
        });
      } else {
        merged.set(matchKey, {
          matchKey,
          isbn: it.isbn ?? "",
          title: it.title!,
          author: it.author ?? "",
          publisher: it.publisher ?? "",
          pubDate: it.pubDate ?? "",
          subject: it.subject ?? "",
          location: it.location ?? "",
          memo: it.memo ?? "",
          krw: it.krw ?? null,
          cad: it.cad ?? null,
          weight: it.weight ?? null,
          qty: Math.max(0, qty),
        });
      }
    }
    const values = [...merged.values()];
    const keys = [...merged.keys()];

    // 3) 반영 전 상태를 읽어 둡니다 (이력의 변화량 계산, 출고 시 재고 부족 판정).
    const beforeRows = await db
      .select({ matchKey: books.matchKey, qty: books.qty, title: books.title })
      .from(books)
      .where(inArray(books.matchKey, keys));
    const before = new Map(beforeRows.map((b) => [b.matchKey, b]));

    const result =
      direction === "out"
        ? await applyOutbound(values, before, metaMode, reason)
        : await applyInbound(values, before, mode, metaMode, reason);

    return NextResponse.json({
      ok: true,
      direction,
      ...result,
      // 머리글·구역 제목·합계 등 도서가 아닌 행
      skippedRows,
      duplicatesMerged: usable.length - values.length,
    });
  } catch (err) {
    return handleError(err);
  }
}

// ─────────────────────────────────────────────────────────────
// 입고 (매입) — 없으면 새로 만들고, 있으면 mode 대로 수량 반영
// ─────────────────────────────────────────────────────────────
/**
 * 이미 있는 책에 새 값을 덮어쓸 컬럼들.
 * 새로 들어온 값이 비어 있지 않으면 **새 값이 이깁니다** (coalesce 로 빈 값만 걸러냄).
 *
 * safe 는 제목·저자·출판사를 건드리지 않습니다. 납품 인보이스에는 로마자 표기나
 * "Qty. increased upon request" 같은 메모가 그 자리에 들어 있을 수 있어서,
 * 가격·분류만 최신으로 맞추고 한글 서지정보는 지키기 위해서입니다.
 */
function metaFields(mode: MetaMode) {
  if (mode === "none") return {};
  const shared = {
    pubDate: sql`coalesce(nullif(excluded.pub_date, ''), ${books.pubDate})`,
    subject: sql`coalesce(nullif(excluded.subject, ''), ${books.subject})`,
    krw: sql`coalesce(excluded.krw, ${books.krw})`,
    cad: sql`coalesce(excluded.cad, ${books.cad})`,
    weight: sql`coalesce(excluded.weight, ${books.weight})`,
  };
  if (mode === "safe") return shared;
  return {
    ...shared,
    isbn: sql`coalesce(nullif(excluded.isbn, ''), ${books.isbn})`,
    title: sql`coalesce(nullif(excluded.title, ''), ${books.title})`,
    author: sql`coalesce(nullif(excluded.author, ''), ${books.author})`,
    publisher: sql`coalesce(nullif(excluded.publisher, ''), ${books.publisher})`,
    location: sql`coalesce(nullif(excluded.location, ''), ${books.location})`,
    memo: sql`coalesce(nullif(excluded.memo, ''), ${books.memo})`,
  };
}

async function applyInbound(
  values: NewBook[],
  before: Map<string, { qty: number }>,
  mode: InMode,
  metaMode: MetaMode,
  reason: string,
) {
  const metaSet = metaFields(metaMode);

  const saved: { id: number; matchKey: string; qty: number }[] = [];
  for (let i = 0; i < values.length; i += CHUNK) {
    const chunk = values.slice(i, i + CHUNK);
    const insert = db.insert(books).values(chunk);
    const returned =
      mode === "skip"
        ? await insert
            .onConflictDoNothing({ target: books.matchKey })
            .returning({ id: books.id, matchKey: books.matchKey, qty: books.qty })
        : await insert
            .onConflictDoUpdate({
              target: books.matchKey,
              set: {
                ...metaSet,
                qty: mode === "replace" ? sql`excluded.qty` : sql`${books.qty} + excluded.qty`,
                updatedAt: sql`now()`,
              },
            })
            .returning({ id: books.id, matchKey: books.matchKey, qty: books.qty });
    saved.push(...returned);
  }

  await writeLogs(
    saved.map((s) => {
      const prev = before.get(s.matchKey);
      return {
        bookId: s.id,
        delta: s.qty - (prev?.qty ?? 0),
        qtyAfter: s.qty,
        reason: reason || (prev === undefined ? "엑셀 등록" : mode === "replace" ? "엑셀 덮어쓰기" : "엑셀 입고"),
      };
    }),
  );

  const created = saved.filter((s) => !before.has(s.matchKey)).length;
  return {
    created,
    updated: saved.length - created,
    // skip 모드에서 이미 있어 건너뛴 도서
    skippedExisting: values.length - saved.length,
    missing: [] as string[],
    shortfall: [] as { title: string; had: number; needed: number }[],
  };
}

// ─────────────────────────────────────────────────────────────
// 출고 (납품/판매) — 재고에 있는 책만 수량을 뺍니다.
//   · 재고에 없는 책은 만들지 않고 목록으로 알려줍니다 (매입 기록 누락 신호).
//   · 재고보다 많이 나가면 0 에서 멈추고 부족분을 알려줍니다.
// ─────────────────────────────────────────────────────────────
async function applyOutbound(
  values: NewBook[],
  before: Map<string, { qty: number; title: string }>,
  metaMode: MetaMode,
  reason: string,
) {
  const missing: string[] = [];
  const shortfall: { title: string; had: number; needed: number }[] = [];
  const changing: NewBook[] = [];
  let zeroQty = 0;

  for (const v of values) {
    // Copies 0 = 주문했지만 나가지 않은 줄. 아무 일도 하지 않고 경고도 띄우지 않습니다.
    if (!v.qty) {
      zeroQty++;
      continue;
    }
    const prev = before.get(v.matchKey);
    if (!prev) {
      missing.push(v.title);
      continue;
    }
    if (prev.qty < v.qty) shortfall.push({ title: prev.title, had: prev.qty, needed: v.qty });
    // 이미 0권이면 뺄 것이 없습니다 (부족 목록에는 위에서 이미 올렸습니다).
    if (prev.qty > 0) changing.push(v);
  }

  const saved: { id: number; matchKey: string; qty: number }[] = [];
  for (let i = 0; i < changing.length; i += CHUNK) {
    const chunk = changing.slice(i, i + CHUNK);
    // 대상이 전부 이미 존재하는 행이므로 UPSERT 는 항상 UPDATE 로 떨어집니다.
    // excluded.qty 에 "나간 수량"이 담기고, 그만큼 재고에서 뺍니다 (0 밑으로는 안 감).
    const returned = await db
      .insert(books)
      .values(chunk)
      .onConflictDoUpdate({
        target: books.matchKey,
        set: {
          ...metaFields(metaMode),
          qty: sql`greatest(0, ${books.qty} - excluded.qty)`,
          updatedAt: sql`now()`,
        },
      })
      .returning({ id: books.id, matchKey: books.matchKey, qty: books.qty });
    saved.push(...returned);
  }

  await writeLogs(
    saved
      .map((s) => ({
        bookId: s.id,
        delta: s.qty - (before.get(s.matchKey)?.qty ?? 0),
        qtyAfter: s.qty,
        reason: reason || "엑셀 출고",
      }))
      .filter((l) => l.delta !== 0),
  );

  return {
    created: 0,
    updated: saved.length,
    skippedExisting: 0,
    zeroQty,
    missing,
    shortfall,
  };
}

async function writeLogs(logs: { bookId: number; delta: number; qtyAfter: number; reason: string }[]) {
  const rows = logs.filter((l) => l.delta !== 0);
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db.insert(stockLogs).values(rows.slice(i, i + CHUNK));
  }
}
