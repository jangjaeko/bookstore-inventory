import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema";

type DB = NeonHttpDatabase<typeof schema>;

let instance: DB | null = null;

function getDb(): DB {
  if (!instance) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error(
        "DATABASE_URL 환경변수가 없습니다. .env.example 을 참고해 .env.local 을 만들어 주세요.",
      );
    }
    instance = drizzle(neon(url), { schema });
  }
  return instance;
}

/**
 * 연결은 실제로 쿼리를 쓸 때 만들어집니다.
 * `next build` 는 라우트 모듈을 import 만 하고 실행하지 않는데, 그때 DATABASE_URL 이
 * 없다고 빌드가 깨지는 것을 막기 위해 프록시로 지연 초기화합니다.
 */
export const db = new Proxy({} as DB, {
  get(_target, prop, receiver) {
    const real = getDb() as unknown as Record<string | symbol, unknown>;
    const value = Reflect.get(real, prop, receiver);
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export { schema };
