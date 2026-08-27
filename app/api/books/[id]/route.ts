import { NextResponse } from "next/server";
import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { books, stockLogs } from "@/lib/schema";
import { makeMatchKey } from "@/lib/parse";
import { fail, handleError, num, parseId, str } from "@/lib/api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * 두 가지 용도를 겸합니다.
 *  - { delta: 1 }  또는 { qty: 5 }  → 수량만 변경 (표의 +/− 버튼, 직접 입력)
 *  - { title, author, ... }         → 수정 화면에서의 전체 편집
 */
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const id = parseId((await params).id);
    if (!id) return fail("잘못된 id 입니다.");

    const body = await req.json();
    const [current] = await db.select().from(books).where(eq(books.id, id));
    if (!current) return fail("해당 도서를 찾을 수 없습니다.", 404);

    // ── 수량만 바꾸는 경우 ──
    const isQtyOnly = body.delta !== undefined || (body.qty !== undefined && body.title === undefined);
    if (isQtyOnly) {
      const next =
        body.delta !== undefined
          ? Math.max(0, current.qty + Math.round(Number(body.delta) || 0))
          : Math.max(0, Math.round(Number(body.qty) || 0));

      if (next === current.qty) return NextResponse.json({ book: current });

      const [saved] = await db
        .update(books)
        .set({ qty: next, updatedAt: sql`now()` })
        .where(eq(books.id, id))
        .returning();

      await db.insert(stockLogs).values({
        bookId: id,
        delta: next - current.qty,
        qtyAfter: next,
        reason: str(body.reason) || (body.delta !== undefined ? (next > current.qty ? "입고" : "출고") : "직접 수정"),
      });

      return NextResponse.json({ book: saved });
    }

    // ── 전체 편집 ──
    const title = str(body.title);
    if (!title) return fail("도서명은 반드시 입력해야 합니다.");

    const isbn = str(body.isbn) ?? current.isbn;
    const author = str(body.author) ?? current.author;
    const matchKey = makeMatchKey({ isbn, title, author });

    // ISBN/도서명/저자를 고쳐서 다른 책과 같은 책이 되어버리면 UNIQUE 충돌이 납니다.
    if (matchKey !== current.matchKey) {
      const [clash] = await db
        .select({ id: books.id, title: books.title })
        .from(books)
        .where(and(eq(books.matchKey, matchKey), ne(books.id, id)));
      if (clash) {
        return fail(`같은 책으로 인식되는 항목이 이미 있습니다: "${clash.title}". 먼저 합치거나 지워 주세요.`, 409);
      }
    }

    const qty = body.qty === undefined ? current.qty : Math.max(0, Math.round(Number(body.qty) || 0));

    const [saved] = await db
      .update(books)
      .set({
        matchKey,
        isbn,
        title,
        author,
        publisher: str(body.publisher) ?? current.publisher,
        pubDate: str(body.pubDate) ?? current.pubDate,
        subject: str(body.subject) ?? current.subject,
        location: str(body.location) ?? current.location,
        memo: str(body.memo) ?? current.memo,
        krw: num(body.krw) === undefined ? current.krw : num(body.krw),
        cad: num(body.cad) === undefined ? current.cad : num(body.cad),
        weight: num(body.weight) === undefined ? current.weight : num(body.weight),
        qty,
        updatedAt: sql`now()`,
      })
      .where(eq(books.id, id))
      .returning();

    if (qty !== current.qty) {
      await db.insert(stockLogs).values({
        bookId: id,
        delta: qty - current.qty,
        qtyAfter: qty,
        reason: "직접 수정",
      });
    }

    return NextResponse.json({ book: saved });
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const id = parseId((await params).id);
    if (!id) return fail("잘못된 id 입니다.");
    await db.delete(books).where(eq(books.id, id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
