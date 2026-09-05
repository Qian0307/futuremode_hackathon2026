import "server-only";

import { readEnv } from "@/lib/env";

/**
 * OpenAI 呼叫封裝。
 * 安全規範：API Key 只在 server-side 讀取，任何 client component 都不可 import 此檔
 * （檔首的 "server-only" 會讓誤用在 build 階段直接失敗）。
 */

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";

export async function hasOpenAIKey(): Promise<boolean> {
  return Boolean(await readEnv("OPENAI_API_KEY"));
}

export interface ChatJsonOptions {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

/**
 * 呼叫 chat completion 並要求回傳 JSON。
 * 失敗（沒 key / 逾時 / 非 2xx / 不是合法 JSON）一律回 null，讓呼叫端走 fallback，
 * 避免單一外部依賴讓整個功能掛掉。
 */
export async function chatJson(opts: ChatJsonOptions): Promise<unknown | null> {
  const apiKey = await readEnv("OPENAI_API_KEY");
  if (!apiKey) return null;

  const model = (await readEnv("OPENAI_MODEL")) ?? "gpt-4o-mini";
  // 可覆寫，方便接 gateway/proxy，或在本機用 mock server 測試
  const baseUrl = ((await readEnv("OPENAI_BASE_URL")) ?? DEFAULT_OPENAI_BASE_URL).replace(/\/$/, "");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 12_000);

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: opts.temperature ?? 0.4,
        max_tokens: opts.maxTokens ?? 400,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: opts.systemPrompt },
          { role: "user", content: opts.userPrompt },
        ],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      console.error("[ai] OpenAI 回傳非 2xx:", res.status, await res.text().catch(() => ""));
      return null;
    }

    const payload = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) return null;

    return safeParseJson(content);
  } catch (err) {
    console.error("[ai] OpenAI 呼叫失敗:", err);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** 容錯：即使模型多包了 ```json 區塊或前後綴文字，也盡量抽出 JSON。 */
function safeParseJson(text: string): unknown | null {
  const trimmed = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}
