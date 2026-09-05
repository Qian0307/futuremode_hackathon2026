"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { AlertTriangle } from "lucide-react";
import { BatteryGauge } from "@/components/BatteryGauge";
import { CalendarSubscribe } from "@/components/CalendarSubscribe";
import { Card, CardContent } from "@/components/ui/card";
import { ACTIVITY_META, formatMonthDay, formatTime, formatWeekday } from "@/lib/activity-meta";
import { OVERNIGHT_RECOVERY_RATE } from "@/lib/battery";
import { fetchWeek, todayInTaipei, UnauthorizedError, type DaySummaryDTO, type WeekResponse } from "@/lib/client-api";

export default function WeekPage() {
  const router = useRouter();
  const [data, setData] = React.useState<WeekResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [loadingWarnings, setLoadingWarnings] = React.useState(false);

  /**
   * 兩段式載入：先秒開電池與行程（?warnings=0，不打 AI），
   * 再背景抓 AI 預警補上去。
   * 這頁是產品最重要的畫面，讓它空白 4 秒等 AI 是很糟的第一印象。
   */
  React.useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const fast = await fetchWeek({ warnings: false });
        if (cancelled) return;
        setData(fast);
        setSelected(todayInTaipei());
        setLoading(false);

        // 沒有低電量日就不用再打一次 AI
        if (!fast.days.some((d) => d.isLow)) return;

        setLoadingWarnings(true);
        const withWarnings = await fetchWeek();
        if (cancelled) return;
        setData(withWarnings);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof UnauthorizedError) {
          router.replace("/onboarding");
          return;
        }
        setError(err instanceof Error ? err.message : "讀取失敗");
      } finally {
        if (!cancelled) {
          setLoading(false);
          setLoadingWarnings(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  if (loading) return <p className="py-24 text-center text-muted-foreground">載入中…</p>;
  if (error) return <p className="py-24 text-center text-sm text-destructive">{error}</p>;
  if (!data) return null;

  const lowDays = data.days.filter((d) => d.isLow);
  const selectedDay = data.days.find((d) => d.date === selected) ?? null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">接下來這一週</h1>
        <p className="mt-1 text-xs leading-relaxed text-mint-600">
          睡一覺只回充基礎電量的 {Math.round(OVERNIGHT_RECOVERY_RATE * 100)}%——補不滿的赤字會帶到隔天。
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {lowDays.length === 0
            ? "整週的電量都在安全範圍，看起來安排得不錯。"
            : `有 ${lowDays.length} 天電量會低於 30%${
                lowDays.some((d) => d.startBattery < data.profile.baseBatteryCapacity)
                  ? "，其中有幾天是前一天累積下來的"
                  : ""
              }。往下看看建議。`}
        </p>
      </div>

      {/* 七天橫向排列 */}
      <div className="-mx-5 overflow-x-auto px-5">
        <div className="flex min-w-max gap-3 pb-2">
          {data.days.map((day, i) => (
            <motion.button
              key={day.date}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              onClick={() => setSelected(day.date)}
              className={`flex flex-col items-center gap-1 rounded-3xl border px-3 py-3 transition ${
                selected === day.date ? "border-mint-400 bg-white shadow-md" : "border-transparent bg-white/60 hover:bg-white"
              }`}
            >
              <span className="text-xs font-medium text-muted-foreground">{formatWeekday(day.date)}</span>
              <BatteryGauge value={day.remainingBattery} size="sm" />
              <span className="text-[11px] text-muted-foreground">{formatMonthDay(day.date)}</span>
            </motion.button>
          ))}
        </div>
      </div>

      {/* 低電量日的 AI 風險提醒 */}
      {lowDays.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground/70">電量預警</h2>
          {lowDays.map((day) => (
            <Card key={day.date} className="border-coral-300/70 bg-coral-300/10">
              <CardContent className="flex gap-3 p-5">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-coral-500" />
                <div className="space-y-1.5">
                  {day.startBattery < data.profile.baseBatteryCapacity ? (
                    <>
                      <p className="text-xs text-muted-foreground">
                        {formatMonthDay(day.date)}（{formatWeekday(day.date)}）
                      </p>
                      <CarryOverNote
                        day={day}
                        previousRemaining={previousRemainingOf(data, day.date)}
                        variant="headline"
                      />
                    </>
                  ) : (
                    <p className="text-sm font-semibold">
                      {formatMonthDay(day.date)}（{formatWeekday(day.date)}）· 剩餘 {day.remainingBattery}%
                    </p>
                  )}
                  {day.warning ? (
                    <p className="text-sm leading-relaxed text-foreground/80">{day.warning}</p>
                  ) : loadingWarnings ? (
                    <p className="flex items-center gap-2 text-sm text-muted-foreground">
                      <span className="h-3 w-3 animate-pulse rounded-full bg-coral-300" />
                      AI 正在看你這天的行程…
                    </p>
                  ) : (
                    <p className="text-sm leading-relaxed text-foreground/80">
                      這天的電量偏低，記得留一點獨處時間。
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </section>
      )}

      {/* 選取那天的細節 */}
      {selectedDay && (
        <DayDetail
          day={selectedDay}
          capacity={data.profile.baseBatteryCapacity}
          previousRemaining={previousRemainingOf(data, selectedDay.date)}
        />
      )}

      {/* Apple 日曆訂閱 */}
      <CalendarSubscribe />
    </div>
  );
}

/** 找出前一天的結束電量；是本週第一天就回 null（沒有前一天可以參考）。 */
function previousRemainingOf(data: WeekResponse, date: string): number | null {
  const i = data.days.findIndex((d) => d.date === date);
  return i > 0 ? data.days[i - 1].remainingBattery : null;
}

/**
 * 跨日結轉的說明。
 *
 * 視覺順序刻意分三層：先看到「起床只剩 46%」，再讀懂「昨天的赤字還沒補回來」，
 * 最後才是昨天到今天的因果鏈。公式不該搶走主視覺——使用者要的是原因，不是算式。
 */
function CarryOverNote({
  day,
  previousRemaining,
  variant,
}: {
  day: DaySummaryDTO;
  previousRemaining: number | null;
  variant: "headline" | "inline";
}) {
  if (previousRemaining === null) return null;

  const causalChain = `昨天 ${previousRemaining}% → 今早 ${day.startBattery}% → 今晚 ${day.remainingBattery}%`;

  if (variant === "inline") {
    return (
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {causalChain}．睡眠只回充八成，昨天的赤字被帶到今天
      </p>
    );
  }

  return (
    <div className="space-y-0.5">
      <p className="text-lg font-semibold leading-tight text-coral-500">
        起床只剩 {day.startBattery}%
      </p>
      <p className="text-xs font-medium text-foreground/75">昨天的赤字還沒補回來</p>
      <p className="text-[11px] leading-relaxed text-muted-foreground">{causalChain}</p>
      <p className="text-[10px] tracking-wide text-muted-foreground/60">
        睡眠只回充八成・跨日資源模型
      </p>
    </div>
  );
}

function DayDetail({
  day,
  capacity,
  previousRemaining,
}: {
  day: DaySummaryDTO;
  capacity: number;
  previousRemaining: number | null;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-foreground/70">
        {formatMonthDay(day.date)}（{formatWeekday(day.date)}）的行程
        <span className="ml-2 font-normal text-muted-foreground">
          起床 {day.startBattery}% → 剩 {day.remainingBattery}%
        </span>
      </h2>
      {day.startBattery < capacity && (
        <CarryOverNote day={day} previousRemaining={previousRemaining} variant="inline" />
      )}
      {day.activities.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">這天沒有安排社交活動，是完整的恢復日。</CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {day.activities.map((a) => (
            <li key={a.id}>
              <Card>
                <CardContent className="flex items-center gap-4 p-4">
                  <span className="text-2xl" aria-hidden>
                    {ACTIVITY_META[a.type].emoji}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {formatTime(a.scheduledAt)} · {ACTIVITY_META[a.type].label}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {a.headcount} 人 · 熟悉度 {a.familiarity}/5
                    </p>
                  </div>
                  <span className={`text-lg font-semibold ${a.predictedDrain >= 40 ? "text-coral-500" : "text-mint-600"}`}>
                    -{a.actualDrain ?? a.predictedDrain}%
                  </span>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
