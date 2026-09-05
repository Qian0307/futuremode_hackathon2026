"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Sparkles, TrendingDown, TrendingUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { ACTIVITY_META, formatMonthDay, formatTime } from "@/lib/activity-meta";
import { fetchReview, UnauthorizedError, type ReviewResponse } from "@/lib/client-api";

export default function ReviewPage() {
  const router = useRouter();
  const [data, setData] = React.useState<ReviewResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    (async () => {
      try {
        setData(await fetchReview());
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

  if (loading) return <p className="py-24 text-center text-muted-foreground">整理過去七天…</p>;
  if (error) return <p className="py-24 text-center text-sm text-destructive">{error}</p>;
  if (!data) return null;

  const { accuracy, breakdown, summary, activities } = data;
  const reportedRate = activities.length === 0 ? 0 : Math.round((accuracy.reported / activities.length) * 100);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">過去這一週</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {formatMonthDay(data.startDate)} – {formatMonthDay(data.endDate)}．
          {activities.length} 場活動，回報了 {accuracy.reported} 場（{reportedRate}%）
        </p>
      </div>

      {/* AI 回顧 */}
      {summary && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="border-mint-300/60 bg-gradient-to-br from-mint-50/90 to-sky-100/60">
            <CardContent className="space-y-3 p-6">
              <div className="flex items-center gap-2 text-mint-600">
                <Sparkles className="h-4 w-4" />
                <span className="text-xs font-semibold">本週回顧</span>
              </div>
              <p className="text-base font-semibold leading-relaxed">{summary.headline}</p>
              {summary.observations.length > 0 && (
                <ul className="space-y-1.5">
                  {summary.observations.map((o, i) => (
                    <li key={i} className="flex gap-2 text-sm leading-relaxed text-foreground/80">
                      <span className="text-mint-500">•</span>
                      {o}
                    </li>
                  ))}
                </ul>
              )}
              <p className="rounded-2xl bg-white/70 p-3 text-sm leading-relaxed text-foreground/80">
                {summary.suggestion}
              </p>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* 預測準確度 */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground/70">預測準不準</h2>
        <div className="grid grid-cols-3 gap-2">
          <StatTile label="平均誤差" value={accuracy.avgError === null ? "—" : `${accuracy.avgError}`} unit="百分點" />
          <StatTile label="高估" value={String(accuracy.overestimated)} unit="次" />
          <StatTile label="低估" value={String(accuracy.underestimated)} unit="次" />
        </div>
        {accuracy.reported < 2 && (
          <p className="text-xs text-muted-foreground">
            回報的資料還太少。活動結束後點一下「比預期多／差不多／少」，這裡就會開始有意義。
          </p>
        )}
      </section>

      {/* 依活動類型的偏差 */}
      {breakdown.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground/70">哪一類活動最耗電</h2>
          <ul className="space-y-2">
            {breakdown.map((b) => (
              <li key={b.type}>
                <Card>
                  <CardContent className="flex items-center gap-4 p-4">
                    <span className="text-2xl" aria-hidden>
                      {ACTIVITY_META[b.type].emoji}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{b.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {b.count} 場．預測平均 -{b.avgPredicted}%
                        {b.avgActual !== null && `．實際平均 -${b.avgActual}%`}
                      </p>
                    </div>
                    {b.bias !== null && b.bias !== 0 && (
                      <span
                        className={`flex items-center gap-1 text-sm font-semibold ${
                          b.bias > 0 ? "text-coral-500" : "text-mint-600"
                        }`}
                      >
                        {b.bias > 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                        {b.bias > 0 ? "+" : ""}
                        {b.bias}
                      </span>
                    )}
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            紅色代表系統低估了這類活動——實際比預測更耗電。
          </p>
        </section>
      )}

      {/* 逐筆紀錄 */}
      {activities.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground/70">逐筆紀錄</h2>
          <ul className="space-y-2">
            {activities.map((a) => {
              const diff = a.actualDrain === null ? null : a.actualDrain - a.predictedDrain;
              return (
                <li key={a.id}>
                  <Card>
                    <CardContent className="flex items-center gap-3 p-4">
                      <span className="text-xl" aria-hidden>
                        {ACTIVITY_META[a.type].emoji}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">
                          {formatMonthDay(a.scheduledAt.slice(0, 10))} {formatTime(a.scheduledAt)}．
                          {ACTIVITY_META[a.type].label}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          預測 -{a.predictedDrain}%
                          {a.actualDrain !== null ? `．實際 -${a.actualDrain}%` : "．未回報"}
                        </p>
                      </div>
                      {diff !== null && diff !== 0 && (
                        <span className={`text-sm font-semibold ${diff > 0 ? "text-coral-500" : "text-mint-600"}`}>
                          {diff > 0 ? "+" : ""}
                          {diff}
                        </span>
                      )}
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {activities.length === 0 && (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            過去七天沒有活動紀錄。等你用一陣子之後，這裡會看到預測和實際的落差。
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatTile({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <Card>
      <CardContent className="p-4 text-center">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold text-foreground">{value}</p>
        <p className="text-[10px] text-muted-foreground">{unit}</p>
      </CardContent>
    </Card>
  );
}
