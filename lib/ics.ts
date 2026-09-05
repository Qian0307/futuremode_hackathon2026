import { ACTIVITY_META, formatDuration } from "@/lib/activity-meta";
import { LOW_BATTERY_THRESHOLD } from "@/lib/battery";
import type { DaySummary } from "@/lib/week";
import type { Activity, PersonalityProfile } from "@/lib/types";

/**
 * 產生 iCalendar (RFC 5545) 內容，供 Apple 行事曆 / Google 日曆訂閱。
 *
 * 兩種事件：
 * 1. 每一場社交活動 -> VEVENT，標題帶預估消耗，描述含電量細節
 * 2. 每一個低電量日 -> 一則全天事件，把 AI 的風險預警帶進行事曆
 */

const PRODID = "-//Social Battery Meter//TW//ZH";

/** ICS 規定每行不得超過 75 octets，超過要用「換行 + 一個空白」折行。 */
function foldLine(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 73) return line;

  const out: string[] = [];
  let current = "";
  let currentBytes = 0;
  for (const char of Array.from(line)) {
    const size = new TextEncoder().encode(char).length;
    if (currentBytes + size > 73) {
      out.push(current);
      current = " "; // 續行以空白開頭
      currentBytes = 1;
    }
    current += char;
    currentBytes += size;
  }
  out.push(current);
  return out.join("\r\n");
}

/** ICS 的文字欄位要跳脫反斜線、分號、逗號與換行。 */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Date -> ICS 的 UTC 時間戳格式 20260904T130000Z */
function toIcsUtc(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** "YYYY-MM-DD" -> ICS 全天事件用的 20260904 */
function toIcsDate(dateStr: string): string {
  return dateStr.replace(/-/g, "");
}

function addDaysToDateStr(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface BuildIcsOptions {
  days: DaySummary[];
  profile: PersonalityProfile;
  /** 用來組出穩定的 UID domain */
  calendarName?: string;
  now?: Date;
}

export function buildIcs({ days, profile, calendarName = "社交電量計", now = new Date() }: BuildIcsOptions): string {
  const stamp = toIcsUtc(now);
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PRODID}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(calendarName)}`,
    "X-WR-TIMEZONE:Asia/Taipei",
    // 建議行事曆用戶端每小時重新抓一次
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];

  for (const day of days) {
    for (const activity of day.activities) {
      lines.push(...buildActivityEvent(activity, day, stamp));
    }
    if (day.isLow) {
      lines.push(...buildWarningEvent(day, profile, stamp));
    }
  }

  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

function buildActivityEvent(activity: Activity, day: DaySummary, stamp: string): string[] {
  const start = new Date(activity.scheduledAt);
  const end = new Date(start.getTime() + activity.durationMinutes * 60_000);
  const meta = ACTIVITY_META[activity.type];
  const drain = activity.actualDrain ?? activity.predictedDrain;
  const drainLabel = activity.actualDrain !== null ? "實際" : "預估";

  const description = [
    `${drainLabel}消耗 ${drain}% 電量`,
    `${activity.headcount} 人・熟悉度 ${activity.familiarity}/5・${formatDuration(activity.durationMinutes)}`,
    `這天結束後預計剩下 ${day.remainingBattery}%`,
  ].join("\n");

  return [
    "BEGIN:VEVENT",
    `UID:activity-${activity.id}@social-battery-meter`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${toIcsUtc(start)}`,
    `DTEND:${toIcsUtc(end)}`,
    `SUMMARY:${escapeText(`${meta.emoji} ${meta.label}（-${drain}%）`)}`,
    `DESCRIPTION:${escapeText(description)}`,
    "TRANSP:OPAQUE",
    "END:VEVENT",
  ];
}

function buildWarningEvent(day: DaySummary, profile: PersonalityProfile, stamp: string): string[] {
  const carried = day.startBattery < profile.baseBatteryCapacity;
  const summary = `🪫 電量預警：這天只剩 ${day.remainingBattery}%`;
  const description = [
    day.warning ?? `這天電量會低於 ${LOW_BATTERY_THRESHOLD}%，記得留一點獨處時間。`,
    "",
    `起床 ${day.startBattery}% → 結束 ${day.remainingBattery}%`,
    carried ? "（起床就沒滿電，是前一天的赤字帶過來的）" : "",
  ]
    .filter(Boolean)
    .join("\n");

  return [
    "BEGIN:VEVENT",
    `UID:warning-${day.date}@social-battery-meter`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${toIcsDate(day.date)}`,
    `DTEND;VALUE=DATE:${toIcsDate(addDaysToDateStr(day.date, 1))}`,
    `SUMMARY:${escapeText(summary)}`,
    `DESCRIPTION:${escapeText(description)}`,
    "TRANSP:TRANSPARENT",
    "END:VEVENT",
  ];
}
