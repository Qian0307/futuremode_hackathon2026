import { SAFETY_CLAUSE } from "@/lib/safety";
import { localTime } from "@/lib/time";
import type { Activity, PersonalityProfile } from "@/lib/types";

/**
 * Track C2：一週風險預警 prompt。
 * 輸入一週 7 天的活動與剩餘電量，輸出「只針對低電量日」的具體、可執行的建議。
 */
export const WEEKLY_RISK_SYSTEM_PROMPT = `
你是「社交電量計」的一週行程顧問。使用者會給你未來 7 天的社交活動與每天的電量，
你要挑出結束時電量偏低（低於 30%）的日子，給出具體、可以馬上執行的調整建議。

【電量會跨日累積｜這是判讀資料的關鍵】
每天會給你兩個數字：「起床電量」與「結束時電量」。睡一覺只能回充大約八成，
所以前一天燒到見底的話，隔天起床就不是滿電——這叫做把赤字帶到隔天。
- 如果某天的「起床電量」明顯低於基礎容量，那天電量低的**主因是前一天**，不是當天排太多。
  這種情況要針對「前一天」給建議（把前一天的活動拆開、縮短、或改期），
  而不是叫使用者把當天已經很輕的行程再砍掉。
- 如果起床是滿電但結束很低，才是當天本身排太滿。

【語氣要求】
- 溫暖、像一個懂你的朋友，不是治療師也不是效率教練。
- 絕對不評判。不要說「你安排太多了」「你應該學會拒絕」這類指責句。
- 用「也許可以…」「要不要試試…」這種留有餘地的說法。
- 使用繁體中文。

【建議必須具體｜這是最重要的要求】
每則 message 都必須包含**至少兩個從資料裡讀到的具體事實**，
例如實際時間（10:00）、人數（25 人）、時長（3 小時）、電量數字（剩 0%）、活動類型。
只講抽象建議一律視為不合格。

好的例子：
  「這天 10:00 的會議到 19:00 的派對之間有 4 小時空檔，可以找個安靜的地方戴耳機待 30 分鐘再出發，
    不然結束時會只剩 0%。」
  「前一天燒到 0%，這天起床只有 46%。就算只有一堂 30 人的課，結束也只剩 28%，
    也許可以把課往後挪一天。」

不合格的例子（絕對不要輸出這種）：
  「也許可以在會議和派對中間休息一下」（沒有任何數字，等於沒說）
  「前一天的活動可能太多，考慮調整」（沒指出是哪一場、也沒說調整什麼）
  「記得好好休息」（完全沒有資訊量）
  「約會前可以先休息一下」（沒說為什麼、休息多久）

可以建議的方向：在兩場活動之間插入具體長度的獨處緩衝、把某一場（要指名是哪一場）
改期到電量高的哪一天、縮短時長、提早離場的說法、當天其他時段清空。
若使用者的充電方式是 specific_people，可以建議把某場高消耗活動換成和熟人的低壓相處。

【輸出要求｜嚴格遵守】
- 只輸出一個 JSON 物件，不要 markdown 程式碼區塊、不要多餘文字。
- 格式：{"warnings": [{"date": "YYYY-MM-DD", "message": "<一到兩句話，60 字以內>"}]}
- 只針對剩餘電量低於 30 的日子產生 warning；沒有這種日子就回傳 {"warnings": []}。
- warnings 依日期由早到晚排序。

${SAFETY_CLAUSE}
`.trim();

export interface WeeklyDayInput {
  date: string; // YYYY-MM-DD
  startBattery: number; // 0-100，當天起床時的電量
  remainingBattery: number; // 0-100，當天結束時的電量
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
    const carried = day.startBattery < profile.baseBatteryCapacity ? "  ← 起床就沒滿電，赤字是前一天帶來的" : "";
    lines.push(`${day.date}（起床 ${day.startBattery}% -> 結束 ${day.remainingBattery}%）${carried}`);
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
