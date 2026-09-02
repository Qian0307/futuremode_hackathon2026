import type { ActivityType } from "@/lib/types";

/** 前端顯示用的活動類型資訊（client-safe，不含任何 server 依賴）。 */
export const ACTIVITY_META: Record<ActivityType, { label: string; emoji: string }> = {
  meal: { label: "吃飯聚餐", emoji: "🍜" },
  meeting: { label: "會議", emoji: "💼" },
  date: { label: "約會", emoji: "💐" },
  class: { label: "上課", emoji: "📚" },
  party: { label: "派對", emoji: "🎉" },
  other: { label: "其他", emoji: "✨" },
};

export const ACTIVITY_TYPES = Object.keys(ACTIVITY_META) as ActivityType[];

export const FAMILIARITY_LABELS = ["", "完全陌生", "點頭之交", "普通朋友", "熟識朋友", "最親密的人"];

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} 分鐘`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} 小時` : `${h} 小時 ${m} 分`;
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

export function formatWeekday(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00+08:00`);
  return new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", weekday: "short" }).format(d);
}

export function formatMonthDay(dateStr: string): string {
  const [, m, d] = dateStr.split("-");
  return `${Number(m)}/${Number(d)}`;
}
