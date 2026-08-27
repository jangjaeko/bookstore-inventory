import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { stockLogs } from "@/lib/schema";
import { fail, handleError, parseId } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = parseId((await params).id);
    if (!id) return fail("잘못된 id 입니다.");

    const logs = await db
      .select()
      .from(stockLogs)
      .where(eq(stockLogs.bookId, id))
      .orderBy(desc(stockLogs.createdAt))
      .limit(200);

    return NextResponse.json({ logs });
  } catch (err) {
    return handleError(err);
  }
}
