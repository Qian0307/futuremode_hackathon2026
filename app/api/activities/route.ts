import { fail, ok, parseBody } from "@/lib/api";
import { getCurrentUser } from "@/lib/current-user";
import { predictDrain } from "@/lib/predict";
import { insertActivity } from "@/lib/repo";
import { createActivitySchema } from "@/lib/schemas";
import type { Activity } from "@/lib/types";

export const runtime = "edge";

/** POST /api/activities — 新增活動，內部先取得 predictedDrain 再一起存入。 */
export async function POST(req: Request) {
  const user = await getCurrentUser(req);
  if (!user) return fail("尚未完成人格快篩", 401);

  const parsed = await parseBody(req, createActivitySchema);
  if ("response" in parsed) return parsed.response;

  const { scheduledAt, ...activityInput } = parsed.data;

  const prediction = await predictDrain({ activity: activityInput, profile: user.profile });

  const now = new Date().toISOString();
  const row = {
    id: crypto.randomUUID(),
    userId: user.row.id,
    type: activityInput.type,
    headcount: activityInput.headcount,
    familiarity: activityInput.familiarity,
    durationMinutes: activityInput.durationMinutes,
    scheduledAt: normalizeIso(scheduledAt),
    predictedDrain: prediction.predictedDrain,
    actualDrain: null,
    createdAt: now,
  };

  try {
    const activity: Activity = await insertActivity(row);
    return ok({ activity, reason: prediction.reason, source: prediction.source }, { status: 201 });
  } catch (err) {
    console.error("[activities] 新增失敗:", err);
    return fail("新增活動失敗，請稍後再試", 500);
  }
}

/** 前端 datetime-local 會送出沒有時區的字串，統一補上台北時區。 */
function normalizeIso(value: string): string {
  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(value)) return new Date(value).toISOString();
  const withSeconds = value.length === 16 ? `${value}:00` : value;
  return new Date(`${withSeconds}+08:00`).toISOString();
}
