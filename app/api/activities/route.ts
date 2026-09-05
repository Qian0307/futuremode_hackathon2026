import { fail, ok, parseBody } from "@/lib/api";
import { runInBackground } from "@/lib/background";
import { hasAnyProvider } from "@/lib/ai";
import { getCurrentUser } from "@/lib/current-user";
import { ruleBasedDrain } from "@/lib/drain-rules";
import { predictDrain } from "@/lib/predict";
import { insertActivity, refinePredictedDrain } from "@/lib/repo";
import { createActivitySchema } from "@/lib/schemas";
import type { Activity } from "@/lib/types";

export const runtime = "edge";

/**
 * POST /api/activities — 新增活動。
 *
 * 為什麼不等 AI：呼叫 OpenAI 要好幾秒（timeout 設 12 秒），使用者按下「加入行程」
 * 卻要盯著轉圈是很糟的體驗，demo 現場網路不好時更明顯。
 * 所以這裡先用 lib/drain-rules.ts 的規則式估算立刻存檔並回應，
 * 再把 AI 預測丟到背景（ctx.waitUntil）跑，完成後回頭更新同一筆的 predicted_drain。
 *
 * 注意：這是延遲的優化，不是成本的優化——AI 還是會被呼叫一次。
 */
export async function POST(req: Request) {
  const user = await getCurrentUser(req);
  if (!user) return fail("尚未完成人格快篩", 401);

  const parsed = await parseBody(req, createActivitySchema);
  if ("response" in parsed) return parsed.response;

  const { scheduledAt, ...activityInput } = parsed.data;
  const predictionInput = { activity: activityInput, profile: user.profile };

  // 1. 規則式估算：純計算，沒有 I/O，可以立刻回應
  const quick = ruleBasedDrain(predictionInput);

  const row = {
    id: crypto.randomUUID(),
    userId: user.row.id,
    type: activityInput.type,
    headcount: activityInput.headcount,
    familiarity: activityInput.familiarity,
    durationMinutes: activityInput.durationMinutes,
    scheduledAt: normalizeIso(scheduledAt),
    predictedDrain: quick.predictedDrain,
    actualDrain: null,
    createdAt: new Date().toISOString(),
  };

  let activity: Activity;
  try {
    activity = await insertActivity(row);
  } catch (err) {
    console.error("[activities] 新增失敗:", err);
    return fail("新增活動失敗，請稍後再試", 500);
  }

  // 2. 沒有任何 AI 供應商就不用排背景工作，前端也不必等後續更新
  const willRefine = await hasAnyProvider();
  if (willRefine) {
    await runInBackground("refine-drain", async () => {
      const refined = await predictDrain(predictionInput);
      // 只有真的拿到 AI 結果才覆蓋；rule 是同一個值，crisis 不該改動數字
      if (refined.source !== "ai" || refined.predictedDrain === quick.predictedDrain) return;
      const updated = await refinePredictedDrain(activity.id, refined.predictedDrain);
      if (updated) {
        console.log(`[refine] ${activity.id}: ${quick.predictedDrain}% -> ${refined.predictedDrain}%`);
      }
    });
  }

  return ok(
    { activity, reason: quick.reason, source: "rule" as const, refining: willRefine },
    { status: 201 }
  );
}

/** 前端 datetime-local 會送出沒有時區的字串，統一補上台北時區。 */
function normalizeIso(value: string): string {
  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(value)) return new Date(value).toISOString();
  const withSeconds = value.length === 16 ? `${value}:00` : value;
  return new Date(`${withSeconds}+08:00`).toISOString();
}
