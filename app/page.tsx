"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ActivitySheet } from "@/components/ActivitySheet";
import { BatteryGauge } from "@/components/BatteryGauge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ACTIVITY_META, formatDuration, formatTime } from "@/lib/activity-meta";
import {
  fetchWeek,
  reportActualDrain,
  todayInTaipei,
  UnauthorizedError,
  type CreateActivityResponse,
  type WeekResponse,
} from "@/lib/client-api";
import type { Activity } from "@/lib/types";

export default function TodayPage() {
  const router = useRouter();
  const [data, setData] = React.useState<WeekResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);
  /** 後端正在背景用 AI 重算的活動 id；用來顯示「AI 校準中」並排定 refetch */
  const [refiningIds, setRefiningIds] = React.useState<string[]>([]);
  const timers = React.useRef<ReturnType<typeof setTimeout>[]>([]);

  React.useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  const load = React.useCallback(async () => {
    try {
      // 首頁不需要一週預警文字，關掉可以省一次 AI 呼叫、載入更快
      setData(await fetchWeek({ warnings: false }));
      setError(null);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.replace("/onboarding");
        return;
      }
      setError(err instanceof Error ? err.message : "讀取失敗");
    } finally {
      setLoading(false);
    }
  }, [router]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const today = todayInTaipei();
  const todaySummary = data?.days.find((d) => d.date === today);
  const activities = todaySummary?.activities ?? [];
  const remaining = todaySummary?.remainingBattery ?? data?.profile.baseBatteryCapacity ?? 100;

  // 已過時間但還沒回報的活動
  const pending = activities.filter((a) => a.actualDrain === null && new Date(a.scheduledAt).getTime() + a.durationMinutes * 60_000 < Date.now());

  /**
   * 新增活動不等 AI：後端先用規則式估算存檔並回應，AI 在背景重算。
   * 這裡先立刻把規則值畫出來，再排兩次 refetch 去接修正後的數字。
   */
  async function handleCreated(result: CreateActivityResponse) {
    const { activity, reason, refining } = result;
    setToast(`已加入，預估 -${activity.predictedDrain}%。${reason}`);
    await load();

    if (!refining) return;

    setRefiningIds((prev) => [...prev, activity.id]);
    // AI 通常 2-5 秒內回來；抓兩次，最後一次順便把標記清掉
    const schedule = (delay: number, isLast: boolean) => {
      const t = setTimeout(async () => {
        await load();
        if (isLast) setRefiningIds((prev) => prev.filter((id) => id !== activity.id));
      }, delay);
      timers.current.push(t);
    };
    schedule(2500, false);
    schedule(6000, true);
  }

  async function handleReport(activity: Activity, feedback: "more" | "same" | "less") {
    try {
      const result = await reportActualDrain(activity.id, feedback);
      setToast(
        result.capacityChanged
          ? `收到，已把你的基礎電池容量調整為 ${result.baseBatteryCapacity}%`
          : "收到，下次的預測會更貼近你"
      );
      await load();
    } catch (err) {
      setToast(err instanceof Error ? err.message : "回報失敗");
    }
  }

  if (loading) {
    return <p className="py-24 text-center text-muted-foreground">載入中…</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col items-center gap-3 pt-2">
        <BatteryGauge value={remaining} size="lg" />
        <p className="text-center text-sm text-muted-foreground">
          {activities.length === 0
            ? "今天還沒有安排社交活動，電量是滿的。"
            : `今天有 ${activities.length} 場活動，預計會用掉 ${todaySummary?.totalDrain ?? 0}% 電量。`}
        </p>
        {data?.profile.summary && (
          <p className="max-w-xs text-center text-xs leading-relaxed text-muted-foreground/80">{data.profile.summary}</p>
        )}
      </section>

      {pending.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground/70">回報一下實際感受</h2>
          {pending.map((a) => (
            <motion.div key={a.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
              <Card className="border-mint-300/60 bg-mint-50/80">
                <CardContent className="space-y-3 p-5">
                  <p className="text-sm">
                    {ACTIVITY_META[a.type].emoji} {formatTime(a.scheduledAt)} 的{ACTIVITY_META[a.type].label}結束了，
                    實際消耗跟預估的 <span className="font-semibold">{a.predictedDrain}%</span> 比起來？
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    <Button variant="outline" size="sm" onClick={() => handleReport(a, "more")}>
                      比預期多
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => handleReport(a, "same")}>
                      差不多
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => handleReport(a, "less")}>
                      比預期少
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </section>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground/70">今日行程</h2>
          <Link href="/week" className="text-xs text-mint-600 hover:underline">
            看一週 →
          </Link>
        </div>

        {activities.length === 0 ? (
          <Card>
            <CardContent className="space-y-3 p-6 text-center text-sm text-muted-foreground">
              <p>空白的一天。要不要先把接下來的活動加進來看看？</p>
              <a href="/week?demo=1" className="inline-block text-xs text-mint-600 underline underline-offset-4">
                或先看一份示範情境
              </a>
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-2">
            {activities.map((a) => (
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
                        {a.headcount} 人 · {formatDuration(a.durationMinutes)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className={`text-lg font-semibold ${a.predictedDrain >= 40 ? "text-coral-500" : "text-mint-600"}`}>
                        -{a.actualDrain ?? a.predictedDrain}%
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {refiningIds.includes(a.id) ? (
                          <span className="animate-pulse text-mint-600">AI 校準中…</span>
                        ) : a.actualDrain !== null ? (
                          "實際"
                        ) : (
                          "預估"
                        )}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ActivitySheet onCreated={handleCreated} />

      {error && <p className="text-center text-sm text-destructive">{error}</p>}
      {toast && <p className="text-center text-sm text-mint-600">{toast}</p>}
    </div>
  );
}
