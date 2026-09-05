import { fail, ok, parseBody } from "@/lib/api";
import { getCurrentUser } from "@/lib/current-user";
import { parseVoiceRequestSchema } from "@/lib/schemas";
import { parseVoiceActivity } from "@/lib/voice-parse";

export const runtime = "edge";

/**
 * POST /api/parse-voice-activity
 * 把語音轉出的自然語言轉成 Activity 的結構化欄位（型別對齊 /lib/types.ts）。
 * AI 失敗會退回關鍵字規則，永遠回得出一組可編輯的預設值。
 */
export async function POST(req: Request) {
  const user = await getCurrentUser(req);
  if (!user) return fail("尚未完成人格快篩", 401);

  const parsed = await parseBody(req, parseVoiceRequestSchema);
  if ("response" in parsed) return parsed.response;

  const result = await parseVoiceActivity(parsed.data.transcript);
  if (result.status === "crisis") {
    return ok({ crisis: true, message: result.message });
  }

  return ok({ activity: result.activity, source: result.source });
}
