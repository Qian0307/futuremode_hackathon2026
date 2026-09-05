import { errorMessage } from "@/lib/http";
import type { Activity, PersonalityProfile } from "@/lib/types";

/** GET /api/activities/week 的回應型別（client 端使用，避免 import 到 server-only 模組）。 */
export interface DaySummaryDTO {
  date: string;
  activities: Activity[];
  totalDrain: number;
  /** 當天起床時的電量；低於基礎容量代表前一天的赤字被帶過來了 */
  startBattery: number;
  remainingBattery: number;
  isLow: boolean;
  warning: string | null;
}

export interface WeekResponse {
  profile: PersonalityProfile;
  startDate: string;
  days: DaySummaryDTO[];
  totalActivities: number;
}

export interface CreateActivityInput {
  type: Activity["type"];
  headcount: number;
  familiarity: Activity["familiarity"];
  durationMinutes: number;
  /** datetime-local 的 "YYYY-MM-DDTHH:mm"，由後端補上台北時區 */
  scheduledAt: string;
}

export interface CreateActivityResponse {
  activity: Activity;
  /** 規則式估算的說明，立刻可顯示 */
  reason: string;
  source: "rule";
  /** true = 後端正在背景用 AI 重算，稍後 refetch 會拿到修正後的數字 */
  refining: boolean;
}

export async function createActivity(input: CreateActivityInput): Promise<CreateActivityResponse> {
  const res = await fetch("/api/activities", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) throw new Error(await errorMessage(res, "新增失敗"));
  return (await res.json()) as CreateActivityResponse;
}

export class UnauthorizedError extends Error {
  constructor() {
    super("尚未完成人格快篩");
    this.name = "UnauthorizedError";
  }
}

export async function fetchWeek(options?: { warnings?: boolean }): Promise<WeekResponse> {
  const qs = options?.warnings === false ? "?warnings=0" : "";
  const res = await fetch(`/api/activities/week${qs}`, { cache: "no-store" });
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) throw new Error(await errorMessage(res, "讀取失敗"));
  return (await res.json()) as WeekResponse;
}

export async function reportActualDrain(activityId: string, feedback: "more" | "same" | "less") {
  const res = await fetch(`/api/activities/${activityId}/actual-drain`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ feedback }),
  });
  if (!res.ok) throw new Error(await errorMessage(res, "回報失敗"));
  return (await res.json()) as {
    activity: Activity;
    baseBatteryCapacity: number;
    capacityChanged: boolean;
  };
}

/** 台北時區的今天（YYYY-MM-DD） */
export function todayInTaipei(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/* ------------------------------------------------------------------ */
/* Track D：語音輸入                                                    */
/* ------------------------------------------------------------------ */

export interface ParsedVoiceActivity {
  type: Activity["type"];
  headcount: number;
  familiarity: number;
  durationMinutes: number;
  /** "YYYY-MM-DDTHH:mm"，可直接餵給 datetime-local */
  scheduledAt: string;
  /** AI 用預設值猜的欄位，前端提示使用者確認 */
  uncertainFields: string[];
}

export type ParseVoiceResult =
  | { crisis: true; message: string }
  | { crisis?: false; activity: ParsedVoiceActivity; source: "ai" | "rule" };

export async function parseVoiceActivity(transcript: string): Promise<ParseVoiceResult> {
  const res = await fetch("/api/parse-voice-activity", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transcript }),
  });
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) throw new Error(await errorMessage(res, "無法解析這段語音"));
  return (await res.json()) as ParseVoiceResult;
}

/* ------------------------------------------------------------------ */
/* 回顧系統                                                             */
/* ------------------------------------------------------------------ */

export interface AccuracyStatsDTO {
  reported: number;
  avgError: number | null;
  overestimated: number;
  underestimated: number;
}

export interface TypeBreakdownDTO {
  type: Activity["type"];
  label: string;
  count: number;
  avgPredicted: number;
  avgActual: number | null;
  /** 正值 = 系統低估（實際比預測高） */
  bias: number | null;
}

export interface ReviewResponse {
  profile: PersonalityProfile;
  startDate: string;
  endDate: string;
  activities: Activity[];
  accuracy: AccuracyStatsDTO;
  breakdown: TypeBreakdownDTO[];
  summary: { headline: string; observations: string[]; suggestion: string; source: "ai" | "rule" } | null;
}

export async function fetchReview(): Promise<ReviewResponse> {
  const res = await fetch("/api/review/week", { cache: "no-store" });
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) throw new Error(await errorMessage(res, "讀取回顧失敗"));
  return (await res.json()) as ReviewResponse;
}

/* ------------------------------------------------------------------ */
/* 排日程系統                                                           */
/* ------------------------------------------------------------------ */

export interface ScheduleSuggestionDTO {
  date: string;
  startTime: string;
  reason: string;
  rating: "best" | "ok" | "avoid";
}

export type ScheduleSuggestResponse =
  | { crisis: true; message: string }
  | {
      crisis?: false;
      activity: ParsedVoiceActivity | CreateActivityInput;
      suggestions: ScheduleSuggestionDTO[];
      estimatedDrain: number;
      source: "ai" | "rule";
    };

export async function suggestSchedule(
  input: { description: string } | { activity: Omit<CreateActivityInput, "scheduledAt"> }
): Promise<ScheduleSuggestResponse> {
  const res = await fetch("/api/schedule-suggest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) throw new Error(await errorMessage(res, "產生建議失敗"));
  return (await res.json()) as ScheduleSuggestResponse;
}

/* ------------------------------------------------------------------ */
/* Apple 日曆訂閱                                                       */
/* ------------------------------------------------------------------ */

export interface CalendarSubscription {
  token: string;
  url: string;
  webcalUrl: string;
}

export async function fetchCalendarSubscription(): Promise<CalendarSubscription> {
  const res = await fetch("/api/calendar/subscribe", { method: "POST" });
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) throw new Error(await errorMessage(res, "無法取得訂閱網址"));
  return (await res.json()) as CalendarSubscription;
}
