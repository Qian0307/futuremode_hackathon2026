import { chatJson } from "@/lib/ai";
import { isLowBattery, simulateWeek } from "@/lib/battery";
import { buildWeeklyRiskUserPrompt, WEEKLY_RISK_SYSTEM_PROMPT, type WeeklyDayInput } from "@/lib/prompts/weekly-risk-warning";
import { weeklyWarningsSchema } from "@/lib/schemas";
import { CRISIS_RESPONSE, detectCrisis } from "@/lib/safety";
import { addDays, localDate, localTime } from "@/lib/time";
import type { Activity, PersonalityProfile } from "@/lib/types";

export { addDays, localDate, TIME_ZONE } from "@/lib/time";
export { LOW_BATTERY_THRESHOLD, OVERNIGHT_RECOVERY_RATE } from "@/lib/battery";

export interface DaySummary {
  date: string; // YYYY-MM-DD
  activities: Activity[];
  totalDrain: number;
  /** 當天起床時的電量。低於基礎容量代表前一天的赤字被帶過來了。 */
  startBattery: number;
  remainingBattery: number;
  isLow: boolean;
  warning: string | null;
}

/**
 * 把活動依日期分組，算出每天的起床電量與結束時的剩餘電量。
 *
 * 模型假設：睡一覺只回充「基礎容量 × OVERNIGHT_RECOVERY_RATE」，所以前一天
 * 沒補回來的赤字會帶到隔天——這正是「連續高強度社交會累積成 burnout」的來源。
 * 實際數學在 lib/battery.ts 的 simulateWeek()。
 */
export function buildDaySummaries(
  activities: Activity[],
  profile: PersonalityProfile,
  startDate: string,
  days = 7
): DaySummary[] {
  const byDate = new Map<string, Activity[]>();
  for (const a of activities) {
    const key = localDate(a.scheduledAt);
    const list = byDate.get(key) ?? [];
    list.push(a);
    byDate.set(key, list);
  }

  const dates = Array.from({ length: days }, (_, i) => addDays(startDate, i));
  const perDay = dates.map((date) =>
    (byDate.get(date) ?? []).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
  );
  const drains = perDay.map((list) => list.reduce((sum, a) => sum + (a.actualDrain ?? a.predictedDrain), 0));
  const battery = simulateWeek(drains, profile.baseBatteryCapacity);

  return dates.map((date, i) => ({
    date,
    activities: perDay[i],
    totalDrain: drains[i],
    startBattery: battery[i].startBattery,
    remainingBattery: battery[i].remainingBattery,
    isLow: isLowBattery(battery[i].remainingBattery),
    warning: null,
  }));
}

/**
 * Track C2：對低電量日產生 AI 風險預警。
 * AI 失敗時回退到規則式提醒文字，確保頁面一定有東西可顯示。
 */
export async function attachWarnings(days: DaySummary[], profile: PersonalityProfile): Promise<DaySummary[]> {
  const lowDays = days.filter((d) => d.isLow);
  if (lowDays.length === 0) return days;

  if (detectCrisis(profile)) {
    return days.map((d) => (d.isLow ? { ...d, warning: CRISIS_RESPONSE } : d));
  }

  const input: WeeklyDayInput[] = days.map((d) => ({
    date: d.date,
    startBattery: d.startBattery,
    remainingBattery: d.remainingBattery,
    activities: d.activities.map((a) => ({
      type: a.type,
      headcount: a.headcount,
      familiarity: a.familiarity,
      durationMinutes: a.durationMinutes,
      scheduledAt: a.scheduledAt,
      predictedDrain: a.predictedDrain,
    })),
  }));

  const raw = await chatJson({
    systemPrompt: WEEKLY_RISK_SYSTEM_PROMPT,
    userPrompt: buildWeeklyRiskUserPrompt(profile, input),
    temperature: 0.6,
    maxTokens: 600,
  });

  const parsed = raw === null ? null : weeklyWarningsSchema.safeParse(raw);
  if (!parsed || !parsed.success) {
    return days.map((d) => (d.isLow ? { ...d, warning: ruleBasedWarning(d, profile) } : d));
  }

  const map = new Map(parsed.data.warnings.map((w) => [w.date, w.message]));
  return days.map((d) => (d.isLow ? { ...d, warning: map.get(d.date) ?? ruleBasedWarning(d, profile) } : d));
}

/** AI 不可用時的預警文字（仍要具體，不能只寫「記得休息」）。 */
function ruleBasedWarning(day: DaySummary, profile: PersonalityProfile): string {
  const count = day.activities.length;
  // 起床就沒滿電，代表低電量主因是前一天的赤字，而不是當天排太多
  const carriedOver = day.startBattery < profile.baseBatteryCapacity;
  const prefix = carriedOver ? `前一天的疲勞還沒退，這天起床只有 ${day.startBattery}%。` : "";

  if (count >= 2) {
    const first = localTime(day.activities[0].scheduledAt);
    const last = localTime(day.activities[count - 1].scheduledAt);
    return `${prefix}這天從 ${first} 到 ${last} 有 ${count} 場社交，電量會剩下 ${day.remainingBattery}%。要不要在中間留 30 分鐘一個人透透氣？`;
  }
  if (count === 1) {
    const a = day.activities[0];
    const scale = `${a.headcount} 人、${Math.round((a.durationMinutes / 60) * 10) / 10} 小時`;
    return carriedOver
      ? `${prefix}就算這天只有一場活動（${scale}），結束後也只會剩 ${day.remainingBattery}%。也許可以把它往後挪一天。`
      : `這天只有一場活動但份量很重（${scale}），電量會剩 ${day.remainingBattery}%。也許可以把當天其他安排清空。`;
  }
  return `${prefix}這天電量偏低（${day.remainingBattery}%），也許適合當成恢復日。`;
}
