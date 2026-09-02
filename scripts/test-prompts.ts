/**
 * Track C1.3：prompt 區分度測試。
 *
 * 用法：
 *   npm run test:prompts            # 只測規則式基準（離線可跑）
 *   OPENAI_API_KEY=sk-... npm run test:prompts   # 同時測真實 AI 輸出
 *
 * 通過條件：10 組活動的預測值必須有明顯區分度
 *   - 最大值與最小值差距 >= 40
 *   - 不可有超過 5 組落在 40-60 之間（避免「什麼都答 50」）
 *   - 低壓組合 < 25，高壓組合 > 65
 */
import { ruleBasedDrain } from "../lib/drain-rules";
import { buildPredictDrainUserPrompt, PREDICT_DRAIN_SYSTEM_PROMPT } from "../lib/prompts/predict-drain";
import type { DrainPredictionRequest, PersonalityProfile } from "../lib/types";

const introvert: PersonalityProfile = {
  baseBatteryCapacity: 38,
  summary: "你的社交電池偏小，人多的場合掉電特別快——獨處是你唯一有效的充電方式。",
  rechargeStyle: "solitude",
};
const middle: PersonalityProfile = {
  baseBatteryCapacity: 58,
  summary: "你的社交電池中等，撐得住日常互動但禁不起連續高強度——和少數幾個對的人相處反而能幫你充電。",
  rechargeStyle: "specific_people",
};
const extrovert: PersonalityProfile = {
  baseBatteryCapacity: 84,
  summary: "你的社交電池很大，熱鬧的場合幾乎不掉電——你既能享受熱鬧，也需要固定的喘息空檔。",
  rechargeStyle: "mixed",
};

interface Case {
  name: string;
  req: DrainPredictionRequest;
  /** 期待落在哪個區間：low < 25、mid 25-65、high > 65 */
  expect: "low" | "mid" | "high";
}

const CASES: Case[] = [
  {
    name: "2 人最熟的讀書會 60 分鐘（中容量）",
    req: { activity: { type: "other", headcount: 2, familiarity: 5, durationMinutes: 60 }, profile: middle },
    expect: "low",
  },
  {
    name: "和伴侶約會 2 小時（中容量）",
    req: { activity: { type: "date", headcount: 2, familiarity: 5, durationMinutes: 120 }, profile: middle },
    expect: "low",
  },
  {
    name: "和好友吃飯 4 人 90 分鐘（外向）",
    req: { activity: { type: "meal", headcount: 4, familiarity: 4, durationMinutes: 90 }, profile: extrovert },
    expect: "low",
  },
  {
    name: "系上大堂課 40 人 100 分鐘（中容量）",
    req: { activity: { type: "class", headcount: 40, familiarity: 2, durationMinutes: 100 }, profile: middle },
    expect: "mid",
  },
  {
    name: "8 人專案會議 90 分鐘（中容量）",
    req: { activity: { type: "meeting", headcount: 8, familiarity: 3, durationMinutes: 90 }, profile: middle },
    expect: "mid",
  },
  {
    name: "6 人不太熟的聚餐 90 分鐘（內向）",
    req: { activity: { type: "meal", headcount: 6, familiarity: 2, durationMinutes: 90 }, profile: introvert },
    expect: "mid",
  },
  {
    name: "20 人派對 3 小時（外向）",
    req: { activity: { type: "party", headcount: 20, familiarity: 3, durationMinutes: 180 }, profile: extrovert },
    expect: "mid",
  },
  {
    name: "25 人迎新派對 3 小時，都不熟（內向）",
    req: { activity: { type: "party", headcount: 25, familiarity: 2, durationMinutes: 180 }, profile: introvert },
    expect: "high",
  },
  {
    name: "50 人全系聚 4 小時，陌生人（內向）",
    req: { activity: { type: "party", headcount: 50, familiarity: 1, durationMinutes: 240 }, profile: introvert },
    expect: "high",
  },
  {
    name: "12 人跨部門會議 4 小時，不熟（內向）",
    req: { activity: { type: "meeting", headcount: 12, familiarity: 2, durationMinutes: 240 }, profile: introvert },
    expect: "high",
  },
];

const RANGES = { low: [0, 25], mid: [25, 65], high: [65, 100] } as const;

async function callOpenAI(req: DrainPredictionRequest): Promise<{ predictedDrain: number; reason: string } | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      temperature: 0.3,
      max_tokens: 200,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: PREDICT_DRAIN_SYSTEM_PROMPT },
        { role: "user", content: buildPredictDrainUserPrompt(req) },
      ],
    }),
  });
  if (!res.ok) {
    console.error(`  OpenAI 回應 ${res.status}: ${await res.text()}`);
    return null;
  }
  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  try {
    return JSON.parse(data.choices[0].message.content);
  } catch {
    return null;
  }
}

function evaluate(label: string, values: number[], reasons: string[]) {
  console.log(`\n=== ${label} ===`);
  CASES.forEach((c, i) => {
    const [lo, hi] = RANGES[c.expect];
    const inRange = values[i] > lo && values[i] <= hi;
    console.log(
      `${inRange ? "✓" : "✗"} ${String(values[i]).padStart(3)}%  [期待 ${c.expect}]  ${c.name}` +
        (reasons[i] ? `\n       └─ ${reasons[i]}` : "")
    );
  });

  const min = Math.min(...values);
  const max = Math.max(...values);
  const clustered = values.filter((v) => v >= 40 && v <= 60).length;
  const outOfRange = CASES.filter((c, i) => {
    const [lo, hi] = RANGES[c.expect];
    return !(values[i] > lo && values[i] <= hi);
  });

  console.log(`\n區間：${min}% ~ ${max}%（跨度 ${max - min}）｜落在 40-60 的有 ${clustered}/${values.length} 組`);

  const failures: string[] = [];
  if (max - min < 40) failures.push(`區分度不足：跨度只有 ${max - min}，需要 >= 40`);
  if (clustered > 5) failures.push(`太集中：${clustered} 組落在 40-60，需要 <= 5`);
  if (outOfRange.length > 2) failures.push(`有 ${outOfRange.length} 組落在期待區間外（容許 2 組）`);

  if (failures.length > 0) {
    failures.forEach((f) => console.error(`✗ ${f}`));
    return false;
  }
  console.log("✓ 區分度檢查通過");
  return true;
}

async function main() {
  const ruleValues = CASES.map((c) => ruleBasedDrain(c.req).predictedDrain);
  const ruleReasons = CASES.map((c) => ruleBasedDrain(c.req).reason);
  let passed = evaluate("規則式 fallback（lib/drain-rules.ts）", ruleValues, ruleReasons);

  if (process.env.OPENAI_API_KEY) {
    const aiValues: number[] = [];
    const aiReasons: string[] = [];
    for (const c of CASES) {
      const result = await callOpenAI(c.req);
      aiValues.push(result?.predictedDrain ?? -1);
      aiReasons.push(result?.reason ?? "(呼叫失敗)");
    }
    passed = evaluate("AI（lib/prompts/predict-drain.ts）", aiValues, aiReasons) && passed;
  } else {
    console.log("\n（未設定 OPENAI_API_KEY，跳過真實 AI 測試）");
  }

  if (!passed) process.exit(1);
}

void main();
