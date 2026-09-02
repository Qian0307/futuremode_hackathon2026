#!/usr/bin/env node
/**
 * 由 db/demo-scenario.json 產生 db/seed.sql。
 * 日期會依「執行當下的今天」換算，所以 demo 前重新跑一次就永遠是未來 7 天的資料。
 *
 * 用法：npx tsx scripts/generate-seed.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
// 刻意 import 正式程式碼的電量模型，確保驗證與 runtime 用的是同一套算法
import { isLowBattery, simulateWeek } from "../lib/battery";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const scenario = JSON.parse(readFileSync(join(root, "db/demo-scenario.json"), "utf8"));

const TZ_OFFSET = "+08:00"; // Asia/Taipei

function taipeiToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00${TZ_OFFSET}`);
  d.setUTCDate(d.getUTCDate() + days);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

const q = (v: unknown) => (v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);

const today = taipeiToday();
const now = new Date().toISOString();
const { persona, profile, activities } = scenario;

const lines = [
  `-- 由 scripts/generate-seed.mjs 自動產生於 ${now}`,
  `-- 情境：${persona.name}｜${persona.note}`,
  `-- 基準日（今天）：${today}`,
  "",
  "DELETE FROM activities WHERE user_id = 'demo-user';",
  "DELETE FROM users WHERE id = 'demo-user';",
  "",
  "INSERT INTO users (id, anonymous_session_id, personality_profile, base_battery_capacity, created_at) VALUES (" +
    [
      q(persona.userId),
      q(persona.anonymousSessionId),
      q(JSON.stringify(profile)),
      profile.baseBatteryCapacity,
      q(now),
    ].join(", ") +
    ");",
  "",
];

activities.forEach((a: any, i: number) => {
  const date = addDays(today, a.dayOffset);
  const scheduledAt = new Date(`${date}T${a.time}:00${TZ_OFFSET}`).toISOString();
  lines.push(
    `-- D+${a.dayOffset} ${a.time}｜${a.note ?? ""}`,
    "INSERT INTO activities (id, user_id, type, headcount, familiarity, duration_minutes, scheduled_at, predicted_drain, actual_drain, created_at) VALUES (" +
      [
        q(`demo-activity-${String(i + 1).padStart(2, "0")}`),
        q(persona.userId),
        q(a.type),
        a.headcount,
        a.familiarity,
        a.durationMinutes,
        q(scheduledAt),
        a.predictedDrain,
        a.actualDrain === null ? "NULL" : a.actualDrain,
        q(now),
      ].join(", ") +
      ");",
    ""
  );
});

// 驗證：用正式的電量模型（含跨日累積）算出每天電量，確認與 demo-scenario.json 的預期一致
const perDay = new Map<number, number>();
for (const a of activities as any[]) {
  perDay.set(a.dayOffset, (perDay.get(a.dayOffset) ?? 0) + a.predictedDrain);
}
const drains = Array.from({ length: 7 }, (_, i) => perDay.get(i) ?? 0);
const battery = simulateWeek(drains, profile.baseBatteryCapacity);
const lowDays = battery.map((b, i) => (isLowBattery(b.remainingBattery) ? i : -1)).filter((i) => i >= 0);

writeFileSync(join(root, "db/seed.sql"), lines.join("\n"));

console.log(`已產生 db/seed.sql（基準日 ${today}，共 ${activities.length} 筆活動）`);
console.log("\n每日電量（含跨日累積）：");
battery.forEach((b, i) =>
  console.log(
    `  D+${i}  起床 ${String(b.startBattery).padStart(2)}%  消耗 ${String(drains[i]).padStart(2)}` +
      `  ->  剩 ${String(b.remainingBattery).padStart(2)}%${isLowBattery(b.remainingBattery) ? "  ⚠" : ""}`
  )
);
console.log(`\n低電量日 D+[${lowDays.join(", ")}]，預期 D+[${scenario.expected.lowBatteryDayOffsets.join(", ")}]`);
if (JSON.stringify(lowDays) !== JSON.stringify(scenario.expected.lowBatteryDayOffsets)) {
  console.error("✗ 低電量日與 demo-scenario.json 的預期不符，請檢查資料設計");
  process.exit(1);
}
console.log("✓ demo 資料符合預期（至少 2 天會觸發風險提醒）");
