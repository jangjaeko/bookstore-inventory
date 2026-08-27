import { NextResponse } from "next/server";

/** 라우트 핸들러에서 던져진 오류를 일관된 JSON 으로 변환합니다. */
export function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export function handleError(err: unknown) {
  const message = err instanceof Error ? err.message : "알 수 없는 오류가 발생했습니다.";
  console.error("[api]", err);
  return fail(message, 500);
}

/** 문자열로 들어온 id 를 정수로 변환. 잘못된 값이면 null. */
export function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** 문자열 필드 정리 (undefined 는 "변경 없음"으로 남깁니다) */
export function str(v: unknown): string | undefined {
  if (v == null) return undefined;
  return String(v).trim();
}

/** 숫자 필드 정리. "" 는 null(값 지움)로 봅니다. */
export function num(v: unknown): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
