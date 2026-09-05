import { SAFETY_CLAUSE } from "@/lib/safety";
import type { PersonalityProfile } from "@/lib/types";

/**
 * 回顧系統 prompt。
 * 輸入過去 7 天「預測 vs 實際」的資料，輸出一段溫暖、有具體發現的回顧。
 * 重點是讓使用者看見「系統正在認識我」，而不是被打分數。
 */
export const WEEKLY_REVIEW_SYSTEM_PROMPT = `
你是「社交電量計」的週回顧夥伴。使用者會給你過去 7 天的社交活動，
以及每一場「當初預測消耗多少」與「事後回報的實際消耗」。你要寫一段簡短的回顧。

【你要找的東西】
1. 系統在哪一類活動上「低估」了（實際比預測高）——這通常是使用者最需要警覺的類型。
2. 哪一類活動其實沒有想像中累（實際比預測低）——這是使用者可以放心多安排的。
3. 有沒有「連續高強度」的段落，以及它之後的日子表現如何。
4. 使用者的充電方式是否在資料裡得到印證。

【語氣要求｜非常重要】
- 這是回顧，不是評分。絕對不要用「你做得不夠好」「你應該」「太多了」這類句子。
- 不要恭喜也不要責備，就是把觀察講出來，像一個記性很好的朋友。
- 要具體到「哪一類活動」「差了幾個百分點」，不要寫「你這週有點累」這種空話。
- 使用繁體中文。

【輸出要求｜嚴格遵守】
- 只輸出一個 JSON 物件，不要 markdown 程式碼區塊、不要多餘文字。
- 格式：{"headline": "<一句話總結，30 字內>",
  "observations": ["<具體觀察，60 字內>", ...最多 3 則],
  "suggestion": "<給下週的一個具體建議，60 字內>"}
- observations 每一則都要有數字或活動類型，沒有資料支持的話寧可少寫一則。
- 若回報過的活動少於 2 筆，headline 就說明「資料還太少」，
  observations 給空陣列，suggestion 鼓勵使用者多回報幾次（但不要說教）。

${SAFETY_CLAUSE}
`.trim();

export interface ReviewActivityInput {
  date: string;
  typeLabel: string;
  headcount: number;
  familiarity: number;
  durationMinutes: number;
  predictedDrain: number;
  actualDrain: number | null;
}

export function buildWeeklyReviewUserPrompt(
  profile: PersonalityProfile,
  activities: ReviewActivityInput[],
  accuracy: { reported: number; avgError: number | null; overestimated: number; underestimated: number }
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
    "【過去 7 天】",
  ];

  if (activities.length === 0) {
    lines.push("（沒有任何活動紀錄）");
  } else {
    for (const a of activities) {
      const actual = a.actualDrain === null ? "尚未回報" : `${a.actualDrain}%`;
      const diff =
        a.actualDrain === null ? "" : `｜差距 ${a.actualDrain - a.predictedDrain > 0 ? "+" : ""}${a.actualDrain - a.predictedDrain}`;
      lines.push(
        `- ${a.date} ${a.typeLabel}｜${a.headcount} 人｜熟悉度 ${a.familiarity}/5｜${a.durationMinutes} 分鐘` +
          `｜預測 ${a.predictedDrain}%｜實際 ${actual}${diff}`
      );
    }
  }

  lines.push(
    "",
    "【統計】",
    `- 已回報筆數：${accuracy.reported}`,
    `- 平均誤差：${accuracy.avgError === null ? "無" : `${accuracy.avgError} 個百分點`}`,
    `- 系統高估次數：${accuracy.overestimated}｜低估次數：${accuracy.underestimated}`,
    "",
    "請寫這週的回顧，只輸出 JSON。"
  );

  return lines.join("\n");
}
