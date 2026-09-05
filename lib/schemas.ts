import { z } from "zod";
import { ONBOARDING_QUESTION_COUNT } from "@/lib/onboarding";

export const activityTypeSchema = z.enum(["meal", "meeting", "date", "class", "party", "other"]);

export const personalityProfileSchema = z.object({
  baseBatteryCapacity: z.number().int().min(0).max(100),
  summary: z.string().min(1).max(200),
  rechargeStyle: z.enum(["solitude", "specific_people", "mixed"]),
});

export const activityInputSchema = z.object({
  type: activityTypeSchema,
  headcount: z.number().int().min(1).max(500),
  familiarity: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  durationMinutes: z.number().int().min(5).max(1440),
});

/** POST /api/predict-drain 的輸入，對應 DrainPredictionRequest */
export const drainPredictionRequestSchema = z.object({
  activity: activityInputSchema,
  profile: personalityProfileSchema,
});

/** AI 回傳格式驗證，對應 DrainPredictionResponse */
export const drainPredictionResponseSchema = z.object({
  predictedDrain: z.number().min(0).max(100),
  reason: z.string().min(1).max(200),
});

/** POST /api/onboarding */
export const onboardingRequestSchema = z.object({
  answers: z
    .array(z.number().int().min(0).max(3))
    .length(ONBOARDING_QUESTION_COUNT, `需要 ${ONBOARDING_QUESTION_COUNT} 題答案`),
});

/** POST /api/activities */
export const createActivitySchema = activityInputSchema.extend({
  scheduledAt: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/)),
});

/** PATCH /api/activities/:id/actual-drain */
export const actualDrainSchema = z.object({
  feedback: z.enum(["more", "same", "less"]).optional(),
  actualDrain: z.number().int().min(0).max(100).optional(),
}).refine((v) => v.feedback !== undefined || v.actualDrain !== undefined, {
  message: "需要提供 feedback 或 actualDrain 其中之一",
});

/** AI 一週風險預警回傳格式 */
export const weeklyWarningsSchema = z.object({
  warnings: z.array(
    z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      message: z.string().min(1).max(300),
    })
  ),
});

/* ------------------------------------------------------------------ */
/* Track D：語音輸入                                                    */
/* ------------------------------------------------------------------ */

/** POST /api/voice-to-text 的 base64 版輸入 */
export const base64AudioSchema = z.object({
  audioBase64: z.string().min(1).max(4_000_000),
  mimeType: z.string().min(1).max(100).default("audio/webm"),
});

/** POST /api/parse-voice-activity 的輸入 */
export const parseVoiceRequestSchema = z.object({
  transcript: z.string().min(1).max(500),
});

/** AI 把自然語言轉成結構化欄位後的輸出，欄位命名對齊 /lib/types.ts 的 Activity */
export const parsedActivitySchema = z.object({
  type: activityTypeSchema,
  headcount: z.number().int().min(1).max(500),
  familiarity: z.number().int().min(1).max(5),
  durationMinutes: z.number().int().min(5).max(1440),
  scheduledAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "需為 YYYY-MM-DDTHH:mm"),
  /** AI 對哪些欄位沒把握，前端可以提示使用者確認 */
  uncertainFields: z.array(z.string()).default([]),
});

/* ------------------------------------------------------------------ */
/* 排日程系統                                                           */
/* ------------------------------------------------------------------ */

export const scheduleSuggestRequestSchema = z.object({
  /** 使用者想安排的活動描述，例如「跟五個不太熟的同學吃飯，兩小時」 */
  description: z.string().min(1).max(300).optional(),
  /** 或直接給結構化的活動條件 */
  activity: activityInputSchema.optional(),
}).refine((v) => v.description !== undefined || v.activity !== undefined, {
  message: "需要提供 description 或 activity 其中之一",
});

export const scheduleSuggestionsSchema = z.object({
  suggestions: z.array(
    z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      startTime: z.string().regex(/^\d{2}:\d{2}$/),
      reason: z.string().min(1).max(300),
      /** best = 最推薦；ok = 可以但沒那麼理想；avoid = 不建議 */
      rating: z.enum(["best", "ok", "avoid"]),
    })
  ).max(7),
});

/* ------------------------------------------------------------------ */
/* 回顧系統                                                             */
/* ------------------------------------------------------------------ */

export const weeklyReviewSchema = z.object({
  headline: z.string().min(1).max(120),
  observations: z.array(z.string().min(1).max(200)).max(4),
  suggestion: z.string().min(1).max(200),
});
