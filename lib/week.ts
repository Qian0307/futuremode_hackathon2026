import { chatJson } from "@/lib/ai";
import { buildWeeklyRiskUserPrompt, WEEKLY_RISK_SYSTEM_PROMPT, type WeeklyDayInput } from "@/lib/prompts/weekly-risk-warning";
import { weeklyWarningsSchema } from "@/lib/schemas";
import { CRISIS_RESPONSE, detectCrisis } from "@/lib/safety";
import { addDays, localDate, localTime } from "@/lib/time";
import type { Activity, PersonalityProfile } from "@/lib/types";

export { addDays, localDate, TIME_ZONE } from "@/lib/time";

export const LOW_BATTERY_THRESHOLD = 30;

export interface DaySummary {
  date: string; // YYYY-MM-DD
  activities: Activity[];
  totalDrain: number;
  remainingBattery: number;
  isLow: boolean;
  warning: string | null;
}

/**
 * 把活動依日期分組，算出每天結束時的剩餘電量。
 * 模型假設：每天睡飽後電量回到基礎容量，當天的活動依序扣除。
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

  const result: DaySummary[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(startDate, i);
    const dayActivities = (byDate.get(date) ?? []).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
    const totalDrain = dayActivities.reduce((sum, a) => sum + (a.actualDrain ?? a.predictedDrain), 0);
    const remainingBattery = Math.max(0, Math.min(100, profile.baseBatteryCapacity - totalDrain));
    result.push({
      date,
      activities: dayActivities,
      totalDrain,
      remainingBattery,
      isLow: remainingBattery < LOW_BATTERY_THRESHOLD,
      warning: null,
    });
  }
  return result;
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
    return days.map((d) => (d.isLow ? { ...d, warning: ruleBasedWarning(d) } : d));
  }

  const map = new Map(parsed.data.warnings.map((w) => [w.date, w.message]));
  return days.map((d) => (d.isLow ? { ...d, warning: map.get(d.date) ?? ruleBasedWarning(d) } : d));
}

/** AI 不可用時的預警文字（仍要具體，不能只寫「記得休息」）。 */
function ruleBasedWarning(day: DaySummary): string {
  const count = day.activities.length;
  if (count >= 2) {
    const first = localTime(day.activities[0].scheduledAt);
    const last = localTime(day.activities[count - 1].scheduledAt);
    return `這天從 ${first} 到 ${last} 有 ${count} 場社交，電量會剩下 ${day.remainingBattery}%。要不要在中間留 30 分鐘一個人透透氣？`;
  }
  if (count === 1) {
    const a = day.activities[0];
    return `這天只有一場活動但份量很重（${a.headcount} 人、${Math.round(a.durationMinutes / 60 * 10) / 10} 小時），電量會剩 ${day.remainingBattery}%。也許可以把當天其他安排清空。`;
  }
  return `這天電量偏低（${day.remainingBattery}%），也許適合當成恢復日。`;
}
