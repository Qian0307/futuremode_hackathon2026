import type { PersonalityProfile } from "@/lib/types";

/**
 * 6 題人格快篩。
 * 每個選項帶兩個分數：
 * - e：外向性（0-3，越高越外向 → 基礎電池容量越大）
 * - recharge：充電方式的投票（可為 null，表示這題不參與投票）
 */
export type RechargeVote = PersonalityProfile["rechargeStyle"] | null;

export interface OnboardingOption {
  label: string;
  e: number;
  recharge: RechargeVote;
}

export interface OnboardingQuestion {
  id: string;
  question: string;
  options: OnboardingOption[];
}

export const ONBOARDING_QUESTIONS: OnboardingQuestion[] = [
  {
    id: "q1",
    question: "忙碌的一週結束，你最想要的週末是？",
    options: [
      { label: "一個人待著，誰都不見", e: 0, recharge: "solitude" },
      { label: "和一兩個最熟的人窩著", e: 1, recharge: "specific_people" },
      { label: "小聚會，五六個朋友", e: 2, recharge: "mixed" },
      { label: "出門認識新的人，越熱鬧越好", e: 3, recharge: null },
    ],
  },
  {
    id: "q2",
    question: "參加完十個人以上的聚會，你回到家通常會？",
    options: [
      { label: "整個人被榨乾，只想躺著", e: 0, recharge: "solitude" },
      { label: "有點累，需要滑一下手機放空", e: 1, recharge: null },
      { label: "還好，洗個澡就恢復了", e: 2, recharge: null },
      { label: "意猶未盡，還想再約下一攤", e: 3, recharge: null },
    ],
  },
  {
    id: "q3",
    question: "連續一整天都在跟人互動（開會、上課、聚餐），到了傍晚你？",
    options: [
      { label: "早就想逃走了，中午就開始撐", e: 0, recharge: "solitude" },
      { label: "說話開始變少，需要放空", e: 1, recharge: null },
      { label: "還能撐，但晚上不想再排事情", e: 2, recharge: null },
      { label: "完全沒問題，晚上還能再約", e: 3, recharge: null },
    ],
  },
  {
    id: "q4",
    question: "在一個都是陌生人的場合，你的感覺是？",
    options: [
      { label: "很緊繃，一直想找機會離開", e: 0, recharge: null },
      { label: "會找一個角落，等別人來搭話", e: 1, recharge: "specific_people" },
      { label: "還可以，會主動聊幾句", e: 2, recharge: null },
      { label: "很享受，覺得是有趣的機會", e: 3, recharge: null },
    ],
  },
  {
    id: "q5",
    question: "你覺得最舒服的社交頻率是？",
    options: [
      { label: "一週一次以下就夠了", e: 0, recharge: "solitude" },
      { label: "一週一到兩次", e: 1, recharge: "specific_people" },
      { label: "一週三到四次", e: 2, recharge: "mixed" },
      { label: "幾乎每天都想跟人相處", e: 3, recharge: null },
    ],
  },
  {
    id: "q6",
    question: "社交結束後，你需要多久的獨處才會覺得「回來了」？",
    options: [
      { label: "至少半天以上", e: 0, recharge: "solitude" },
      { label: "兩三個小時", e: 1, recharge: "solitude" },
      { label: "半小時左右", e: 2, recharge: "mixed" },
      { label: "幾乎不需要，或跟人聊天反而更有精神", e: 3, recharge: null },
    ],
  },
];

export const ONBOARDING_QUESTION_COUNT = ONBOARDING_QUESTIONS.length;

/**
 * 簡單加權規則（不呼叫 AI）。
 * 總分 0-18 映射到基礎電池容量 25-88。
 */
export function computeProfile(answers: number[]): PersonalityProfile {
  let score = 0;
  const votes: Record<string, number> = { solitude: 0, specific_people: 0, mixed: 0 };

  answers.forEach((choice, i) => {
    const q = ONBOARDING_QUESTIONS[i];
    if (!q) return;
    const opt = q.options[choice];
    if (!opt) return;
    score += opt.e;
    if (opt.recharge) votes[opt.recharge] += 1;
  });

  const maxScore = ONBOARDING_QUESTIONS.length * 3; // 18
  const baseBatteryCapacity = Math.round(25 + (score / maxScore) * 63); // 25 ~ 88

  const rechargeStyle = pickRechargeStyle(votes, score, maxScore);
  const summary = buildSummary(baseBatteryCapacity, rechargeStyle);

  return { baseBatteryCapacity, summary, rechargeStyle };
}

function pickRechargeStyle(
  votes: Record<string, number>,
  score: number,
  maxScore: number
): PersonalityProfile["rechargeStyle"] {
  const total = votes.solitude + votes.specific_people + votes.mixed;
  // 沒有任何投票（全選最外向的選項）→ 高外向者歸為 mixed
  if (total === 0) return score > maxScore * 0.66 ? "mixed" : "specific_people";
  const entries = Object.entries(votes).sort((a, b) => b[1] - a[1]);
  const [topKey, topVal] = entries[0];
  const tie = entries.filter(([, v]) => v === topVal).length > 1;
  if (tie) return "mixed";
  return topKey as PersonalityProfile["rechargeStyle"];
}

function buildSummary(capacity: number, style: PersonalityProfile["rechargeStyle"]): string {
  const styleText: Record<PersonalityProfile["rechargeStyle"], string> = {
    solitude: "獨處是你唯一有效的充電方式",
    specific_people: "和少數幾個對的人相處反而能幫你充電",
    mixed: "你既能享受熱鬧，也需要固定的喘息空檔",
  };

  if (capacity <= 40) {
    return `你的社交電池偏小，人多的場合掉電特別快——${styleText[style]}。`;
  }
  if (capacity <= 60) {
    return `你的社交電池中等，撐得住日常互動但禁不起連續高強度——${styleText[style]}。`;
  }
  if (capacity <= 78) {
    return `你的社交電池不小，多數場合都應付得來——${styleText[style]}。`;
  }
  return `你的社交電池很大，熱鬧的場合幾乎不掉電——${styleText[style]}。`;
}
