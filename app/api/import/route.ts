import { NextResponse } from "next/server";
import { inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { books, stockLogs, type NewBook } from "@/lib/schema";
import { buildPlan, makeMatchKey } from "@/lib/parse";
import { fail, handleError } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** 한 번에 보내는 INSERT 의 최대 행 수 */
const CHUNK = 400;

type Mode = "add" | "replace" | "skip";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const rows: string[][] = Array.isArray(body.rows) ? body.rows : [];
    const mapping: string[] = Array.isArray(body.mapping) ? body.mapping : [];
    const mode: Mode = ["add", "replace", "skip"].includes(body.mode) ? body.mode : "add";
    const updateMeta = body.updateMeta !== false;

    if (!rows.length) return fail("반영할 행이 없습니다.");
    if (!mapping.includes("title")) return fail("'도서명' 열이 지정되지 않았습니다.");
    if (rows.length > 5000) return fail("한 번에 5000행까지만 반영할 수 있습니다. 나눠서 붙여넣어 주세요.");

    // 1) 각 행을 도서 객체로. 실제 매칭 여부는 아래에서 DB 를 보고 다시 판단하므로
    //    여기서는 빈 집합을 넘겨 "머리글/빈 행/도서명 없음"만 걸러냅니다.
    const plan = buildPlan(rows, mapping, new Set());
    const usable = plan.filter((p) => p.status === "new" || p.status === "update");
    const skippedRows = plan.length - usable.length;
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
        // 나중 행의 값이 이기되, 수량은 add 모드에서만 합칩니다.
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
          qty: mode === "add" ? prev.qty! + qty : qty,
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

    // 3) 반영 전 수량을 미리 읽어 둡니다 (이력의 변화량 계산용).
    const beforeRows = await db
      .select({ matchKey: books.matchKey, qty: books.qty })
      .from(books)
      .where(inArray(books.matchKey, keys));
    const before = new Map(beforeRows.map((b) => [b.matchKey, b.qty]));

    // 4) UPSERT. 기존 행이면 mode 에 따라 수량을 더하거나 덮어씁니다.
    //    updateMeta 가 켜져 있으면 비어 있지 않은 값만 골라 서지정보도 갱신합니다.
    const metaSet = updateMeta
      ? {
          isbn: sql`coalesce(nullif(excluded.isbn, ''), ${books.isbn})`,
          title: sql`coalesce(nullif(excluded.title, ''), ${books.title})`,
          author: sql`coalesce(nullif(excluded.author, ''), ${books.author})`,
          publisher: sql`coalesce(nullif(excluded.publisher, ''), ${books.publisher})`,
          pubDate: sql`coalesce(nullif(excluded.pub_date, ''), ${books.pubDate})`,
          subject: sql`coalesce(nullif(excluded.subject, ''), ${books.subject})`,
          location: sql`coalesce(nullif(excluded.location, ''), ${books.location})`,
          memo: sql`coalesce(nullif(excluded.memo, ''), ${books.memo})`,
          krw: sql`coalesce(excluded.krw, ${books.krw})`,
          cad: sql`coalesce(excluded.cad, ${books.cad})`,
          weight: sql`coalesce(excluded.weight, ${books.weight})`,
        }
      : {};

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

    // 5) 이력 기록
    const logs = saved
      .map((s) => {
        const prevQty = before.get(s.matchKey);
        const delta = s.qty - (prevQty ?? 0);
        const reason =
          prevQty === undefined
            ? "엑셀 등록"
            : mode === "replace"
              ? "엑셀 덮어쓰기"
              : "엑셀 입고";
        return { bookId: s.id, delta, qtyAfter: s.qty, reason };
      })
      .filter((l) => l.delta !== 0);

    for (let i = 0; i < logs.length; i += CHUNK) {
      await db.insert(stockLogs).values(logs.slice(i, i + CHUNK));
    }

    const created = saved.filter((s) => !before.has(s.matchKey)).length;
    const updated = saved.length - created;

    return NextResponse.json({
      ok: true,
      created,
      updated,
      // skip 모드에서 건너뛴 기존 도서 + 머리글/빈 행
      skipped: skippedRows + (mode === "skip" ? values.length - saved.length : 0),
      duplicatesMerged: usable.length - values.length,
    });
  } catch (err) {
    return handleError(err);
  }
}
