import "server-only";

/**
 * 把工作丟到背景執行，讓 response 可以先回給使用者。
 *
 * Cloudflare Workers 的重點：回應送出後，**沒有註冊到 ctx.waitUntil() 的 promise 會被直接取消**，
 * 所以不能只是 fire-and-forget，一定要拿到 request context 的 ctx。
 * 本機 next dev 拿不到 ctx 時退回 fire-and-forget——dev server 是長駐的 node 程序，
 * promise 仍會跑完，只是沒有平台層保證。
 */
export async function runInBackground(label: string, task: () => Promise<void>): Promise<void> {
  const promise = task().catch((err) => {
    console.error(`[background:${label}] 失敗:`, err);
  });

  try {
    const { getRequestContext } = await import("@cloudflare/next-on-pages");
    const ctx = getRequestContext().ctx as { waitUntil?: (p: Promise<unknown>) => void } | undefined;
    if (typeof ctx?.waitUntil === "function") {
      ctx.waitUntil(promise);
      return;
    }
  } catch {
    /* 沒有 request context（本機 dev）就走下面的 fallback */
  }

  void promise;
}
