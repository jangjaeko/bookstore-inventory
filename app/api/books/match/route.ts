import { NextResponse } from "next/server";
import { inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { books } from "@/lib/schema";
import { handleError } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * 붙여넣기 미리보기용.
 * 클라이언트가 계산한 matchKey 목록을 보내면 그중 이미 재고에 있는 것을 돌려줍니다.
 *
 * 수량까지 함께 주는 이유: 출고(납품) 미리보기에서 "재고에 없음 / 재고 부족" 을
 * 반영 전에 알려줘야 하기 때문입니다.
 */
export async function POST(req: Request) {
  try {
    const { keys } = await req.json();
    const list: string[] = Array.isArray(keys) ? keys.filter((k) => typeof k === "string") : [];
    if (!list.length) return NextResponse.json({ existing: [] });

    const rows = await db
      .select({ matchKey: books.matchKey, id: books.id, title: books.title, qty: books.qty })
      .from(books)
      .where(inArray(books.matchKey, [...new Set(list)]));

    return NextResponse.json({ existing: rows });
  } catch (err) {
    return handleError(err);
  }
}
