import { chatJson } from "@/lib/ai";
import { ruleBasedDrain } from "@/lib/drain-rules";
import { buildPredictDrainUserPrompt, PREDICT_DRAIN_SYSTEM_PROMPT } from "@/lib/prompts/predict-drain";
import { drainPredictionResponseSchema } from "@/lib/schemas";
import { CRISIS_RESPONSE, detectCrisis } from "@/lib/safety";
import type { DrainPredictionRequest, DrainPredictionResponse } from "@/lib/types";

export interface PredictResult extends DrainPredictionResponse {
  /** ai = 由模型產生；rule = fallback 規則；crisis = 命中安全規範 */
  source: "ai" | "rule" | "crisis";
}

/**
 * A4 / A5 共用的預測邏輯。
 * 流程：安全規範檢查 → 呼叫 AI → Zod 驗證輸出 → 失敗就走規則式 fallback。
 * 任何一步失敗都不會 throw，確保新增活動的主流程不會被 AI 拖垮。
 */
export async function predictDrain(req: DrainPredictionRequest): Promise<PredictResult> {
  const fallback = ruleBasedDrain(req);

  // 第 0.5 節：偵測到危機關鍵字就不進 LLM，直接回制式文字。
  if (detectCrisis(req)) {
    return { predictedDrain: fallback.predictedDrain, reason: CRISIS_RESPONSE, source: "crisis" };
  }

  const raw = await chatJson({
    systemPrompt: PREDICT_DRAIN_SYSTEM_PROMPT,
    userPrompt: buildPredictDrainUserPrompt(req),
    temperature: 0.3,
    maxTokens: 200,
  });

  if (raw === null) return { ...fallback, source: "rule" };

  const parsed = drainPredictionResponseSchema.safeParse(raw);
  if (!parsed.success) {
    console.warn("[predict] AI 輸出格式不符，改用規則式 fallback");
    return { ...fallback, source: "rule" };
  }

  // 模型偶爾會回小數或超界，這裡再收斂一次。
  const predictedDrain = Math.max(0, Math.min(100, Math.round(parsed.data.predictedDrain)));
  return { predictedDrain, reason: parsed.data.reason.trim(), source: "ai" };
}
