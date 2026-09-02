"use client";

import * as React from "react";
import { animate, motion, useMotionValue, useTransform } from "framer-motion";
import { cn } from "@/lib/utils";

export interface BatteryGaugeProps {
  /** 電量 0-100 */
  value: number;
  size?: "lg" | "sm";
  /** 電池下方的說明文字（例如日期） */
  label?: string;
  className?: string;
}

const LOW_THRESHOLD = 20;

/** 純前端展示元件：不打任何 API，給定 0-100 就會畫出液體填充的電池。 */
export function BatteryGauge({ value, size = "lg", label, className }: BatteryGaugeProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  const isLow = clamped < LOW_THRESHOLD;

  // viewBox 座標：外框 + 內部液體區域
  const INNER_TOP = 34;
  const INNER_HEIGHT = 168;

  const level = useMotionValue(clamped);
  const displayValue = useTransform(level, (v) => `${Math.round(v)}`);
  const liquidY = useTransform(level, (v) => INNER_TOP + INNER_HEIGHT * (1 - v / 100));

  React.useEffect(() => {
    const controls = animate(level, clamped, { type: "spring", stiffness: 55, damping: 15, mass: 1 });
    return () => controls.stop();
  }, [clamped, level]);

  const gradientId = React.useId();
  const clipId = React.useId();

  const fillFrom = isLow ? "#fda4a4" : "#86efbe";
  const fillTo = isLow ? "#f43f5e" : "#38bdf8";

  const box = size === "lg" ? "w-44" : "w-16";
  const textSize = size === "lg" ? 46 : 54;

  return (
    <div className={cn("flex flex-col items-center gap-2", className)}>
      <svg
        viewBox="0 0 120 220"
        className={cn(box, "h-auto", isLow ? "battery-glow-low" : "battery-glow")}
        role="img"
        aria-label={`電量 ${clamped}%`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={fillFrom} />
            <stop offset="100%" stopColor={fillTo} />
          </linearGradient>
          <clipPath id={clipId}>
            <rect x="14" y={INNER_TOP} width="92" height={INNER_HEIGHT} rx="18" />
          </clipPath>
        </defs>

        {/* 電池頭 */}
        <rect x="45" y="6" width="30" height="12" rx="6" className="fill-slate-300" />
        {/* 電池外殼 */}
        <rect x="10" y="22" width="100" height="192" rx="26" className="fill-white/70 stroke-slate-200" strokeWidth="3" />

        {/* 液體 */}
        <g clipPath={`url(#${clipId})`}>
          <motion.g style={{ y: liquidY }}>
            {/* 兩段相接的波浪，水平循環位移做出流動感 */}
            <motion.g
              animate={{ x: [0, -120, 0] }}
              transition={{ duration: 7, repeat: Infinity, ease: "linear" }}
            >
              <path
                d="M-120 8 Q -90 0 -60 8 T 0 8 T 60 8 T 120 8 T 180 8 T 240 8 V 220 H -120 Z"
                fill={`url(#${gradientId})`}
              />
            </motion.g>
          </motion.g>
        </g>

        {/* 內框描邊，蓋住液體邊緣 */}
        <rect x="14" y={INNER_TOP} width="92" height={INNER_HEIGHT} rx="18" fill="none" className="stroke-white/60" strokeWidth="2" />

        {/* 數值 */}
        <motion.text
          x="60"
          y={size === "lg" ? 130 : 136}
          textAnchor="middle"
          fontSize={textSize}
          fontWeight="700"
          className={cn("select-none", clamped > 55 ? "fill-white" : "fill-slate-700")}
        >
          {displayValue}
        </motion.text>
        {size === "lg" && (
          <text
            x="60"
            y="158"
            textAnchor="middle"
            fontSize="18"
            fontWeight="600"
            className={cn("select-none", clamped > 55 ? "fill-white/80" : "fill-slate-400")}
          >
            %
          </text>
        )}
      </svg>
      {label && <span className="text-xs font-medium text-muted-foreground">{label}</span>}
    </div>
  );
}

export default BatteryGauge;
