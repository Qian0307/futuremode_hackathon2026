import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "@/db/schema";

export type DB = DrizzleD1Database<typeof schema>;

/**
 * 取得 Cloudflare D1 binding。
 * - 部署在 Cloudflare Pages 時，由 next-on-pages 的 request context 提供。
 * - `next dev` 時由 next.config.mjs 的 setupDevPlatform() 提供（讀 wrangler.toml）。
 * 若拿不到 binding（例如在沒有 wrangler 環境的機器上跑前端），回傳 null，
 * 由 lib/repo.ts 自動切換到記憶體 fallback，讓前端可以獨立開發。
 */
export async function getDb(): Promise<DB | null> {
  try {
    const { getRequestContext } = await import("@cloudflare/next-on-pages");
    const env = getRequestContext().env as unknown as { DB?: D1Database };
    if (!env?.DB) return null;
    return drizzle(env.DB, { schema });
  } catch {
    return null;
  }
}

export { schema };
