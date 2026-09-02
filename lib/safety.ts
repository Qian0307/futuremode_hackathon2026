/**
 * 第 0.5 節安全規範的共用實作。
 * 任何呼叫 AI 的路徑都必須先過 detectCrisis()，命中就直接回制式文字，不進 LLM。
 */

export const CRISIS_RESPONSE =
  "這聽起來很不容易，建議尋求專業心理協助或撥打安心專線 1925";

const CRISIS_KEYWORDS = [
  // 中文
  "自殺", "自杀", "輕生", "轻生", "尋短", "寻短", "自傷", "自伤", "自殘", "自残",
  "割腕", "想死", "不想活", "活不下去", "結束生命", "结束生命", "了結自己", "了结自己",
  "跳樓", "跳楼", "安眠藥自", "傷害自己", "伤害自己", "沒有活下去的理由",
  // 英文
  "suicide", "suicidal", "kill myself", "killing myself", "end my life",
  "self-harm", "self harm", "cut myself", "want to die", "better off dead",
];

/** 偵測輸入文字是否包含自傷/自殺/危機關鍵字。 */
export function detectCrisis(input: unknown): boolean {
  const text = JSON.stringify(input ?? "").toLowerCase();
  return CRISIS_KEYWORDS.some((kw) => text.includes(kw.toLowerCase()));
}

/** 所有 system prompt 都要嵌入的安全條款。 */
export const SAFETY_CLAUSE = `
【安全規範｜不可違反】
1. 你絕對不提供醫療診斷、心理疾病判定、藥物建議或危機處置指引。
2. 你只做「社交能量消耗估算」與「行程安排建議」，不做治療。
3. 若輸入內容出現自傷、自殺、傷害他人或其他危機訊號，不要嘗試自行安撫或處理，
   立刻只輸出這句話（不加任何其他文字）：「${CRISIS_RESPONSE}」
4. 語氣溫暖、不評判，不使用「你應該」「你太…」這類指責性字眼，也不替使用者貼標籤。
`.trim();
