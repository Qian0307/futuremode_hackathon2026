"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { VoiceInputButton } from "@/components/VoiceInputButton";
import { Slider } from "@/components/ui/slider";
import { ACTIVITY_META, ACTIVITY_TYPES, FAMILIARITY_LABELS, formatDuration } from "@/lib/activity-meta";
import { createActivity, parseVoiceActivity, type CreateActivityResponse } from "@/lib/client-api";
import type { Activity, ActivityType } from "@/lib/types";

type Familiarity = Activity["familiarity"];

export interface ActivitySheetProps {
  /** 新增成功後通知父層重新載入；result.refining 為 true 代表 AI 還在背景重算 */
  onCreated?: (result: CreateActivityResponse) => void;
  triggerLabel?: string;
}

function defaultScheduledAt(): string {
  // datetime-local 需要 "YYYY-MM-DDTHH:mm"，預設為台北時間的下一個整點
  const now = new Date(Date.now() + 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
  return parts.replace(" ", "T").slice(0, 16).replace(/:\d{2}$/, ":00");
}

export function ActivitySheet({ onCreated, triggerLabel = "新增活動" }: ActivitySheetProps) {
  const [open, setOpen] = React.useState(false);
  const [type, setType] = React.useState<ActivityType>("meal");
  const [headcount, setHeadcount] = React.useState(4);
  const [familiarity, setFamiliarity] = React.useState<Familiarity>(3);
  const [durationMinutes, setDurationMinutes] = React.useState(90);
  const [scheduledAt, setScheduledAt] = React.useState(defaultScheduledAt);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Track D：語音填入的狀態
  const [parsing, setParsing] = React.useState(false);
  const [voiceNote, setVoiceNote] = React.useState<string | null>(null);
  const [uncertain, setUncertain] = React.useState<string[]>([]);
  const [voiceAvailable, setVoiceAvailable] = React.useState(true);

  /**
   * 語音 -> 文字 -> AI 解析 -> 自動帶入欄位。
   * 任何一步失敗都只是「欄位沒被填」，使用者照樣可以手動填完送出（D4-3）。
   */
  async function handleTranscript(transcript: string) {
    setParsing(true);
    setError(null);
    setUncertain([]);
    try {
      const result = await parseVoiceActivity(transcript);
      if (result.crisis) {
        setVoiceNote(null);
        setError(result.message);
        return;
      }
      const a = result.activity;
      setType(a.type);
      setHeadcount(a.headcount);
      setFamiliarity(Math.max(1, Math.min(5, a.familiarity)) as Familiarity);
      setDurationMinutes(a.durationMinutes);
      setScheduledAt(a.scheduledAt);
      setUncertain(a.uncertainFields);
      setVoiceNote(`聽到的是：「${transcript}」`);
    } catch (err) {
      setVoiceNote(null);
      setError(err instanceof Error ? err.message : "無法解析這段語音，請直接填下面的欄位");
    } finally {
      setParsing(false);
    }
  }

  const FIELD_LABELS: Record<string, string> = {
    type: "活動類型",
    headcount: "人數",
    familiarity: "熟悉度",
    durationMinutes: "時長",
    scheduledAt: "日期時間",
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await createActivity({ type, headcount, familiarity, durationMinutes, scheduledAt });
      onCreated?.(result);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "新增失敗，請再試一次");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button size="lg" className="w-full">
          <Plus className="h-5 w-5" />
          {triggerLabel}
        </Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>這場活動長什麼樣子？</SheetTitle>
          <SheetDescription>填完之後，AI 會估算它會耗掉你多少電量。</SheetDescription>
        </SheetHeader>

        {/* Track D：語音輸入。這個環境沒開啟語音時整塊收掉，只留下面的手動表單 */}
        <div
          className={
            voiceAvailable
              ? "mt-5 rounded-2xl border border-dashed border-mint-300/70 bg-mint-50/50 p-4"
              : "hidden"
          }
        >
          <VoiceInputButton
            onTranscript={handleTranscript}
            disabled={parsing || submitting}
            onAvailabilityChange={setVoiceAvailable}
          />
          {parsing && <p className="mt-2 text-center text-xs text-mint-600">AI 解析中…</p>}
          {voiceNote && <p className="mt-2 text-center text-xs text-muted-foreground">{voiceNote}</p>}
          {uncertain.length > 0 && (
            <p className="mt-2 text-center text-xs text-coral-500">
              這幾項是猜的，記得確認：{uncertain.map((f) => FIELD_LABELS[f] ?? f).join("、")}
            </p>
          )}
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-6">
          <div className="space-y-2">
            <Label>活動類型</Label>
            <Select value={type} onValueChange={(v) => setType(v as ActivityType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACTIVITY_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {ACTIVITY_META[t].emoji} {ACTIVITY_META[t].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-3">
            <div className="flex items-baseline justify-between">
              <Label>人數</Label>
              <span className="text-sm font-semibold text-mint-600">{headcount} 人</span>
            </div>
            <Slider min={1} max={50} step={1} value={[headcount]} onValueChange={([v]) => setHeadcount(v)} />
          </div>

          <div className="space-y-3">
            <div className="flex items-baseline justify-between">
              <Label>熟悉度</Label>
              <span className="text-sm font-semibold text-mint-600">{FAMILIARITY_LABELS[familiarity]}</span>
            </div>
            <Slider min={1} max={5} step={1} value={[familiarity]} onValueChange={([v]) => setFamiliarity(v as Familiarity)} />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>陌生人</span>
              <span>最親密</span>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-baseline justify-between">
              <Label>時長</Label>
              <span className="text-sm font-semibold text-mint-600">{formatDuration(durationMinutes)}</span>
            </div>
            <Slider min={15} max={240} step={15} value={[durationMinutes]} onValueChange={([v]) => setDurationMinutes(v)} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="scheduledAt">日期時間</Label>
            <input
              id="scheduledAt"
              type="datetime-local"
              required
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              className="h-11 w-full rounded-2xl border border-input bg-white/80 px-4 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button type="submit" size="lg" className="w-full" disabled={submitting}>
            {submitting ? "加入中…" : "加入行程"}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}

export default ActivitySheet;
