import { fail, ok } from "@/lib/api";
import { getCurrentUser } from "@/lib/current-user";
import { hasElevenLabsKey, MAX_AUDIO_BYTES, transcribeAudio } from "@/lib/elevenlabs";
import { base64AudioSchema } from "@/lib/schemas";

export const runtime = "edge";

/** 轉錄失敗時的統一提示（D2）：不可讓表單卡住，一定要引導回手動輸入。 */
const FALLBACK_MESSAGE = "語音辨識失敗，請直接輸入文字";

/**
 * POST /api/voice-to-text
 * 接收音檔（multipart/form-data 的 `audio` 欄位，或 JSON 的 base64），
 * 呼叫 ElevenLabs Speech-to-Text，回傳 { transcript }。
 */
export async function POST(req: Request) {
  const user = await getCurrentUser(req);
  if (!user) return fail("尚未完成人格快篩", 401);

  if (!(await hasElevenLabsKey())) {
    return fail("尚未設定語音服務，請直接輸入文字", 503, { fallback: FALLBACK_MESSAGE });
  }

  let audio: Blob;
  let filename = "recording.webm";

  const contentType = req.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("audio");
      if (!(file instanceof Blob)) return fail("缺少 audio 欄位", 400, { fallback: FALLBACK_MESSAGE });
      audio = file;
      if (file instanceof File && file.name) filename = file.name;
    } else {
      const parsed = base64AudioSchema.safeParse(await req.json().catch(() => null));
      if (!parsed.success) return fail("輸入格式不正確", 422, { fallback: FALLBACK_MESSAGE });
      audio = base64ToBlob(parsed.data.audioBase64, parsed.data.mimeType);
      filename = parsed.data.mimeType.includes("mp3") ? "recording.mp3" : "recording.webm";
    }
  } catch (err) {
    console.error("[voice-to-text] 讀取音檔失敗:", err);
    return fail("無法讀取音檔", 400, { fallback: FALLBACK_MESSAGE });
  }

  // D4-2：大小上限，避免不必要的 API 成本
  if (audio.size === 0) return fail("音檔是空的", 400, { fallback: FALLBACK_MESSAGE });
  if (audio.size > MAX_AUDIO_BYTES) {
    return fail("錄音太長了，請控制在 30 秒內", 413, { fallback: FALLBACK_MESSAGE });
  }

  const result = await transcribeAudio(audio, filename);
  if (!result) return fail(FALLBACK_MESSAGE, 502, { fallback: FALLBACK_MESSAGE });

  return ok({ transcript: result.transcript, languageCode: result.languageCode });
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const clean = base64.includes(",") ? base64.slice(base64.indexOf(",") + 1) : base64;
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}
