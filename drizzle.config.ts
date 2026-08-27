import fs from "node:fs";
import type { Config } from "drizzle-kit";

// Next.js 는 .env.local 을 자동으로 읽지만 drizzle-kit 은 읽지 않습니다.
// Node 20.12+ 내장 loadEnvFile 로 직접 불러옵니다 (별도 의존성 없음).
if (!process.env.DATABASE_URL && fs.existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

export default {
  schema: "./lib/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
} satisfies Config;
