"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { CalendarCheck, CalendarX, Sparkles } from "lucide-react";
import { ActivitySheet } from "@/components/ActivitySheet";
import { VoiceInputButton } from "@/components/VoiceInputButton";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { formatMonthDay, formatWeekday } from "@/lib/activity-meta";
import {
  suggestSchedule,
  UnauthorizedError,
  type ScheduleSuggestionDTO,
  type ScheduleSuggestResponse,
} from "@/lib/client-api";

const RATING_STYLE: Record<ScheduleSuggestionDTO["rating"], { label: string; card: string; badge: string }> = {
  best: { label: "最推薦", card: "border-mint-300/70 bg-mint-50/70", badge: "bg-mint-500 text-white" },
  ok: { label: "可以", card: "border-sky-300/60 bg-sky-100/40", badge: "bg-sky-400 text-white" },
  avoid: { label: "不建議", card: "border-coral-300/60 bg-coral-300/10", badge: "bg-coral-400 text-white" },
};

export default function PlanPage() {
  const router = useRouter();
  const [description, setDescription] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [result, setResult] = React.useState<Extract<ScheduleSuggestResponse, { crisis?: false }> | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function run(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    setMessage(null);
    setResult(null);
    try {
      const res = await suggestSchedule({ description: trimmed });
      if (res.crisis) {
        setMessage(res.message);
        return;
      }
      setResult(res);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.replace("/onboarding");
        return;
      }
      setError(err instanceof Error ? err.message : "產生建議失敗");
    } finally {
      setLoading(false);
    }
  }

  async function handleTranscript(transcript: string) {
    setDescription(transcript);
    await run(transcript);
  }

  const best = result?.suggestions.filter((s) => s.rating === "best") ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">幫我排這場活動</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          說出你想安排的活動，AI 會看你未來七天的電量，建議排在哪一天比較不會透支。
        </p>
      </div>

      <Card>
        <CardContent className="space-y-4 p-5">
          <VoiceInputButton onTranscript={handleTranscript} disabled={loading} />

          <div className="space-y-2">
            <Label htmlFor="desc">或直接打字</Label>
            <textarea
              id="desc"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="跟五個不太熟的同學吃飯，大概兩小時"
              className="w-full resize-none rounded-2xl border border-input bg-white/80 px-4 py-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <Button className="w-full" disabled={loading || !description.trim()} onClick={() => void run(description)}>
            {loading ? "AI 排程中…" : "找出最適合的時間"}
          </Button>
        </CardContent>
      </Card>

      {message && <p className="text-center text-sm text-foreground/80">{message}</p>}
      {error && <p className="text-center text-sm text-destructive">{error}</p>}

      {result && (
        <section className="space-y-3">
          <div className="flex items-center gap-2 text-mint-600">
            <Sparkles className="h-4 w-4" />
            <span className="text-sm font-semibold">
              這場活動預估消耗 {result.estimatedDrain}%
              {best.length > 0 && `，有 ${best.length} 天適合`}
            </span>
          </div>

          <ul className="space-y-2">
            {result.suggestions.map((s, i) => {
              const style = RATING_STYLE[s.rating];
              return (
                <motion.li
                  key={`${s.date}-${i}`}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                >
                  <Card className={style.card}>
                    <CardContent className="flex gap-3 p-4">
                      {s.rating === "avoid" ? (
                        <CalendarX className="mt-0.5 h-5 w-5 shrink-0 text-coral-500" />
                      ) : (
                        <CalendarCheck className="mt-0.5 h-5 w-5 shrink-0 text-mint-600" />
                      )}
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold">
                            {formatMonthDay(s.date)}（{formatWeekday(s.date)}）{s.startTime}
                          </span>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${style.badge}`}>
                            {style.label}
                          </span>
                        </div>
                        <p className="text-sm leading-relaxed text-foreground/80">{s.reason}</p>
                      </div>
                    </CardContent>
                  </Card>
                </motion.li>
              );
            })}
          </ul>

          <p className="text-xs text-muted-foreground">
            決定好時間之後，用下面的表單把它加進行程。
          </p>
          <ActivitySheet triggerLabel="加入這場活動" onCreated={() => router.push("/")} />
        </section>
      )}
    </div>
  );
}
