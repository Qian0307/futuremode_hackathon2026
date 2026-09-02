import type { DrainPredictionRequest, DrainPredictionResponse } from "@/lib/types";

/**
 * 規則式電量消耗估算。
 * 用途有二：
 * 1. AI 回傳格式錯誤 / API 掛掉時的 fallback，確保功能不會整個死掉。
 * 2. 當作 AI 輸出的合理性參考基準（scripts/test-prompts.ts 會比對兩者）。
 *
 * 係數的設計邏輯與 lib/prompts/predict-drain.ts 的心理學依據一致。
 * 基準情境：3-6 人、普通朋友、90 分鐘、基礎容量 60 —— 此時各項係數都是 1，
 * 消耗就等於該活動類型的 base 值。
 */

const TYPE_BASE: Record<string, number> = {
  meal: 15,
  class: 14,
  other: 16,
  meeting: 20,
  date: 22,
  party: 30,
};

/** 熟悉度 1（陌生）成本最高，5（最親密）最低。index 0 不使用。 */
const FAMILIARITY_FACTOR = [0, 1.45, 1.25, 1.05, 0.85, 0.65];

const BASE_DURATION_MINUTES = 90;
const DURATION_CAP = 2.2;
/** 超過這個值之後改用壓縮斜率，避免長時間活動一律頂到 100。 */
const SOFT_CAP_START = 60;
const SOFT_CAP_SLOPE = 0.35;

function headcountFactor(headcount: number): number {
  if (headcount <= 2) return 0.75;
  if (headcount <= 6) return 1.0;
  if (headcount <= 15) return 1.25;
  if (headcount <= 30) return 1.45;
  return 1.6;
}

/** 非線性：時間拉長後邊際消耗加速（資源保存理論），但設上限避免爆表。 */
function durationFactor(minutes: number): number {
  const raw = Math.pow(Math.max(minutes, 10) / BASE_DURATION_MINUTES, 1.1);
  return Math.min(raw, DURATION_CAP);
}

/** 電池容量越低（越偏內向），同一場活動消耗越大。60 為基準點。 */
function capacityFactor(capacity: number): number {
  const c = Math.max(0, Math.min(100, capacity));
  return 1 + ((60 - c) / 60) * 0.9;
}

function rechargeFactor(style: string, familiarity: number): number {
  if (style === "specific_people" && familiarity >= 4) return 0.6;
  if (style === "solitude") return 1.1;
  return 1;
}

/** 高消耗區改用較平緩的斜率，讓 70-95 之間仍然分得出輕重。 */
function softCap(raw: number): number {
  if (raw <= SOFT_CAP_START) return raw;
  return SOFT_CAP_START + (raw - SOFT_CAP_START) * SOFT_CAP_SLOPE;
}

export function ruleBasedDrain(req: DrainPredictionRequest): DrainPredictionResponse {
  const { activity, profile } = req;
  const base = TYPE_BASE[activity.type] ?? TYPE_BASE.other;

  const raw =
    base *
    headcountFactor(activity.headcount) *
    (FAMILIARITY_FACTOR[activity.familiarity] ?? 1.05) *
    durationFactor(activity.durationMinutes) *
    capacityFactor(profile.baseBatteryCapacity) *
    rechargeFactor(profile.rechargeStyle, activity.familiarity);

  const predictedDrain = Math.max(3, Math.min(96, Math.round(softCap(raw))));

  return { predictedDrain, reason: buildReason(req, predictedDrain) };
}

/**
 * 找出偏離基準（1.0）最多的因子，產生一句有資訊量的說明。
 * 全部因子都 <= 1 時改用「為什麼消耗不大」的說法。
 */
function buildReason(req: DrainPredictionRequest, drain: number): string {
  const { activity } = req;
  const hours = Math.round((activity.durationMinutes / 60) * 10) / 10;

  const factors = [
    {
      value: headcountFactor(activity.headcount),
      up: `${activity.headcount} 人的場合要一直分配注意力`,
      down: `只有 ${activity.headcount} 個人，不太需要分心`,
    },
    {
      value: FAMILIARITY_FACTOR[activity.familiarity] ?? 1.05,
      up: "對象不夠熟，得花力氣維持形象",
      down: "對象夠熟，幾乎不用維持形象",
    },
    {
      value: durationFactor(activity.durationMinutes),
      up: `${hours} 小時的長度後半段會加速耗損`,
      down: `${hours} 小時算短，還沒進入耗損加速期`,
    },
  ];

  const heaviest = factors.reduce((a, b) => (b.value > a.value ? b : a));
  const lightest = factors.reduce((a, b) => (b.value < a.value ? b : a));

  if (drain >= 60) return `消耗偏高：${heaviest.up}。`;
  if (drain >= 30) return `中等消耗：${heaviest.value > 1 ? heaviest.up : lightest.down}。`;
  return `消耗不大：${lightest.down}。`;
}
