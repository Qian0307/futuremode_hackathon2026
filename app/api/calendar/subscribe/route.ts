import { fail, ok } from "@/lib/api";
import { getCurrentUser } from "@/lib/current-user";
import { ensureCalendarToken } from "@/lib/repo";

export const runtime = "edge";

/**
 * POST /api/calendar/subscribe
 * 取得（必要時產生）這個使用者的行事曆訂閱網址。
 * 回傳 https 與 webcal 兩種：Apple 行事曆點 webcal:// 會直接跳出訂閱視窗。
 */
export async function POST(req: Request) {
  const user = await getCurrentUser(req);
  if (!user) return fail("尚未完成人格快篩", 401);

  const token = await ensureCalendarToken(user.row.id);
  if (!token) return fail("無法產生訂閱網址", 500);

  const origin = new URL(req.url).origin;
  const httpsUrl = `${origin}/api/calendar/${token}.ics`;

  return ok({
    token,
    url: httpsUrl,
    // webcal: 是 Apple 行事曆的訂閱協定，等同於 https 但會觸發訂閱流程
    webcalUrl: httpsUrl.replace(/^https?:/, "webcal:"),
  });
}
