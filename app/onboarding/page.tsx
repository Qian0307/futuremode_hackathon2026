"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { BatteryGauge } from "@/components/BatteryGauge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { errorMessage } from "@/lib/http";
import { ONBOARDING_QUESTIONS } from "@/lib/onboarding";
import type { PersonalityProfile } from "@/lib/types";

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = React.useState(0);
  const [answers, setAnswers] = React.useState<number[]>([]);
  const [submitting, setSubmitting] = React.useState(false);
  const [profile, setProfile] = React.useState<PersonalityProfile | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const total = ONBOARDING_QUESTIONS.length;
  const question = ONBOARDING_QUESTIONS[step];
  const progress = profile ? 100 : Math.round((step / total) * 100);

  async function submit(finalAnswers: number[]) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: finalAnswers }),
      });
      if (!res.ok) throw new Error(await errorMessage(res, "送出失敗"));
      const data = (await res.json()) as { profile: PersonalityProfile };
      setProfile(data.profile);
    } catch (err) {
      setError(err instanceof Error ? err.message : "送出失敗，請再試一次");
    } finally {
      setSubmitting(false);
    }
  }

  function choose(optionIndex: number) {
    const next = [...answers];
    next[step] = optionIndex;
    setAnswers(next);
    if (step + 1 < total) {
      setStep(step + 1);
    } else {
      void submit(next);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* 第一次進站的人在這裡才第一次知道這是什麼——沒有這段，
          使用者會直接被丟進 6 題問卷，完全不知道自己在填什麼 */}
      {step === 0 && !profile && !submitting && (
        <div className="rounded-3xl bg-white/60 p-5 text-center backdrop-blur">
          <p className="text-sm font-semibold text-foreground">社交電量計</p>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            像手機電池一樣管理你的社交能量。先用 6 題算出你的基礎電量，
            之後每場聚會、會議、約會會消耗多少，都幫你先算好。
          </p>
        </div>
      )}

      {/* 進度條 */}
      <div className="space-y-2">
        <div className="h-2 w-full overflow-hidden rounded-full bg-white/70">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-mint-400 to-sky-400"
            animate={{ width: `${progress}%` }}
            transition={{ type: "spring", stiffness: 120, damping: 20 }}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {profile ? "完成了" : `第 ${step + 1} 題 / 共 ${total} 題`}
        </p>
      </div>

      <AnimatePresence mode="wait">
        {profile ? (
          <motion.div
            key="result"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center gap-6 pt-4"
          >
            <BatteryGauge value={profile.baseBatteryCapacity} size="lg" />
            <Card className="w-full">
              <CardContent className="space-y-3 p-6 text-center">
                <p className="text-sm font-medium text-mint-600">你的社交電池</p>
                <p className="text-base leading-relaxed text-foreground">{profile.summary}</p>
              </CardContent>
            </Card>
            <Button size="lg" className="w-full" onClick={() => router.push("/")}>
              進入我的電量計
            </Button>
          </motion.div>
        ) : submitting ? (
          <motion.p key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="py-16 text-center text-muted-foreground">
            正在計算你的電池容量…
          </motion.p>
        ) : (
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.22 }}
            className="space-y-4"
          >
            <h1 className="text-2xl font-semibold leading-relaxed tracking-tight">{question.question}</h1>
            <p className="text-sm text-muted-foreground">沒有標準答案，選最接近你的那個就好。</p>
            <div className="space-y-3 pt-2">
              {question.options.map((opt, i) => (
                <Card key={i} className="transition hover:-translate-y-0.5 hover:shadow-md">
                  <Button
                    variant="ghost"
                    onClick={() => choose(i)}
                    className="h-auto w-full justify-start whitespace-normal rounded-3xl px-5 py-4 text-left text-base font-normal leading-relaxed"
                  >
                    {opt.label}
                  </Button>
                </Card>
              ))}
            </div>
            <div className="flex items-center justify-between pt-1">
              {step > 0 ? (
                <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setStep(step - 1)}>
                  ← 回上一題
                </Button>
              ) : (
                <span />
              )}
              {/* 讓第一次來的人（例如評審）可以跳過問卷，直接看有資料的完整樣子 */}
              <a
                href="/week?demo=1"
                className="rounded-full px-3 py-1.5 text-xs text-mint-600 underline-offset-4 hover:underline"
              >
                先看示範情境 →
              </a>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
