import { NextResponse, type NextRequest } from "next/server";

/**
 * 簡易 rate limiting，避免 demo 期間 API 被連續呼叫刷爆 OpenAI credits。
 *
 * 限制：計數存在 isolate 記憶體，Cloudflare 多節點/多 isolate 不會共享，
 * 因此這是「防手滑與防單機腳本」等級的保護，不是嚴格的全域限流。
 * 若要嚴格限流，之後可換成 Durable Object 或 KV。
 */

const WINDOW_MS = 60_000;

/** 每分鐘允許次數：呼叫 AI 的路徑抓緊一點。 */
const LIMITS: { prefix: string; limit: number }[] = [
  { prefix: "/api/predict-drain", limit: 15 },
  { prefix: "/api/activities/week", limit: 40 },
  { prefix: "/api/activities", limit: 20 },
  { prefix: "/api/onboarding", limit: 20 },
  // Track D：語音成本較高，抓得更緊
  { prefix: "/api/voice-to-text", limit: 10 },
  { prefix: "/api/parse-voice-activity", limit: 15 },
  // 排日程與回顧都會呼叫 AI
  { prefix: "/api/schedule-suggest", limit: 12 },
  { prefix: "/api/review/week", limit: 20 },
  { prefix: "/api/calendar/subscribe", limit: 10 },
];

type Bucket = { count: number; resetAt: number };
const globalForRate = globalThis as unknown as { __sbmRate?: Map<string, Bucket> };
function buckets(): Map<string, Bucket> {
  if (!globalForRate.__sbmRate) globalForRate.__sbmRate = new Map();
  return globalForRate.__sbmRate;
}

function limitFor(pathname: string): number | null {
  const hit = LIMITS.find((l) => pathname.startsWith(l.prefix));
  return hit ? hit.limit : null;
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // 日曆 feed 由 Apple/Google 行事曆定時輪詢，且不帶 cookie，不套用限流。
  // 但取得訂閱網址的 /api/calendar/subscribe 仍然要限流。
  if (pathname.startsWith("/api/calendar/") && pathname !== "/api/calendar/subscribe") {
    return NextResponse.next();
  }
  const limit = limitFor(pathname);
  if (limit === null) return NextResponse.next();

  const ip =
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  const key = `${ip}:${LIMITS.find((l) => pathname.startsWith(l.prefix))!.prefix}`;

  const now = Date.now();
  const store = buckets();
  const bucket = store.get(key);

  if (!bucket || now > bucket.resetAt) {
    store.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return NextResponse.next();
  }

  if (bucket.count >= limit) {
    const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    return NextResponse.json(
      { error: "請求太頻繁了，稍等一下再試" },
      { status: 429, headers: { "Retry-After": String(retryAfter) } }
    );
  }

  bucket.count += 1;
  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
