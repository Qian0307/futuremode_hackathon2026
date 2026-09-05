import "server-only";

import { chatJson } from "@/lib/ai";
import { ACTIVITY_META } from "@/lib/activity-meta";
import {
  buildWeeklyReviewUserPrompt,
  WEEKLY_REVIEW_SYSTEM_PROMPT,
  type ReviewActivityInput,
} from "@/lib/prompts/weekly-review";
import { weeklyReviewSchema } from "@/lib/schemas";
import { localDate } from "@/lib/time";
import type { Activity, ActivityType, PersonalityProfile } from "@/lib/types";

export interface AccuracyStats {
  /** 已回報實際消耗的活動數 */
  reported: number;
  /** 平均絕對誤差（百分點），沒有資料時為 null */
  avgError: number | null;
  overestimated: number;
  underestimated: number;
}

export interface TypeBreakdown {
  type: ActivityType;
  label: string;
  count: number;
  avgPredicted: number;
  avgActual: number | null;
  /** 正值代表系統低估了（實際比預測高） */
  bias: number | null;
}

export interface ReviewSummary {
  headline: string;
  observations: string[];
  suggestion: string;
  source: "ai" | "rule";
}

export function computeAccuracy(activities: Activity[]): AccuracyStats {
  const reported = activities.filter((a) => a.actualDrain !== null);
  if (reported.length === 0) {
    return { reported: 0, avgError: null, overestimated: 0, underestimated: 0 };
  }
  const errors = reported.map((a) => (a.actualDrain as number) - a.predictedDrain);
  const avgError = Math.round((errors.reduce((s, e) => s + Math.abs(e), 0) / errors.length) * 10) / 10;
  return {
    reported: reported.length,
    avgError,
    overestimated: errors.filter((e) => e < 0).length,
    underestimated: errors.filter((e) => e > 0).length,
  };
}

/** 依活動類型統計，找出系統在哪一類活動上偏得最多。 */
export function computeTypeBreakdown(activities: Activity[]): TypeBreakdown[] {
  const byType = new Map<ActivityType, Activity[]>();
  for (const a of activities) {
    const list = byType.get(a.type) ?? [];
    list.push(a);
    byType.set(a.type, list);
  }

  const rows: TypeBreakdown[] = [];
  for (const [type, list] of Array.from(byType.entries())) {
    const reported = list.filter((a) => a.actualDrain !== null);
    const avgPredicted = Math.round(list.reduce((s, a) => s + a.predictedDrain, 0) / list.length);
    const avgActual =
      reported.length === 0
        ? null
        : Math.round(reported.reduce((s, a) => s + (a.actualDrain as number), 0) / reported.length);
    rows.push({
      type,
      label: ACTIVITY_META[type].label,
      count: list.length,
      avgPredicted,
      avgActual,
      bias: avgActual === null ? null : avgActual - avgPredicted,
    });
  }
  return rows.sort((a, b) => b.count - a.count);
}

/** 產生回顧文字。AI 失敗就用統計數字組出規則式版本，頁面一定有內容。 */
export async function buildReviewSummary(
  profile: PersonalityProfile,
  activities: Activity[],
  accuracy: AccuracyStats,
  breakdown: TypeBreakdown[]
): Promise<ReviewSummary> {
  const input: ReviewActivityInput[] = activities.map((a) => ({
    date: localDate(a.scheduledAt),
    typeLabel: ACTIVITY_META[a.type].label,
    headcount: a.headcount,
    familiarity: a.familiarity,
    durationMinutes: a.durationMinutes,
    predictedDrain: a.predictedDrain,
    actualDrain: a.actualDrain,
  }));

  const raw = await chatJson({
    systemPrompt: WEEKLY_REVIEW_SYSTEM_PROMPT,
    userPrompt: buildWeeklyReviewUserPrompt(profile, input, accuracy),
    temperature: 0.6,
    maxTokens: 500,
  });

  const parsed = raw === null ? null : weeklyReviewSchema.safeParse(raw);
  if (parsed?.success) {
    return { ...parsed.data, source: "ai" };
  }
  return { ...ruleBasedReview(activities, accuracy, breakdown), source: "rule" };
}

function ruleBasedReview(
  activities: Activity[],
  accuracy: AccuracyStats,
  breakdown: TypeBreakdown[]
): Omit<ReviewSummary, "source"> {
  if (activities.length === 0) {
    return {
      headline: "這週沒有社交活動紀錄",
      observations: [],
      suggestion: "下次安排活動時加進來，一週後就會有第一份回顧。",
    };
  }
  if (accuracy.reported < 2) {
    return {
      headline: "資料還太少，先累積幾筆回報",
      observations: [`這週有 ${activities.length} 場活動，其中 ${accuracy.reported} 場回報了實際消耗。`],
      suggestion: "活動結束後花三秒點一下「比預期多／差不多／少」，預測就會開始貼近你。",
    };
  }

  const observations: string[] = [];
  const withBias = breakdown.filter((b) => b.bias !== null) as (TypeBreakdown & { bias: number })[];
  const worst = withBias.slice().sort((a, b) => b.bias - a.bias)[0];
  const best = withBias.slice().sort((a, b) => a.bias - b.bias)[0];

  if (worst && worst.bias > 0) {
    observations.push(`${worst.label}比預估更耗電，平均高出 ${worst.bias} 個百分點。`);
  }
  if (best && best.bias < 0) {
    observations.push(`${best.label}其實沒那麼累，平均比預估低 ${Math.abs(best.bias)} 個百分點。`);
  }
  if (accuracy.avgError !== null) {
    observations.push(`這週的平均誤差是 ${accuracy.avgError} 個百分點，回報越多會越準。`);
  }

  const suggestion =
    worst && worst.bias > 0
      ? `下週安排${worst.label}時，記得後面留一段獨處的緩衝。`
      : "維持現在的節奏就好，繼續回報幾次讓預測更貼近你。";

  return {
    headline: `這週有 ${activities.length} 場社交，回報了 ${accuracy.reported} 場`,
    observations: observations.slice(0, 3),
    suggestion,
  };
}
