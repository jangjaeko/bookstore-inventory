import { NextResponse } from "next/server";
import { inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { books } from "@/lib/schema";
import { handleError } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * 붙여넣기 미리보기용.
 * 클라이언트가 계산한 matchKey 목록을 보내면 그중 이미 재고에 있는 것만 돌려줍니다.
 * → "새로 등록 N종 / 기존 재고 반영 M종" 을 정확히 보여줄 수 있습니다.
 */
export async function POST(req: Request) {
  try {
    const { keys } = await req.json();
    const list: string[] = Array.isArray(keys) ? keys.filter((k) => typeof k === "string") : [];
    if (!list.length) return NextResponse.json({ existing: [] });

    const rows = await db
      .select({ matchKey: books.matchKey })
      .from(books)
      .where(inArray(books.matchKey, [...new Set(list)]));

    return NextResponse.json({ existing: rows.map((r) => r.matchKey) });
  } catch (err) {
    return handleError(err);
  }
}
