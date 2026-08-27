import fs from "node:fs";
import type { Config } from "drizzle-kit";

// Next.js 는 .env.local 을 자동으로 읽지만 drizzle-kit 은 읽지 않습니다.
// Node 20.12+ 내장 loadEnvFile 로 직접 불러옵니다 (별도 의존성 없음).
if (!process.env.DATABASE_URL && fs.existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

// 앱은 풀링 연결(DATABASE_URL)을 쓰지만, 스키마 변경(DDL)은 PgBouncer 를 거치지 않는
// 직결 연결로 하는 편이 안전합니다. Neon 이 함께 넣어주는 UNPOOLED 를 우선 사용합니다.
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;

export default {
  schema: "./lib/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: url! },
} satisfies Config;
