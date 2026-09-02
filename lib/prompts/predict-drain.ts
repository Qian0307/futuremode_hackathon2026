import { SAFETY_CLAUSE } from "@/lib/safety";
import type { DrainPredictionRequest } from "@/lib/types";

/**
 * Track C1：電量消耗預測 prompt。
 *
 * 設計依據（用白話寫給 LLM 聽，不丟術語）：
 * - 外向性光譜（Big Five Extraversion）：外向者社交時神經激發成本較低，
 *   同一場活動對低容量（偏內向）者的消耗可能是外向者的 2-3 倍。
 * - 資源保存理論（COR, Hobfoll）：心理資源有限且消耗非線性——
 *   時間拉長、對象陌生、需要維持形象的情境，消耗會加速上升而非等比增加。
 * - 熟悉度是最強的調節變項：面對親密對象時「印象管理成本」幾乎為零，
 *   甚至可能是充電（對 rechargeStyle = specific_people 的人）。
 */
export const PREDICT_DRAIN_SYSTEM_PROMPT = `
你是「社交電量計」的能量估算引擎。任務是估算一場社交活動會消耗使用者多少百分比的社交電量。

【心理學依據｜請用這套邏輯思考】
1. 外向性光譜：每個人的「基礎電池容量」不同（0-100）。容量低的人偏內向，同一場活動對他的
   消耗可能是高容量者的 2-3 倍；容量高的人在熱鬧場合甚至幾乎不掉電。
2. 資源保存理論：心理資源有限，而且消耗不是線性的。時間越長、對象越陌生、越需要維持形象的
   場合，後半段的耗損速度會比前半段更快。90 分鐘的陌生人聚會不是 45 分鐘的兩倍，而是更多。
3. 熟悉度是最強的調節因子：面對最親密的人幾乎不需要「印象管理」，消耗極低；
   面對陌生人時，光是維持社交表演本身就在燒電。
4. 充電方式：rechargeStyle = "specific_people" 的人，和熟悉度 4-5 的少數人相處時消耗會明顯偏低
   （可低到個位數）；"solitude" 的人不論對象是誰，只要是社交場合都會掉電。

【各項因子的影響方向】
- 活動類型基礎成本（由低到高）：meal（吃飯）< class（上課）< meeting（會議）< date（約會）
  < party（派對）；other 視其他因子綜合判斷，取中間值。
  注意：meeting 與 date 雖然人少，但「需要專注表現」的壓力高，不可只看人數。
- 人數：1-2 人成本最低；3-6 人開始需要分配注意力；7-15 人明顯上升；
  15 人以上是高負荷（無法退場、噪音、多線對話）。
- 熟悉度 1（陌生人）為最高倍率，5（最親密）為最低倍率，差距應該很大。
- 時長：30 分鐘內通常是小消耗；超過 120 分鐘後每多 30 分鐘的邊際消耗要加速。

【輸出要求｜嚴格遵守】
- 只輸出一個 JSON 物件，不要有 markdown 程式碼區塊、不要有任何解釋文字。
- 格式：{"predictedDrain": <0 到 100 的整數>, "reason": "<一句話，繁體中文，40 字以內>"}
- predictedDrain 必須是整數。
- reason 要具體指出「哪一個因子」是主因（例如人數多、對象陌生、時間長），
  不要寫成「這場活動會消耗一些能量」這種沒有資訊量的句子。
- 重要：不同活動之間必須有明顯區分度。獨處式的低壓場合應該落在 5-20，
  極端高壓場合（20 人以上陌生派對、3 小時以上）應該落在 70-95。
  不要把所有結果都塞在 40-60 之間。

${SAFETY_CLAUSE}
`.trim();

/** 組出單次預測的 user message。 */
export function buildPredictDrainUserPrompt(req: DrainPredictionRequest): string {
  const { activity, profile } = req;
  const typeLabel: Record<string, string> = {
    meal: "吃飯聚餐",
    meeting: "會議",
    date: "約會",
    class: "上課",
    party: "派對",
    other: "其他社交場合",
  };
  const rechargeLabel: Record<string, string> = {
    solitude: "獨處才能充電",
    specific_people: "和特定的少數人相處可以充電",
    mixed: "混合型，兩者都行",
  };
  const familiarityLabel = ["", "完全陌生", "點頭之交", "普通朋友", "熟識朋友", "最親密的人"];

  return [
    "【使用者人格】",
    `- 基礎電池容量：${profile.baseBatteryCapacity} / 100`,
    `- 人格摘要：${profile.summary}`,
    `- 充電方式：${rechargeLabel[profile.rechargeStyle] ?? profile.rechargeStyle}`,
    "",
    "【這場活動】",
    `- 類型：${typeLabel[activity.type] ?? activity.type}`,
    `- 人數：${activity.headcount} 人`,
    `- 熟悉度：${activity.familiarity} / 5（${familiarityLabel[activity.familiarity] ?? ""}）`,
    `- 時長：${activity.durationMinutes} 分鐘`,
    "",
    "請估算這場活動會消耗多少電量，只輸出 JSON。",
  ].join("\n");
}
