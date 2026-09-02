import { ok, parseBody } from "@/lib/api";
import { predictDrain } from "@/lib/predict";
import { drainPredictionRequestSchema } from "@/lib/schemas";
import type { DrainPredictionResponse } from "@/lib/types";

export const runtime = "edge";

/** POST /api/predict-drain — DrainPredictionRequest -> DrainPredictionResponse */
export async function POST(req: Request) {
  const parsed = await parseBody(req, drainPredictionRequestSchema);
  if ("response" in parsed) return parsed.response;

  const result = await predictDrain(parsed.data);
  const body: DrainPredictionResponse & { source: string } = {
    predictedDrain: result.predictedDrain,
    reason: result.reason,
    source: result.source,
  };
  return ok(body);
}
