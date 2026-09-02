/**
 * 電量模型的純函式核心。
 * 刻意不依賴任何 server 模組（AI、DB），這樣 seed 腳本與測試都能直接 import，
 * 也保證 lib/week.ts 與 scripts/generate-seed.ts 用的是同一套算法。
 */

export const LOW_BATTERY_THRESHOLD = 30;

/**
 * 隔夜恢復率：睡一覺回充「基礎容量 × 這個比例」的電量，上限是基礎容量。
 *
 * 為什麼不是 100%：社交能量的核心痛點就是「累積」——前一天燒到見底的人，
 * 隔天早上不會是滿血。取 0.8 的效果是：當天結束時剩餘低於基礎容量的 20% 才會
 * 有明顯宿醉，一般的日子睡一覺就補滿，符合多數人的體感。
 */
export const OVERNIGHT_RECOVERY_RATE = 0.8;

export interface DayBattery {
  /** 當天起床時的電量 */
  startBattery: number;
  /** 當天所有活動結束後的剩餘電量 */
  remainingBattery: number;
}

export function clampBattery(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * 依序模擬每一天的電量，把前一天沒補回來的赤字帶到隔天。
 *
 * 已知簡化：當天消耗超過起床電量時一律截在 0，不記「透支」的部分。
 * 也就是消耗 200 與消耗 80 對隔天的影響相同。
 */
export function simulateWeek(dailyDrains: number[], baseCapacity: number): DayBattery[] {
  const capacity = clampBattery(baseCapacity);
  const result: DayBattery[] = [];
  let previousRemaining: number | null = null;

  for (const drain of dailyDrains) {
    const startBattery =
      previousRemaining === null
        ? capacity // 第一天視為已經睡飽
        : Math.min(capacity, previousRemaining + capacity * OVERNIGHT_RECOVERY_RATE);

    const remainingBattery = clampBattery(startBattery - drain);
    result.push({ startBattery: clampBattery(startBattery), remainingBattery });
    previousRemaining = remainingBattery;
  }

  return result;
}

export function isLowBattery(remaining: number): boolean {
  return remaining < LOW_BATTERY_THRESHOLD;
}
