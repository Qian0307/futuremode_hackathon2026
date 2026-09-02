import { NextResponse } from "next/server";

export const SESSION_COOKIE = "sbm_session";

export function getSessionIdFromRequest(req: Request): string | null {
  const cookie = req.headers.get("cookie");
  if (!cookie) return null;
  const match = cookie.split(";").map((c) => c.trim()).find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  return match ? decodeURIComponent(match.slice(SESSION_COOKIE.length + 1)) : null;
}

export function newSessionId(): string {
  return crypto.randomUUID();
}

export function withSessionCookie<T>(res: NextResponse<T>, sessionId: string): NextResponse<T> {
  res.cookies.set(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    // 本機以 http 開發時加 Secure 會讓瀏覽器/工具不回送 cookie
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 180, // 180 天
  });
  return res;
}
