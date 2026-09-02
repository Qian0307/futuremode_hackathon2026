import { fail, ok, parseBody } from "@/lib/api";
import { getCurrentUser } from "@/lib/current-user";
import { findActivityById, updateActualDrain, updateBaseCapacity } from "@/lib/repo";
import { actualDrainSchema } from "@/lib/schemas";

export const runtime = "edge";

/**
 * PATCH /api/activities/:id/actual-drain
 * 接收「比預期多 / 差不多 / 少」，換算成 actual_drain，
 * 並在差距超過 20% 時微調使用者的 base_battery_capacity（±5）。
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser(req);
  if (!user) return fail("尚未完成人格快篩", 401);

  const parsed = await parseBody(req, actualDrainSchema);
  if ("response" in parsed) return parsed.response;

  const activity = await findActivityById(params.id);
  if (!activity) return fail("找不到這筆活動", 404);
  if (activity.userId !== user.row.id) return fail("無權存取這筆活動", 403);

  const actualDrain = resolveActualDrain(activity.predictedDrain, parsed.data);

  // 差距 > 20%（相對於預測值）時調整基礎容量：實際消耗比預期高 -> 容量調低。
  const diffRatio = activity.predictedDrain === 0 ? 0 : (actualDrain - activity.predictedDrain) / activity.predictedDrain;
  let newCapacity = user.profile.baseBatteryCapacity;
  if (diffRatio > 0.2) newCapacity = Math.max(0, newCapacity - 5);
  else if (diffRatio < -0.2) newCapacity = Math.min(100, newCapacity + 5);

  try {
    await updateActualDrain(activity.id, actualDrain);
    const capacityChanged = newCapacity !== user.profile.baseBatteryCapacity;
    if (capacityChanged) await updateBaseCapacity(user.row.id, newCapacity);

    return ok({
      activity: { ...activity, actualDrain },
      baseBatteryCapacity: newCapacity,
      capacityChanged,
    });
  } catch (err) {
    console.error("[actual-drain] 更新失敗:", err);
    return fail("回報失敗，請稍後再試", 500);
  }
}

function resolveActualDrain(predicted: number, input: { feedback?: "more" | "same" | "less"; actualDrain?: number }): number {
  if (typeof input.actualDrain === "number") return clamp(input.actualDrain);
  switch (input.feedback) {
    case "more":
      return clamp(Math.round(predicted * 1.35));
    case "less":
      return clamp(Math.round(predicted * 0.65));
    default:
      return clamp(predicted);
  }
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}
