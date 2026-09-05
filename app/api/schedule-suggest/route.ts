import { fail, ok, parseBody } from "@/lib/api";
import { getCurrentUser } from "@/lib/current-user";
import { listActivitiesBetween } from "@/lib/repo";
import { scheduleSuggestRequestSchema } from "@/lib/schemas";
import { suggestSchedule, type ActivityShape } from "@/lib/schedule";
import { parseVoiceActivity } from "@/lib/voice-parse";
import { addDays, localDate } from "@/lib/time";
import { buildDaySummaries } from "@/lib/week";

export const runtime = "edge";

/**
 * POST /api/schedule-suggest — 排日程系統
 * 輸入想安排的活動（結構化欄位，或一句自然語言描述），
 * 回傳未來 7 天中每一天的適合度與建議時段。
 */
export async function POST(req: Request) {
  const user = await getCurrentUser(req);
  if (!user) return fail("尚未完成人格快篩", 401);

  const parsed = await parseBody(req, scheduleSuggestRequestSchema);
  if ("response" in parsed) return parsed.response;

  // 自然語言描述先過一次語音解析器，轉成結構化欄位
  let activity: ActivityShape;
  if (parsed.data.activity) {
    activity = parsed.data.activity;
  } else {
    const result = await parseVoiceActivity(parsed.data.description as string);
    if (result.status === "crisis") return ok({ crisis: true, message: result.message });
    activity = {
      type: result.activity.type,
      headcount: result.activity.headcount,
      familiarity: result.activity.familiarity as ActivityShape["familiarity"],
      durationMinutes: result.activity.durationMinutes,
    };
  }

  try {
    const startDate = localDate(new Date());
    const startIso = new Date(`${startDate}T00:00:00+08:00`).toISOString();
    const endIso = new Date(`${addDays(startDate, 7)}T00:00:00+08:00`).toISOString();

    const existing = await listActivitiesBetween(user.row.id, startIso, endIso);
    const days = buildDaySummaries(existing, user.profile, startDate, 7);

    const result = await suggestSchedule(user.profile, activity, days);
    return ok({ activity, ...result });
  } catch (err) {
    console.error("[schedule-suggest] 失敗:", err);
    return fail("產生建議失敗，請稍後再試", 500);
  }
}
