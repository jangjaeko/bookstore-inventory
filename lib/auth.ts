/**
 * 공용 비밀번호 1개 방식의 아주 단순한 로그인.
 *
 * 쿠키에는 비밀번호가 아니라 HMAC(AUTH_SECRET, APP_PASSWORD) 해시를 담습니다.
 *   - 쿠키를 훔쳐봐도 비밀번호를 알 수 없고
 *   - APP_PASSWORD 를 바꾸면 기존 로그인 세션이 전부 무효화됩니다.
 *
 * Web Crypto 만 쓰므로 Edge 런타임(middleware)에서도 그대로 동작합니다.
 */

export const SESSION_COOKIE = "bi_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30일

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} 환경변수가 설정되지 않았습니다.`);
  return v;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** 로그인 성공 시 쿠키에 넣을 값 */
export async function makeSessionToken(): Promise<string> {
  return hmacHex(requireEnv("AUTH_SECRET"), requireEnv("APP_PASSWORD"));
}

/** 길이·내용 모두 타이밍 공격에 덜 취약하도록 상수시간 비교 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** 입력한 비밀번호가 맞는지 */
export async function checkPassword(input: string): Promise<boolean> {
  const expected = requireEnv("APP_PASSWORD");
  // 길이가 달라도 해시끼리 비교하면 상수시간이 유지됩니다.
  const secret = requireEnv("AUTH_SECRET");
  const [a, b] = await Promise.all([hmacHex(secret, input), hmacHex(secret, expected)]);
  return timingSafeEqual(a, b);
}

/** 쿠키 값이 유효한 세션인지 */
export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  try {
    return timingSafeEqual(token, await makeSessionToken());
  } catch {
    return false;
  }
}
