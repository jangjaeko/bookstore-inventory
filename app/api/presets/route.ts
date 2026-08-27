import { NextResponse } from "next/server";
import { asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { importPresets } from "@/lib/schema";
import { fail, handleError, str } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const presets = await db.select().from(importPresets).orderBy(asc(importPresets.id));
    return NextResponse.json({ presets });
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const name = str(body.name);
    if (!name) return fail("양식 이름을 입력하세요.");
    if (!Array.isArray(body.mapping) || !body.mapping.every((m: unknown) => typeof m === "string")) {
      return fail("열 매핑 형식이 올바르지 않습니다.");
    }
    const [preset] = await db
      .insert(importPresets)
      .values({
        name,
        mapping: body.mapping,
        direction: body.direction === "out" ? "out" : "in",
        multiRow: body.multiRow === true,
      })
      .returning();
    return NextResponse.json({ preset });
  } catch (err) {
    return handleError(err);
  }
}
