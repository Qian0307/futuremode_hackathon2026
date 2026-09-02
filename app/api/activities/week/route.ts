import { fail, ok } from "@/lib/api";
import { getCurrentUser } from "@/lib/current-user";
import { listActivitiesBetween } from "@/lib/repo";
import { addDays, attachWarnings, buildDaySummaries, localDate } from "@/lib/week";

export const runtime = "edge";

/** GET /api/activities/week — 未來 7 天的活動列表 + 每天電量加總 + AI 風險預警。 */
export async function GET(req: Request) {
  const user = await getCurrentUser(req);
  if (!user) return fail("尚未完成人格快篩", 401);

  const url = new URL(req.url);
  const startDate = url.searchParams.get("start") ?? localDate(new Date());
  const skipWarnings = url.searchParams.get("warnings") === "0";

  try {
    const startIso = new Date(`${startDate}T00:00:00+08:00`).toISOString();
    const endIso = new Date(`${addDays(startDate, 7)}T00:00:00+08:00`).toISOString();

    const activities = await listActivitiesBetween(user.row.id, startIso, endIso);
    const base = buildDaySummaries(activities, user.profile, startDate, 7);
    const days = skipWarnings ? base : await attachWarnings(base, user.profile);

    return ok({
      profile: user.profile,
      startDate,
      days,
      totalActivities: activities.length,
    });
  } catch (err) {
    console.error("[week] 查詢失敗:", err);
    return fail("讀取一週資料失敗，請稍後再試", 500);
  }
}
