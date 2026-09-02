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
