import "server-only";

import { readEnv } from "@/lib/env";

/**
 * ElevenLabs Speech-to-Text 封裝。
 * API Key 只在此處（server-side）讀取，檔首的 "server-only" 讓 client component 誤用時
 * 會在 build 階段直接失敗。
 */

const DEFAULT_BASE_URL = "https://api.elevenlabs.io/v1";

/** D4-2：限制檔案大小，避免不必要的 API 成本。30 秒的 webm 音訊遠小於此。 */
export const MAX_AUDIO_BYTES = 2 * 1024 * 1024; // 2 MB
export const MAX_AUDIO_SECONDS = 30;

export async function hasElevenLabsKey(): Promise<boolean> {
  return Boolean(await readEnv("ELEVENLABS_API_KEY"));
}

export interface TranscribeResult {
  transcript: string;
  languageCode?: string;
}

/**
 * 把音檔轉成文字。
 * 任何失敗（沒 key / 逾時 / 非 2xx / 回傳沒有文字）一律回 null，
 * 由呼叫端給出「請直接輸入文字」的 fallback 提示，不讓表單卡住。
 */
export async function transcribeAudio(audio: Blob, filename = "recording.webm"): Promise<TranscribeResult | null> {
  const apiKey = await readEnv("ELEVENLABS_API_KEY");
  if (!apiKey) return null;

  const baseUrl = ((await readEnv("ELEVENLABS_BASE_URL")) ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  const modelId = (await readEnv("ELEVENLABS_STT_MODEL")) ?? "scribe_v1";

  const form = new FormData();
  form.append("file", audio, filename);
  form.append("model_id", modelId);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    const res = await fetch(`${baseUrl}/speech-to-text`, {
      method: "POST",
      headers: { "xi-api-key": apiKey },
      body: form,
      signal: controller.signal,
    });

    if (!res.ok) {
      console.error("[elevenlabs] 回傳非 2xx:", res.status, await res.text().catch(() => ""));
      return null;
    }

    // 官方欄位是 text；為了保險也接受 transcript
    const payload = (await res.json()) as { text?: string; transcript?: string; language_code?: string };
    const transcript = (payload.text ?? payload.transcript ?? "").trim();
    if (!transcript) return null;

    return { transcript, languageCode: payload.language_code };
  } catch (err) {
    console.error("[elevenlabs] 呼叫失敗:", err);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
