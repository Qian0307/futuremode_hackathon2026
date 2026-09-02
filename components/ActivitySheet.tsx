"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Slider } from "@/components/ui/slider";
import { ACTIVITY_META, ACTIVITY_TYPES, FAMILIARITY_LABELS, formatDuration } from "@/lib/activity-meta";
import { errorMessage } from "@/lib/http";
import type { Activity, ActivityType } from "@/lib/types";

export interface ActivitySheetProps {
  /** 新增成功後通知父層重新載入 */
  onCreated?: (activity: Activity, reason: string) => void;
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
  const [familiarity, setFamiliarity] = React.useState(3);
  const [durationMinutes, setDurationMinutes] = React.useState(90);
  const [scheduledAt, setScheduledAt] = React.useState(defaultScheduledAt);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/activities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, headcount, familiarity, durationMinutes, scheduledAt }),
      });
      if (!res.ok) throw new Error(await errorMessage(res, "新增失敗"));
      const payload = (await res.json()) as { activity: Activity; reason: string };
      onCreated?.(payload.activity, payload.reason);
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
            <Slider min={1} max={5} step={1} value={[familiarity]} onValueChange={([v]) => setFamiliarity(v)} />
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
            {submitting ? "AI 估算中…" : "加入行程"}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}

export default ActivitySheet;
