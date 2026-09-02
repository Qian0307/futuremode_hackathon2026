"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { AlertTriangle } from "lucide-react";
import { BatteryGauge } from "@/components/BatteryGauge";
import { Card, CardContent } from "@/components/ui/card";
import { ACTIVITY_META, formatMonthDay, formatTime, formatWeekday } from "@/lib/activity-meta";
import { fetchWeek, todayInTaipei, UnauthorizedError, type DaySummaryDTO, type WeekResponse } from "@/lib/client-api";

export default function WeekPage() {
  const router = useRouter();
  const [data, setData] = React.useState<WeekResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<string | null>(null);

  React.useEffect(() => {
    (async () => {
      try {
        const res = await fetchWeek();
        setData(res);
        setSelected(todayInTaipei());
      } catch (err) {
        if (err instanceof UnauthorizedError) {
          router.replace("/onboarding");
          return;
        }
        setError(err instanceof Error ? err.message : "讀取失敗");
      } finally {
        setLoading(false);
      }
    })();
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
        <p className="mt-1 text-sm text-muted-foreground">
          {lowDays.length === 0
            ? "整週的電量都在安全範圍，看起來安排得不錯。"
            : `有 ${lowDays.length} 天電量會低於 30%，往下看看建議。`}
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
                <div className="space-y-1">
                  <p className="text-sm font-semibold">
                    {formatMonthDay(day.date)}（{formatWeekday(day.date)}）· 剩餘 {day.remainingBattery}%
                  </p>
                  <p className="text-sm leading-relaxed text-foreground/80">
                    {day.warning ?? "這天的電量偏低，記得留一點獨處時間。"}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </section>
      )}

      {/* 選取那天的細節 */}
      {selectedDay && <DayDetail day={selectedDay} />}
    </div>
  );
}

function DayDetail({ day }: { day: DaySummaryDTO }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-foreground/70">
        {formatMonthDay(day.date)}（{formatWeekday(day.date)}）的行程
      </h2>
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
