import "server-only";

/**
 * 讀取 server-side 環境變數 / secret。
 *
 * Cloudflare Pages 上 secret 由 next-on-pages 注入 process.env；
 * 拿不到就退回 request context 的 env binding（本機 next dev 會從 .dev.vars 來）。
 *
 * 這個檔案標了 "server-only"，任何 client component 誤 import 都會在 build 階段失敗，
 * 也就守住了第 0.5 節「API Key 只能在 server-side 讀取」。
 */
export async function readEnv(key: string): Promise<string | undefined> {
  const fromProcess = process.env[key];
  if (fromProcess) return fromProcess;
  try {
    const { getRequestContext } = await import("@cloudflare/next-on-pages");
    return (getRequestContext().env as unknown as Record<string, string | undefined>)?.[key];
  } catch {
    return undefined;
  }
}
