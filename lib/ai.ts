import "server-only";

import { readEnv } from "@/lib/env";

/**
 * AI 呼叫封裝：依序嘗試三個供應商，第一個成功的就採用。
 *
 * 1. Cloudflare Workers AI（主要）
 *    走 wrangler.toml 的 [ai] binding，跟 D1／Pages 同一個帳號，不需要另外申請 API Key。
 *    免費額度每天 10,000 Neurons——以 demo 的用量遠遠用不完，但不是無上限。
 * 2. Groq（備援）
 *    OpenAI 相容介面、免費、推論極快。設了 GROQ_API_KEY 就會啟用。
 * 3. OpenAI（選配）
 *    活動現場若有發 credits，設 OPENAI_API_KEY 就會自動接上，不用改任何程式碼。
 *
 * 全部失敗回 null，由呼叫端走規則式 fallback（lib/drain-rules.ts 等），功能不會中斷。
 *
 * 安全規範：所有 Key 只在此處（server-side）讀取，
 * 檔首的 "server-only" 讓 client component 誤用時會在 build 階段直接失敗。
 */

const DEFAULT_WORKERS_AI_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const DEFAULT_GROQ_MODEL = "llama-3.3-70b-versatile";
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
const OPENAI_BASE_URL = "https://api.openai.com/v1";

export type AiProvider = "workers-ai" | "groq" | "openai";

export interface ChatJsonOptions {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

/** Workers AI 的 binding 形狀（只用到 run()）。 */
interface AiBinding {
  run: (model: string, input: unknown) => Promise<unknown>;
}

async function getAiBinding(): Promise<AiBinding | null> {
  try {
    const { getRequestContext } = await import("@cloudflare/next-on-pages");
    const env = getRequestContext().env as unknown as { AI?: AiBinding };
    return env?.AI && typeof env.AI.run === "function" ? env.AI : null;
  } catch {
    return null;
  }
}

/** 目前有哪些供應商可用——首頁／README 之外，也給部署檢查用。 */
export async function availableProviders(): Promise<AiProvider[]> {
  const providers: AiProvider[] = [];
  if (await getAiBinding()) providers.push("workers-ai");
  if (await readEnv("GROQ_API_KEY")) providers.push("groq");
  if (await readEnv("OPENAI_API_KEY")) providers.push("openai");
  return providers;
}

/** 是否有任何 AI 供應商可用（決定要不要排背景 refine）。 */
export async function hasAnyProvider(): Promise<boolean> {
  return (await availableProviders()).length > 0;
}

/**
 * 呼叫 LLM 並要求回傳 JSON。
 * 刻意不使用各家的 structured output 參數——不同供應商支援度不一，
 * 一旦不支援就會整個呼叫失敗。這裡改用「prompt 明確要求 JSON + 容錯解析 + Zod 驗證」，
 * 換取跨供應商的一致行為。
 */
export async function chatJson(opts: ChatJsonOptions): Promise<unknown | null> {
  try {
    return await tryProviders(opts);
  } catch (err) {
    // 最後一道防線：AI 出任何意外都只回 null，讓呼叫端走規則式 fallback，
    // 絕不讓外部服務的問題變成使用者看到的 500。
    console.error("[ai] 供應商鏈發生未預期錯誤:", err);
    return null;
  }
}

async function tryProviders(opts: ChatJsonOptions): Promise<unknown | null> {
  const timeoutMs = opts.timeoutMs ?? 12_000;

  // 1. Cloudflare Workers AI
  const binding = await getAiBinding();
  if (binding) {
    const model = (await readEnv("WORKERS_AI_MODEL")) ?? DEFAULT_WORKERS_AI_MODEL;
    const text = await callWorkersAi(binding, model, opts, timeoutMs);
    const parsed = text === null ? null : safeParseJson(text);
    if (parsed !== null) return parsed;
    console.warn("[ai] Workers AI 沒有回傳可解析的 JSON，改試下一個供應商");
  }

  // 2. Groq
  const groqKey = await readEnv("GROQ_API_KEY");
  if (groqKey) {
    const model = (await readEnv("GROQ_MODEL")) ?? DEFAULT_GROQ_MODEL;
    const baseUrl = ((await readEnv("GROQ_BASE_URL")) ?? GROQ_BASE_URL).replace(/\/$/, "");
    const text = await callOpenAiCompatible("groq", baseUrl, groqKey, model, opts, timeoutMs);
    const parsed = text === null ? null : safeParseJson(text);
    if (parsed !== null) return parsed;
  }

  // 3. OpenAI
  const openaiKey = await readEnv("OPENAI_API_KEY");
  if (openaiKey) {
    const model = (await readEnv("OPENAI_MODEL")) ?? DEFAULT_OPENAI_MODEL;
    const baseUrl = ((await readEnv("OPENAI_BASE_URL")) ?? OPENAI_BASE_URL).replace(/\/$/, "");
    const text = await callOpenAiCompatible("openai", baseUrl, openaiKey, model, opts, timeoutMs);
    const parsed = text === null ? null : safeParseJson(text);
    if (parsed !== null) return parsed;
  }

  return null;
}

async function callWorkersAi(
  binding: AiBinding,
  model: string,
  opts: ChatJsonOptions,
  timeoutMs: number
): Promise<string | null> {
  try {
    const result = await withTimeout(
      binding.run(model, {
        messages: [
          { role: "system", content: opts.systemPrompt },
          { role: "user", content: opts.userPrompt },
        ],
        temperature: opts.temperature ?? 0.4,
        max_tokens: opts.maxTokens ?? 400,
      }),
      timeoutMs
    );

    return extractWorkersAiText(result);
  } catch (err) {
    console.error("[ai] Workers AI 呼叫失敗:", err);
    return null;
  }
}

async function callOpenAiCompatible(
  label: string,
  baseUrl: string,
  apiKey: string,
  model: string,
  opts: ChatJsonOptions,
  timeoutMs: number
): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
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
      console.error(`[ai] ${label} 回傳非 2xx:`, res.status, await res.text().catch(() => ""));
      return null;
    }

    const payload = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return payload.choices?.[0]?.message?.content ?? null;
  } catch (err) {
    console.error(`[ai] ${label} 呼叫失敗:`, err);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Workers AI 的回傳形狀依模型而異，實測至少有三種，全部都要接：
 * - 舊式文字模型： { response: "..." }
 * - instruct 模型（如 llama-3.3-70b-fp8-fast）：OpenAI 格式的 { choices: [{ message: { content } }] }
 * - 少數情況直接回字串
 * 取不到字串就回 null，讓供應商鏈往下一個走。
 */
function extractWorkersAiText(result: unknown): string | null {
  if (typeof result === "string") return result;
  if (!result || typeof result !== "object") return null;

  const asResponse = (result as { response?: unknown }).response;
  if (typeof asResponse === "string") return asResponse;

  const choices = (result as { choices?: unknown }).choices;
  if (Array.isArray(choices)) {
    const content = (choices[0] as { message?: { content?: unknown } } | undefined)?.message?.content;
    if (typeof content === "string") return content;
  }

  console.error("[ai] Workers AI 回傳非預期形狀:", JSON.stringify(result)?.slice(0, 300));
  return null;
}

/** Workers AI binding 沒有 AbortSignal，用 Promise.race 補上逾時保護。 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`逾時 ${ms}ms`)), ms)),
  ]);
}

/** 容錯：即使模型多包了 ```json 區塊或前後綴文字，也盡量抽出 JSON。 */
function safeParseJson(text: unknown): unknown | null {
  if (typeof text !== "string") return null;
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
