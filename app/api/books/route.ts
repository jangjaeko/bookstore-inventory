import { NextResponse } from "next/server";
import { and, asc, desc, eq, gt, inArray, like, lte, or, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { subjectGroup, subjectGroupPatterns } from "@/lib/format";
import { db } from "@/lib/db";
import { books, stockLogs } from "@/lib/schema";
import { makeMatchKey, normIsbn } from "@/lib/parse";
import { fail, handleError, num, str } from "@/lib/api";

export const dynamic = "force-dynamic";

// ─────────────── 목록 / 검색 ───────────────
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") ?? "").trim();
    const filter = url.searchParams.get("filter") ?? "all";
    const sort = url.searchParams.get("sort") ?? "updated";
    // 부족 기준. 화면에서 늘 함께 보내지만, 없거나 이상한 값이면 0(품절만)으로 봅니다.
    const threshold = Math.max(0, Number(url.searchParams.get("threshold")) || 0);

    const conditions = [];

    if (q) {
      // 사용자가 입력한 %, _, \ 는 LIKE 특수문자가 아니라 그냥 글자로 취급합니다.
      const escapeLike = (s: string) => s.replace(/([\\%_])/g, "\\$1");

      // 띄어쓰기를 무시하고 비교합니다.
      // "우리아기"로도 "우리 아기 알록달록 색깔 촉감책"을 찾을 수 있어야 하고,
      // 반대로 "우리 아기"로 검색해도 공백을 지운 쪽끼리 비교되므로 그대로 찾힙니다.
      const needle = `%${escapeLike(q.toLowerCase().replace(/\s+/g, ""))}%`;
      const squish = (col: AnyPgColumn) =>
        sql`regexp_replace(lower(${col}), '\\s+', '', 'g') LIKE ${needle}`;

      const parts = [
        squish(books.title),
        squish(books.author),
        squish(books.publisher),
        squish(books.subject),
        squish(books.memo),
        squish(books.location),
      ];

      // ISBN 은 하이픈이 섞여 있을 수 있으므로 숫자만 남겨 비교합니다.
      const digits = normIsbn(q);
      if (digits.length >= 3) {
        parts.push(sql`regexp_replace(${books.isbn}, '[^0-9Xx]', '', 'g') LIKE ${"%" + digits + "%"}`);
      }
      conditions.push(or(...parts));
    }

    if (filter === "inStock") conditions.push(gt(books.qty, 0));
    else if (filter === "low") conditions.push(lte(books.qty, threshold));
    else if (filter === "zero") conditions.push(lte(books.qty, 0));

    // 큰 분류로 거르기. "FIC" 가 "FICTION" 까지 잡지 않도록 구분자까지 붙여 비교합니다.
    const subjectParam = (url.searchParams.get("subject") ?? "").trim();
    if (subjectParam === "__none__") {
      conditions.push(eq(books.subject, ""));
    } else if (subjectParam) {
      const p = subjectGroupPatterns(subjectParam);
      conditions.push(
        or(eq(books.subject, p.exact), like(books.subject, p.gt), like(books.subject, p.dash)),
      );
    }

    const orderBy =
      sort === "title" ? [asc(books.title)]
      : sort === "qtyDesc" ? [desc(books.qty), asc(books.title)]
      : sort === "qtyAsc" ? [asc(books.qty), asc(books.title)]
      : sort === "added" ? [desc(books.createdAt)]
      : [desc(books.updatedAt)];

    const rows = await db
      .select()
      .from(books)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(...orderBy)
      .limit(2000);

    // 통계는 검색과 무관하게 전체 기준으로 보여줍니다.
    const [totals] = await db
      .select({
        titles: sql<number>`count(*)::int`,
        copies: sql<number>`coalesce(sum(${books.qty}), 0)::int`,
        low: sql<number>`count(*) filter (where ${books.qty} > 0 and ${books.qty} <= ${threshold})::int`,
        zero: sql<number>`count(*) filter (where ${books.qty} <= 0)::int`,
      })
      .from(books);

    // 보기 드롭다운에 쓸 큰 분류 목록. 걸러진 결과가 아니라 전체 기준으로 셉니다.
    // (서로 다른 Subject 는 수십 가지뿐이라 모아서 JS 로 묶는 편이 간단합니다)
    const subjectRows = await db
      .select({ subject: books.subject, n: sql<number>`count(*)::int` })
      .from(books)
      .groupBy(books.subject);

    const groupCount = new Map<string, number>();
    let noSubject = 0;
    for (const r of subjectRows) {
      const g = subjectGroup(r.subject);
      if (!g) noSubject += r.n;
      else groupCount.set(g, (groupCount.get(g) ?? 0) + r.n);
    }
    const subjects = [...groupCount.entries()]
      .map(([group, n]) => ({ group, n }))
      .sort((a, b) => b.n - a.n || a.group.localeCompare(b.group, "ko"));

    return NextResponse.json({ books: rows, totals, subjects, noSubject });
  } catch (err) {
    return handleError(err);
  }
}

// ─────────────── 직접 추가 ───────────────
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const title = str(body.title);
    if (!title) return fail("도서명은 반드시 입력해야 합니다.");

    const isbn = str(body.isbn) ?? "";
    const author = str(body.author) ?? "";
    const qty = Math.max(0, Math.round(Number(body.qty) || 0));
    const matchKey = makeMatchKey({ isbn, title, author });

    const values = {
      matchKey,
      isbn,
      title,
      author,
      publisher: str(body.publisher) ?? "",
      pubDate: str(body.pubDate) ?? "",
      subject: str(body.subject) ?? "",
      location: str(body.location) ?? "",
      memo: str(body.memo) ?? "",
      krw: num(body.krw) ?? null,
      cad: num(body.cad) ?? null,
      weight: num(body.weight) ?? null,
      qty,
    };

    // 같은 책이 이미 있으면 새로 만들지 않고 수량을 더합니다.
    const [saved] = await db
      .insert(books)
      .values(values)
      .onConflictDoUpdate({
        target: books.matchKey,
        set: { qty: sql`${books.qty} + excluded.qty`, updatedAt: sql`now()` },
      })
      .returning();

    const merged = saved.qty !== qty;
    await db.insert(stockLogs).values({
      bookId: saved.id,
      delta: qty,
      qtyAfter: saved.qty,
      reason: merged ? "직접 입고" : "직접 등록",
    });

    return NextResponse.json({ book: saved, merged });
  } catch (err) {
    return handleError(err);
  }
}

// ─────────────── 선택 항목 일괄 처리 ───────────────
export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const ids: number[] = Array.isArray(body.ids) ? body.ids.filter(Number.isInteger) : [];
    if (!ids.length) return fail("선택된 항목이 없습니다.");

    if (body.action === "delete") {
      await db.delete(books).where(inArray(books.id, ids));
      return NextResponse.json({ ok: true, deleted: ids.length });
    }

    const delta = Math.round(Number(body.delta));
    if (!Number.isFinite(delta) || delta === 0) return fail("변경할 수량을 입력하세요.");

    // 출고로 0 미만이 되는 경우 GREATEST 로 잘리므로, 이력에 남길 실제 변화량을
    // 계산하려면 변경 전 수량이 필요합니다.
    const before = new Map(
      (await db.select({ id: books.id, qty: books.qty }).from(books).where(inArray(books.id, ids))).map(
        (b) => [b.id, b.qty],
      ),
    );

    const updated = await db
      .update(books)
      .set({ qty: sql`greatest(0, ${books.qty} + ${delta})`, updatedAt: sql`now()` })
      .where(inArray(books.id, ids))
      .returning({ id: books.id, qty: books.qty });

    const logs = updated
      .map((u) => ({
        bookId: u.id,
        delta: u.qty - (before.get(u.id) ?? u.qty),
        qtyAfter: u.qty,
        reason: delta > 0 ? "일괄 입고" : "일괄 출고",
      }))
      .filter((l) => l.delta !== 0);

    if (logs.length) await db.insert(stockLogs).values(logs);

    return NextResponse.json({ ok: true, updated: updated.length });
  } catch (err) {
    return handleError(err);
  }
}
