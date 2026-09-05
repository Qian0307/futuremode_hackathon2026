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
  className?: string;
}

type State = "idle" | "recording" | "uploading" | "unavailable";

/**
 * 按住錄音、放開停止。
 *
 * D4-1：麥克風權限被拒、瀏覽器不支援、或後端沒設 ElevenLabs key 時，
 * 元件會自己收起來（state = unavailable）並顯示提示，
 * 讓使用者照常用底下的表單手動填——絕不阻擋核心流程。
 */
export function VoiceInputButton({ onTranscript, disabled, className }: VoiceInputButtonProps) {
  const [state, setState] = React.useState<State>("idle");
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
        | { transcript?: string; error?: string; fallback?: string }
        | null;

      if (!res.ok || !payload?.transcript) {
        setState("idle");
        setHint(payload?.fallback ?? payload?.error ?? "語音辨識失敗，請直接輸入文字");
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

  if (state === "unavailable") {
    return <p className={cn("text-xs text-muted-foreground", className)}>{hint}</p>;
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
