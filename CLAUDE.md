# CLAUDE.md — 社交電量計（Social Battery Meter）開發指南

> 給 Claude Code / Codex 使用。本文件定義專案結構、共同契約、以及可平行開發的任務清單。
> **重要：所有 agent 開工前，必須先讀完「第 0 部分：共同契約」，不可跳過。**

---

## 0. 共同契約（所有 agent 必讀，不可自行更改）

### 0.1 技術棧鎖定版本
- Next.js 14 (App Router) + TypeScript 5.x
- Tailwind CSS 3.x + shadcn/ui
- Drizzle ORM + Cloudflare D1
- Framer Motion（動畫）
- Zod（驗證）
- 部署：Cloudflare Pages（`@cloudflare/next-on-pages`）

### 0.2 共用型別定義（`/lib/types.ts`）— 所有模組必須 import 使用，不可各自重新定義
```typescript
export type ActivityType = "meal" | "meeting" | "date" | "class" | "party" | "other";

export interface PersonalityProfile {
  baseBatteryCapacity: number; // 0-100
  summary: string; // 一句話人格摘要
  rechargeStyle: "solitude" | "specific_people" | "mixed";
}

export interface Activity {
  id: string;
  userId: string;
  type: ActivityType;
  headcount: number;
  familiarity: 1 | 2 | 3 | 4 | 5; // 1=陌生人, 5=最親密
  durationMinutes: number;
  scheduledAt: string; // ISO 8601
  predictedDrain: number; // 0-100
  actualDrain: number | null;
  createdAt: string;
}

export interface DrainPredictionRequest {
  activity: Pick<Activity, "type" | "headcount" | "familiarity" | "durationMinutes">;
  profile: PersonalityProfile;
}

export interface DrainPredictionResponse {
  predictedDrain: number; // 0-100
  reason: string; // 一句話說明
}
```

### 0.3 API 路由命名規則（不可自創其他路徑）
- `POST /api/onboarding` — 送出人格快篩答案，回傳 PersonalityProfile
- `POST /api/predict-drain` — 輸入 DrainPredictionRequest，回傳 DrainPredictionResponse
- `POST /api/activities` — 新增活動
- `GET /api/activities/week` — 取得本週活動與電量總覽
- `PATCH /api/activities/:id/actual-drain` — 回報事後實際消耗

### 0.4 Git 分工策略
```bash
# 每個 agent 用獨立 worktree，避免互相干擾檔案
git worktree add ../track-a-backend track-a-backend
git worktree add ../track-b-frontend track-b-frontend
git worktree add ../track-c-ai-prompt track-c-ai-prompt
```
- 每天結束前（Day1 晚、Day2 晚）主分支（`main`）強制做一次整合 merge + 跑一次完整流程測試
- 若型別對不上，一律以 `/lib/types.ts` 為準，回頭修改自己模組，不可修改共用型別檔案（除非三方都同意）

### 0.5 安全規範（每個 AI 呼叫的 prompt 都要包含）
- 絕不提供醫療診斷或危機處置建議
- 偵測到自傷/自殺/危機關鍵字時，回傳制式文字：「這聽起來很不容易，建議尋求專業心理協助或撥打安心專線 1925」，不自行處理
- OpenAI API Key 只能在 server-side 讀取（`process.env.OPENAI_API_KEY`），不可出現在任何 client component

---

## Track A：資料庫 + 後端 API（建議：Claude Code）

### A1. 專案初始化
```
建立 Next.js 14 (App Router) + TypeScript 專案，整合 Tailwind CSS 與 shadcn/ui。
設定可部署到 Cloudflare Pages（使用 @cloudflare/next-on-pages）。
建立資料夾結構：/app, /components, /lib, /db。
先建立 /lib/types.ts，內容見 CLAUDE.md 第 0.2 節，逐字建立，不可修改欄位名稱。
```

### A2. 資料庫 Schema
```
用 Drizzle ORM 定義 Cloudflare D1 資料表：
1. users: id, anonymous_session_id, personality_profile (JSON), base_battery_capacity, created_at
2. activities: id, user_id, type, headcount, familiarity, duration_minutes, scheduled_at, predicted_drain, actual_drain, created_at
型別需對應 /lib/types.ts 的 Activity 與 PersonalityProfile。
產生 migration 檔案並寫 seed script（3-5 筆測試資料）。
```

### A3. Onboarding API
```
建立 POST /api/onboarding，接收 6 題快篩問卷答案，
計算出 PersonalityProfile（baseBatteryCapacity, summary, rechargeStyle），
存入 users 表並回傳給前端。計算邏輯用簡單加權規則即可，不需呼叫 AI。
```

### A4. 電量預測 API
```
建立 POST /api/predict-drain，符合 /lib/types.ts 的 DrainPredictionRequest / DrainPredictionResponse。
呼叫 OpenAI API (gpt-4o-mini)，prompt 需包含第 0.5 節安全規範。
要求 AI 只回傳 JSON：{ "predictedDrain": number, "reason": string }。
用 Zod 驗證輸入與輸出，若 AI 回傳格式錯誤要有 fallback（用簡單規則計算一個預設值，避免整個功能掛掉）。
```

### A5. 活動 CRUD API
```
建立 POST /api/activities（新增活動，內部呼叫 A4 取得 predictedDrain 後一起存入）
與 GET /api/activities/week（回傳未來 7 天的活動列表 + 每天電量加總）。
```

### A6. 事後回報 API
```
建立 PATCH /api/activities/:id/actual-drain，接收使用者回報（比預期多/差不多/少），
更新該筆 actual_drain，並用簡單規則調整 users 表的 base_battery_capacity
（差距 >20% 時 ±5，否則不變）。
```

### A7. 資安與部署設定
```
1. 確認所有 API routes 都用 Zod 驗證輸入。
2. 產生 wrangler.toml，設定 D1 binding 與環境變數（OPENAI_API_KEY 設為 secret）。
3. 撰寫 README 部署步驟（wrangler pages deploy）。
4. 加上簡單的 rate limiting middleware，避免 API 被連續呼叫刷爆 credits。
```

---

## Track B：前端 UI（建議：Codex）

### B1. Onboarding 問卷 UI
```
建立 /app/onboarding 頁面，6 題單選題卡片式呈現，進度條在頂部，
每題選項用 shadcn/ui 的 Card + Button 呈現。
完成後呼叫 POST /api/onboarding（見 Track A2），並導向首頁。
配色：柔和薄荷綠 → 淺藍漸層，字體用 Inter 或思源黑體，語氣溫暖非評判性。
```

### B2. 電池視覺化元件
```
建立 components/BatteryGauge.tsx，用 SVG + Framer Motion，
接收 0-100 數值 props，電量高時填色薄荷綠，低於 20% 漸變珊瑚橘/紅色，
數值變化時用 spring animation 做液體填充效果，支援大/小兩種尺寸 (size: "lg" | "sm")。
不要依賴任何後端 API，純前端展示元件，方便獨立開發測試。
```

### B3. 新增活動表單
```
建立底部彈出表單（用 shadcn/ui 的 Sheet），欄位：
活動類型（下拉選單，對應 /lib/types.ts 的 ActivityType）、人數（滑桿）、
熟悉度（1-5 滑桿）、時長（15分鐘-4小時滑桿）、日期時間（date picker）。
送出時呼叫 POST /api/activities（Track A5），型別需符合 /lib/types.ts。
```

### B4. 今日首頁
```
建立 /app 首頁，置中顯示大型 BatteryGauge（size="lg"），
下方列出今日活動清單（時間、類型 icon、predictedDrain），
提供「新增活動」按鈕開啟 B3 的表單。
若有活動已過時間但 actualDrain 為 null，顯示回報卡片（呼叫 Track A6 的 API）。
```

### B5. 一週總覽頁
```
建立 /app/week 頁面，橫向排列 7 天，每天顯示 BatteryGauge(size="sm")，
呼叫 GET /api/activities/week 取得資料。
若某天電量低於 30%，該天下方顯示 AI 風險提醒文字（由 Track C 的 API 提供）。
```

---

## Track C：AI Prompt 工程（建議：你本人主導，可搭配一個 agent 協助寫程式外殼）

### C1. 電量消耗 Prompt 設計與測試
```
設計 predict-drain 的 system prompt，需要：
1. 納入心理學依據（外向性光譜、資源保存理論的概念，用白話說明給 LLM 聽）
2. 明確要求只回傳 JSON，欄位為 predictedDrain (0-100) 與 reason (一句話)
3. 針對至少 10 組不同的活動組合（獨處讀書會 vs. 20人派對等）手動測試，
   確認數值合理（避免所有結果都落在 50 上下，要有明顯區分度）
4. 加入第 0.5 節安全規範
把最終版 prompt 存成 /lib/prompts/predict-drain.ts，供 Track A4 使用。
```

### C2. 一週風險預警 Prompt 設計
```
設計一個 prompt，輸入一週 7 天的活動與電量資料，
輸出對電量過低日子的具體建議文字（例如：「週三有兩場社交活動，建議中間安排 30 分鐘獨處恢復」）。
語氣需溫暖、非評判性，符合第 0.5 節安全規範。
存成 /lib/prompts/weekly-risk-warning.ts。
```

### C3. Demo 情境資料設計
```
設計一組「假想使用者一週」的完整情境資料（人格測驗結果 + 7 天活動），
其中至少 2 天電量過低會觸發風險提醒，用來當 seed data，
確保 demo 當天不需要現場輸入大量資料就能展示完整流程。
```

---

## 整合檢查點（每天結束前執行）

### Day 1 晚上
- [ ] `/lib/types.ts` 三個 track 都在用同一份，沒有各自複製修改
- [ ] Track A 的 onboarding API 能被 Track B 的 onboarding 頁面成功呼叫
- [ ] Track C 的 prompt 草稿已交給 Track A 整合進 predict-drain API

### Day 2 晚上
- [ ] 新增活動 → 呼叫 predict-drain → 存入資料庫 → 首頁顯示，全流程跑得通
- [ ] 一週總覽頁能正確顯示 Track C 的風險預警文字
- [ ] 部署到 Cloudflare Pages 的 staging 版本可以打開

### Day 3 上午
- [ ] 用 Track C3 的 demo 資料跑一次完整流程，錄影存證
- [ ] 檢查所有 API Key 沒有外洩到前端
- [ ] 正式部署 + 最終 demo 腳本確認
