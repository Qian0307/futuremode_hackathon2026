import { buildIcs } from "@/lib/ics";
import { findUserByCalendarToken, listActivitiesBetween, rowToProfile } from "@/lib/repo";
import { addDays, localDate } from "@/lib/time";
import { attachRuleWarnings, buildDaySummaries } from "@/lib/week";

export const runtime = "edge";

/** 訂閱範圍：往前 30 天（保留歷史）到往後 60 天。 */
const DAYS_BACK = 30;
const DAYS_FORWARD = 60;

/**
 * GET /api/calendar/:token — Apple / Google 行事曆訂閱用的 iCalendar feed。
 *
 * 認證方式刻意不用 cookie：行事曆用戶端抓 .ics 時不會帶 cookie，
 * 所以改用一段隨機 token 放在網址裡（可在 App 內重新產生等同撤銷）。
 * token 支援帶不帶 .ics 副檔名，因為部分用戶端會挑剔。
 */
export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const token = params.token.replace(/\.ics$/i, "");
  if (!token || token.length < 16) {
    return new Response("Not found", { status: 404 });
  }

  const user = await findUserByCalendarToken(token);
  if (!user) return new Response("Not found", { status: 404 });

  try {
    const profile = rowToProfile(user);
    const today = localDate(new Date());
    const startDate = addDays(today, -DAYS_BACK);

    const startIso = new Date(`${startDate}T00:00:00+08:00`).toISOString();
    const endIso = new Date(`${addDays(today, DAYS_FORWARD)}T00:00:00+08:00`).toISOString();

    const activities = await listActivitiesBetween(user.id, startIso, endIso);
    // 預警文字用規則式版本即可：行事曆會定時輪詢，不該每次都打 AI
    const days = attachRuleWarnings(
      buildDaySummaries(activities, profile, startDate, DAYS_BACK + DAYS_FORWARD),
      profile
    );

    const ics = buildIcs({ days, profile });

    return new Response(ics, {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'inline; filename="social-battery.ics"',
        "Cache-Control": "public, max-age=900",
      },
    });
  } catch (err) {
    console.error("[calendar] 產生 ics 失敗:", err);
    return new Response("Internal error", { status: 500 });
  }
}
