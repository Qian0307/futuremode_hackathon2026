"use client";

import * as React from "react";
import { Loader2, Mic, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** D4-2：錄音上限 30 秒，避免不必要的 API 成本。 */
const MAX_RECORDING_SECONDS = 30;

export interface VoiceInputButtonProps {
  /** 拿到辨識出的文字後的回呼 */
  onTranscript: (transcript: string) => void | Promise<void>;
  /** 外層正在處理（例如 AI 解析中）時停用按鈕 */
  disabled?: boolean;
  /** 服務可用性變化時通知外層，讓包住這個元件的容器也能一起收掉 */
  onAvailabilityChange?: (available: boolean) => void;
  className?: string;
}

type State = "checking" | "idle" | "recording" | "uploading" | "unavailable";

/**
 * 按住錄音、放開停止。
 *
 * D4-1：麥克風權限被拒、瀏覽器不支援、或後端沒設 ElevenLabs key 時，
 * 元件會自己收起來（state = unavailable）並顯示提示，
 * 讓使用者照常用底下的表單手動填——絕不阻擋核心流程。
 */
export function VoiceInputButton({ onTranscript, disabled, onAvailabilityChange, className }: VoiceInputButtonProps) {
  const [state, setState] = React.useState<State>("checking");
  const [seconds, setSeconds] = React.useState(0);
  const [hint, setHint] = React.useState<string | null>(null);

  const recorderRef = React.useRef<MediaRecorder | null>(null);
  const chunksRef = React.useRef<Blob[]>([]);
  const streamRef = React.useRef<MediaStream | null>(null);
  const tickRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const autoStopRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const cleanup = React.useCallback(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    if (autoStopRef.current) clearTimeout(autoStopRef.current);
    tickRef.current = null;
    autoStopRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
    setSeconds(0);
  }, []);

  React.useEffect(() => cleanup, [cleanup]);

  // 掛載時先問後端有沒有開啟語音服務。沒開就完全不顯示，
  // 使用者直接用下面的表單，不會被一顆按不動的按鈕誤導。
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/voice-to-text");
        const payload = (await res.json().catch(() => null)) as { configured?: boolean } | null;
        if (cancelled) return;
        const available = Boolean(payload?.configured);
        setState(available ? "idle" : "unavailable");
        onAvailabilityChange?.(available);
      } catch {
        if (cancelled) return;
        setState("unavailable");
        onAvailabilityChange?.(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onAvailabilityChange]);

  async function startRecording() {
    if (state !== "idle" || disabled) return;
    setHint(null);

    if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setState("unavailable");
      setHint("這個瀏覽器不支援錄音，請直接輸入文字");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];

      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => void upload();
      recorder.start();

      setState("recording");
      setSeconds(0);
      tickRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
      autoStopRef.current = setTimeout(stopRecording, MAX_RECORDING_SECONDS * 1000);
    } catch {
      // D4-1：權限被拒不是錯誤，是要安靜降級
      setState("unavailable");
      setHint("沒有麥克風權限，請直接輸入文字");
      cleanup();
    }
  }

  function stopRecording() {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
      setState("uploading");
    }
  }

  async function upload() {
    const mimeType = recorderRef.current?.mimeType || "audio/webm";
    const blob = new Blob(chunksRef.current, { type: mimeType });
    cleanup();

    if (blob.size === 0) {
      setState("idle");
      setHint("沒有錄到聲音，再試一次或直接輸入文字");
      return;
    }

    try {
      const form = new FormData();
      form.append("audio", blob, mimeType.includes("mp4") ? "recording.mp4" : "recording.webm");

      const res = await fetch("/api/voice-to-text", { method: "POST", body: form });
      const payload = (await res.json().catch(() => null)) as
        | { transcript?: string; error?: string; fallback?: string; configured?: boolean }
        | null;

      // 服務沒開啟是永久性的，再按幾次也不會好——把按鈕收起來，只留一行說明。
      if (res.status === 503 || payload?.configured === false) {
        setState("unavailable");
        setHint(payload?.error ?? "這個環境沒有開啟語音輸入，請直接填下面的欄位");
        onAvailabilityChange?.(false);
        return;
      }

      if (!res.ok || !payload?.transcript) {
        setState("idle");
        setHint(payload?.fallback ?? "語音辨識失敗，請直接輸入文字");
        return;
      }

      setState("idle");
      setHint(null);
      await onTranscript(payload.transcript);
    } catch {
      setState("idle");
      setHint("語音辨識失敗，請直接輸入文字");
    }
  }

  // 探測中不佔版面，避免畫面閃一下
  if (state === "checking") return null;

  // 服務不可用：有原因就說一句，沒有就安靜地不顯示（表單本身已經完整可用）
  if (state === "unavailable") {
    return hint ? <p className={cn("text-xs text-muted-foreground", className)}>{hint}</p> : null;
  }

  const recording = state === "recording";
  const uploading = state === "uploading";

  return (
    <div className={cn("space-y-2", className)}>
      <Button
        type="button"
        variant={recording ? "default" : "outline"}
        className={cn("w-full", recording && "bg-coral-400 hover:bg-coral-500")}
        disabled={disabled || uploading}
        onPointerDown={startRecording}
        onPointerUp={stopRecording}
        onPointerLeave={stopRecording}
        // 手機長按會觸發選字選單，這裡擋掉
        onContextMenu={(e) => e.preventDefault()}
      >
        {uploading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            辨識中…
          </>
        ) : recording ? (
          <>
            <span className="relative flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-white" />
            </span>
            收音中… {seconds}s / {MAX_RECORDING_SECONDS}s（放開結束）
          </>
        ) : (
          <>
            <Mic className="h-4 w-4" />
            按住說出你的活動
          </>
        )}
      </Button>

      {!recording && !uploading && !hint && (
        <p className="text-center text-[11px] text-muted-foreground">
          例如「明天晚上跟三個朋友吃飯，大概兩小時」
        </p>
      )}
      {hint && <p className="text-center text-xs text-coral-500">{hint}</p>}
      {recording && (
        <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-coral-400 transition-all duration-1000 ease-linear"
            style={{ width: `${(seconds / MAX_RECORDING_SECONDS) * 100}%` }}
          />
        </div>
      )}
    </div>
  );
}

export default VoiceInputButton;
