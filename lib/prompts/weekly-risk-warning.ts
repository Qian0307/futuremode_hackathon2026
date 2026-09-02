import { SAFETY_CLAUSE } from "@/lib/safety";
import { localTime } from "@/lib/time";
import type { Activity, PersonalityProfile } from "@/lib/types";

/**
 * Track C2：一週風險預警 prompt。
 * 輸入一週 7 天的活動與剩餘電量，輸出「只針對低電量日」的具體、可執行的建議。
 */
export const WEEKLY_RISK_SYSTEM_PROMPT = `
你是「社交電量計」的一週行程顧問。使用者會給你未來 7 天的社交活動與每天預估的剩餘電量，
你要挑出電量偏低（低於 30%）的日子，給出具體、可以馬上執行的調整建議。

【語氣要求】
- 溫暖、像一個懂你的朋友，不是治療師也不是效率教練。
- 絕對不評判。不要說「你安排太多了」「你應該學會拒絕」這類指責句。
- 用「也許可以…」「要不要試試…」這種留有餘地的說法。
- 使用繁體中文。

【建議要具體】
- 好的建議：「週三下午的會議和晚上的聚餐中間有 90 分鐘，可以找個安靜的地方戴耳機待 30 分鐘再出發。」
- 壞的建議：「記得好好休息。」（沒有資訊量，不要輸出這種）
- 可以建議的方向：在兩場活動之間插入獨處緩衝、把某場活動改期到電量高的日子、
  縮短時長、提早離場的說法、當天其他時段清空。
- 若使用者的充電方式是 specific_people，可以建議把某場高消耗活動換成和熟人的低壓相處。

【輸出要求｜嚴格遵守】
- 只輸出一個 JSON 物件，不要 markdown 程式碼區塊、不要多餘文字。
- 格式：{"warnings": [{"date": "YYYY-MM-DD", "message": "<一到兩句話，60 字以內>"}]}
- 只針對剩餘電量低於 30 的日子產生 warning；沒有這種日子就回傳 {"warnings": []}。
- warnings 依日期由早到晚排序。

${SAFETY_CLAUSE}
`.trim();

export interface WeeklyDayInput {
  date: string; // YYYY-MM-DD
  remainingBattery: number; // 0-100
  activities: Pick<Activity, "type" | "headcount" | "familiarity" | "durationMinutes" | "scheduledAt" | "predictedDrain">[];
}

export function buildWeeklyRiskUserPrompt(profile: PersonalityProfile, days: WeeklyDayInput[]): string {
  const typeLabel: Record<string, string> = {
    meal: "吃飯聚餐",
    meeting: "會議",
    date: "約會",
    class: "上課",
    party: "派對",
    other: "其他",
  };
  const rechargeLabel: Record<string, string> = {
    solitude: "獨處才能充電",
    specific_people: "和特定的少數人相處可以充電",
    mixed: "混合型",
  };

  const lines: string[] = [
    "【使用者人格】",
    `- 基礎電池容量：${profile.baseBatteryCapacity} / 100`,
    `- 人格摘要：${profile.summary}`,
    `- 充電方式：${rechargeLabel[profile.rechargeStyle] ?? profile.rechargeStyle}`,
    "",
    "【未來 7 天】",
  ];

  for (const day of days) {
    lines.push(`${day.date}（當天結束時剩餘電量 ${day.remainingBattery}%）`);
    if (day.activities.length === 0) {
      lines.push("  - 沒有安排社交活動");
      continue;
    }
    for (const a of day.activities) {
      const time = localTime(a.scheduledAt);
      lines.push(
        `  - ${time} ${typeLabel[a.type] ?? a.type}｜${a.headcount} 人｜熟悉度 ${a.familiarity}/5｜` +
          `${a.durationMinutes} 分鐘｜預估消耗 ${a.predictedDrain}%`
      );
    }
  }

  lines.push("", "請針對剩餘電量低於 30% 的日子給建議，只輸出 JSON。");
  return lines.join("\n");
}
