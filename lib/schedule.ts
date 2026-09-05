import "server-only";

import { chatJson } from "@/lib/ai";
import { ACTIVITY_META, FAMILIARITY_LABELS } from "@/lib/activity-meta";
import { simulateWeek } from "@/lib/battery";
import { ruleBasedDrain } from "@/lib/drain-rules";
import {
  buildScheduleSuggestUserPrompt,
  SCHEDULE_SUGGEST_SYSTEM_PROMPT,
  type ScheduleDayInput,
} from "@/lib/prompts/schedule-suggest";
import { scheduleSuggestionsSchema } from "@/lib/schemas";
import { localTime, TIME_ZONE } from "@/lib/time";
import type { DaySummary } from "@/lib/week";
import type { Activity, PersonalityProfile } from "@/lib/types";
import type { z } from "zod";

export type ScheduleSuggestion = z.infer<typeof scheduleSuggestionsSchema>["suggestions"][number];

export type ActivityShape = Pick<Activity, "type" | "headcount" | "familiarity" | "durationMinutes">;

export function describeActivity(a: ActivityShape): string {
  return (
    `${ACTIVITY_META[a.type].label}｜${a.headcount} 人｜` +
    `熟悉度 ${a.familiarity}/5（${FAMILIARITY_LABELS[a.familiarity] ?? ""}）｜${a.durationMinutes} 分鐘`
  );
}

function weekdayOf(date: string): string {
  return new Intl.DateTimeFormat("zh-TW", { timeZone: TIME_ZONE, weekday: "short" }).format(
    new Date(`${date}T00:00:00+08:00`)
  );
}

/**
 * 建議把一場活動排在哪天哪個時段。
 * AI 失敗時退回規則式排序，頁面永遠有建議可看。
 */
export async function suggestSchedule(
  profile: PersonalityProfile,
  activity: ActivityShape,
  days: DaySummary[]
): Promise<{ suggestions: ScheduleSuggestion[]; estimatedDrain: number; source: "ai" | "rule" }> {
  const estimatedDrain = ruleBasedDrain({ activity, profile }).predictedDrain;

  const input: ScheduleDayInput[] = days.map((d) => ({
    date: d.date,
    weekday: weekdayOf(d.date),
    startBattery: d.startBattery,
    remainingBattery: d.remainingBattery,
    existing: d.activities.map((a) => ({
      time: localTime(a.scheduledAt),
      label: ACTIVITY_META[a.type].label,
      drain: a.actualDrain ?? a.predictedDrain,
    })),
  }));

  const raw = await chatJson({
    systemPrompt: SCHEDULE_SUGGEST_SYSTEM_PROMPT,
    userPrompt: buildScheduleSuggestUserPrompt(profile, describeActivity(activity), estimatedDrain, input),
    temperature: 0.5,
    maxTokens: 800,
  });

  const parsed = raw === null ? null : scheduleSuggestionsSchema.safeParse(raw);
  if (parsed?.success && parsed.data.suggestions.length > 0) {
    return { suggestions: parsed.data.suggestions, estimatedDrain, source: "ai" };
  }

  return { suggestions: ruleBasedSuggestions(profile, days, estimatedDrain), estimatedDrain, source: "rule" };
}

/**
 * 規則式建議：把活動假想加進每一天，重新模擬整週電量，看哪天結果最好。
 * 這會自然把「重量級活動的隔天」排除掉，因為赤字會傳遞下去。
 */
function ruleBasedSuggestions(
  profile: PersonalityProfile,
  days: DaySummary[],
  estimatedDrain: number
): ScheduleSuggestion[] {
  const baseDrains = days.map((d) => d.totalDrain);

  return days.map((day, i) => {
    const trial = baseDrains.slice();
    trial[i] += estimatedDrain;
    const simulated = simulateWeek(trial, profile.baseBatteryCapacity);
    const remaining = simulated[i].remainingBattery;
    const nextDayStart = simulated[i + 1]?.startBattery ?? null;

    const rating: ScheduleSuggestion["rating"] =
      remaining >= 40 && (nextDayStart === null || nextDayStart >= profile.baseBatteryCapacity)
        ? "best"
        : remaining >= 20
          ? "ok"
          : "avoid";

    return {
      date: day.date,
      startTime: pickTime(day, estimatedDrain),
      rating,
      reason: buildReason(day, remaining, nextDayStart, profile, rating),
    };
  });
}

/** 跟當天既有活動錯開，並把高消耗的排在最後。 */
function pickTime(day: DaySummary, estimatedDrain: number): string {
  if (day.activities.length === 0) return estimatedDrain >= 40 ? "18:00" : "12:00";
  const lastEnd = day.activities.reduce((latest, a) => {
    const end = new Date(a.scheduledAt).getTime() + a.durationMinutes * 60_000;
    return Math.max(latest, end);
  }, 0);
  // 最後一場結束後再留 90 分鐘緩衝
  const candidate = new Date(lastEnd + 90 * 60_000);
  const hh = Number(localTime(candidate).slice(0, 2));
  if (hh > 21 || hh < 8) return "09:00"; // 太晚就建議改到當天早上
  return localTime(candidate);
}

function buildReason(
  day: DaySummary,
  remaining: number,
  nextDayStart: number | null,
  profile: PersonalityProfile,
  rating: ScheduleSuggestion["rating"]
): string {
  const carried = day.startBattery < profile.baseBatteryCapacity;
  const existing = day.activities.length;

  if (rating === "avoid") {
    if (carried) return `這天起床只有 ${day.startBattery}%（前一天的赤字），再加一場會掉到 ${remaining}%。`;
    if (existing > 0) return `這天已經有 ${existing} 場活動，再加進來會剩 ${remaining}%。`;
    return `加進來之後會剩 ${remaining}%，太低了。`;
  }
  if (rating === "ok") {
    return existing > 0
      ? `這天已有 ${existing} 場，排進來會剩 ${remaining}%，中間記得留緩衝。`
      : `排進來會剩 ${remaining}%，還可以，但當天別再加其他安排。`;
  }
  const tail = nextDayStart !== null && nextDayStart >= profile.baseBatteryCapacity ? "，而且隔天能睡回滿電" : "";
  return existing === 0
    ? `這天是空的、起床就滿電，排進來還會剩 ${remaining}%${tail}。`
    : `排進來還有 ${remaining}%，是這週比較從容的位置${tail}。`;
}
