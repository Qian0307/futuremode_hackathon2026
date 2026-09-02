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
