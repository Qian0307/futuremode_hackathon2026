import { SAFETY_CLAUSE } from "@/lib/safety";
import type { PersonalityProfile } from "@/lib/types";

/**
 * 排日程系統 prompt。
 * 輸入：使用者想安排的一場活動 + 未來 7 天的電量狀況。
 * 輸出：建議排在哪一天的哪個時段，以及為什麼。
 *
 * 這是產品從「事後預警」走向「事前規劃」的關鍵——
 * 不只告訴你哪天會沒電，而是幫你把活動放在不會沒電的位置。
 */
export const SCHEDULE_SUGGEST_SYSTEM_PROMPT = `
你是「社交電量計」的行程規劃師。使用者想安排一場社交活動，
你要根據他未來 7 天的電量狀況，建議把它排在哪一天的哪個時段。

【電量會跨日累積｜判讀資料的關鍵】
每天會給你「起床電量」與「結束時電量」。睡一覺只能回充大約八成，
所以前一天燒到見底的話，隔天起床就不是滿電。
- 不要把活動排在「起床電量已經偏低」的日子，那等於雪上加霜。
- 也不要排在「某個重量級活動的隔天」，即使那天看起來是空的。
- 空白的日子不一定就是好日子，要看它前一天的狀況。

【評分規則】
- rating = "best"：這天排進去之後，結束電量仍在 40% 以上，而且隔天不會被拖累。
- rating = "ok"：排得進去但結束電量會落在 20-40%，需要提醒使用者留緩衝。
- rating = "avoid"：排進去會低於 20%，或這天本來就已經是低電量日。
- 至少要給 3 個建議，最多 7 個，依日期由早到晚排列。
- 如果整週都是 avoid，照樣誠實給出來，並在 reason 裡說明「這週可能不適合，考慮排到下週」。

【時段選擇】
- 同一天已有活動時，建議的時間要跟現有活動錯開，中間至少留 90 分鐘緩衝。
- 高消耗的活動盡量排在當天最後（結束後就可以回家休息），
  低消耗的可以排在白天。
- 時間格式為 "HH:mm"，合理範圍是 08:00 到 21:00。

【語氣】
- reason 要具體講出「為什麼是這天這個時間」，不要寫「這天比較適合」這種空話。
- 溫暖、不評判，不要說「你排太滿了」。
- 使用繁體中文。

【輸出要求｜嚴格遵守】
- 只輸出一個 JSON 物件，不要 markdown 程式碼區塊、不要多餘文字。
- 格式：{"suggestions": [{"date": "YYYY-MM-DD", "startTime": "HH:mm",
  "reason": "<一到兩句話，60 字內>", "rating": "best" | "ok" | "avoid"}]}

${SAFETY_CLAUSE}
`.trim();

export interface ScheduleDayInput {
  date: string;
  weekday: string;
  startBattery: number;
  remainingBattery: number;
  existing: { time: string; label: string; drain: number }[];
}

export function buildScheduleSuggestUserPrompt(
  profile: PersonalityProfile,
  activityLabel: string,
  estimatedDrain: number,
  days: ScheduleDayInput[]
): string {
  const rechargeLabel: Record<string, string> = {
    solitude: "獨處才能充電",
    specific_people: "和特定的少數人相處可以充電",
    mixed: "混合型",
  };

  const lines = [
    "【使用者人格】",
    `- 基礎電池容量：${profile.baseBatteryCapacity} / 100`,
    `- 充電方式：${rechargeLabel[profile.rechargeStyle] ?? profile.rechargeStyle}`,
    "",
    "【想安排的活動】",
    `- ${activityLabel}`,
    `- 預估會消耗 ${estimatedDrain}% 電量`,
    "",
    "【未來 7 天的電量】",
  ];

  for (const d of days) {
    lines.push(`${d.date}（${d.weekday}）起床 ${d.startBattery}% -> 結束 ${d.remainingBattery}%`);
    if (d.existing.length === 0) {
      lines.push("  - 目前沒有安排");
    } else {
      for (const e of d.existing) {
        lines.push(`  - ${e.time} ${e.label}（消耗 ${e.drain}%）`);
      }
    }
  }

  lines.push("", "請建議把這場活動排在哪天哪個時段，只輸出 JSON。");
  return lines.join("\n");
}
