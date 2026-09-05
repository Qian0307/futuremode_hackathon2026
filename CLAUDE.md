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

## Track D（選配，時間允許再做）：ElevenLabs 語音輸入

> 定位：加分項，不影響核心 MVP。建議排在 Day 2 晚上或 Day 3 上午，核心功能穩定後再做。

### D1. 語音輸入元件
```
建立 components/VoiceInputButton.tsx，錄音按鈕（按住錄音、放開停止，用 MediaRecorder API 錄製瀏覽器麥克風音訊）。
錄音完成後將音檔（webm/mp3）送到 /api/voice-to-text。
UI 用 shadcn/ui 的 Button，錄音中顯示脈動動畫提示使用者正在收音。
```

### D2. ElevenLabs 語音轉文字 API
```
建立 POST /api/voice-to-text，接收音檔（multipart/form-data 或 base64），
呼叫 ElevenLabs Speech-to-Text API 轉成文字，回傳 { transcript: string }。
ElevenLabs API Key 只能在 server-side 讀取，不可出現在前端。
若轉錄失敗要有 fallback 提示（「語音辨識失敗，請直接輸入文字」），不可讓整個表單卡住。
```

### D3. 整合進活動輸入表單
```
在 Track B3 的新增活動表單頂部加入 VoiceInputButton。
使用者說出類似「明天晚上跟三個朋友吃飯，大概兩小時」，
呼叫 D2 取得文字後，再用一個簡單的 AI parsing API
（POST /api/parse-voice-activity，用 OpenAI gpt-4o-mini 把自然語言轉成結構化欄位：
type, headcount, familiarity, durationMinutes, scheduledAt），
自動帶入表單欄位，使用者可再手動微調後送出。
此 parsing API 需符合 /lib/types.ts 的 Activity 欄位命名，並用 Zod 驗證輸出。
```

### D4. 安全與體驗細節
```
1. 麥克風權限被拒絕時，表單要能正常降級為純文字輸入，不可阻擋核心流程。
2. 錄音檔案大小與時長需限制（例如上限 30 秒），避免不必要的 API 成本。
3. 語音轉文字與 AI parsing 屬於非核心功能，若 demo 現場網路不穩，須確保「手動填表單」這條路徑隨時可用。
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

### Day 3 上午（⚠️ 截止時間更正為 09/06 10:00，不是 11:00）
- [ ] 07:00-08:30　最後修 bug + 正式部署到 Cloudflare Pages
- [ ] 08:30-09:00　錄製最長 2 分鐘的 YouTube 評選影片
- [ ] 09:00-09:30　上傳影片設為公開、撰寫 README、補完 100-200 字問題與解法摘要、確認 GitHub repo 為 Public 且含 LICENSE
- [ ] 09:30-10:00　緩衝時間，正式送出繳交表單
- [ ] 檢查所有 API Key 沒有外洩到前端或 commit 進公開 repo（用 .env + .gitignore）
- [ ] （選配）若 Track D 語音輸入有做，確認麥克風權限被拒時能正常降級為文字輸入，不影響核心流程展示

---

## Track E：繳交準備（依 SITCON Hackathon 2026 官方繳交規則）

> 截止：**09/06 10:00**。繳交項目共 6 項，建議 Day 2 晚上就先把能提前準備的做完，不要全部留到 Day 3 早上。

### E1. 隊伍資料與賽道確認
```
確認隊名、隊員名單、主賽道（AI for Everyday Life）、
以及是否要勾選任何贊助商挑戰（例如若有做 Track D 的 ElevenLabs 語音輸入，記得勾選對應挑戰）。
```

### E2. 100–200 字問題與解法摘要（建議 Day 2 晚上先寫草稿）
```
撰寫 100-200 字的問題與解法摘要，結構建議：
1. 一句話痛點（內向者/高敏感族群不易察覺社交能量耗盡）
2. 一句話解法（用 AI 預測社交活動的能量消耗，像手機電池一樣視覺化並規劃一週行程）
3. 一句話心理學依據（奠基於外向性人格理論與資源保存理論）
4. 一句話技術亮點（Next.js + Cloudflare + AI 個人化學習校準機制）
字數需控制在 100-200 字之間，中英文皆需注意字數規則（若官方有特別說明中英字數算法需再確認）。
```

### E3. GitHub 儲存庫公開與授權
```
1. 確認 repo 設為 Public
2. 加入 LICENSE 檔案（建議用 MIT License，內容簡單且業界慣用）
3. 確認 .gitignore 有排除 .env、node_modules、任何含 API Key 的檔案
4. 用 git log 或 GitHub 的 secret scanning 功能，最後確認沒有任何 API Key 被 commit 進歷史紀錄
```

### E4. README 撰寫
```
撰寫 README.md，需包含：
1. 專案介紹（一段話說明社交電量計是什麼、解決什麼問題）
2. 系統架構說明（前端 Next.js + 後端 API Routes + Cloudflare D1 資料庫 + OpenAI API，
   可用簡單文字或 ASCII 圖示說明資料流：使用者輸入 → predict-drain API → OpenAI → 存入 D1 → 前端視覺化）
3. 本地執行方式（git clone → npm install → 設定 .env（OPENAI_API_KEY）→ npm run dev）
4. 部署方式（wrangler pages deploy 步驟）
5. 使用到的第三方 API/套件與來源說明（OpenAI API、shadcn/ui、Drizzle ORM、Cloudflare D1，若有用到 ElevenLabs 也列入）
6. 心理學理論依據簡述（可直接引用計劃書第 9 節的參考文獻列表）
```

### E5. 作品展示網址確認（選填但強烈建議）
```
確認 Cloudflare Pages 正式部署網址可以正常打開、跑過一次完整流程（onboarding → 新增活動 → 電量預測 → 一週總覽），
沒有明顯 bug 或 console error。
```

### E6. 2 分鐘 YouTube 展示影片腳本
```
腳本架構（總長不超過 2 分鐘）：
0:00-0:15　痛點開場（一句話點出「你知道自己什麼時候會社交過載嗎？」）
0:15-0:30　解法一句話介紹 + 心理學理論依據帶過
0:30-1:30　實際 demo（用 Track C3 準備好的 demo 資料，展示 onboarding → 新增活動 → 電量預測 → 
           一週總覽 + 風險預警 → 事後回報校準，一鏡到底不要中斷）
1:30-1:50　技術亮點簡述（Next.js + Cloudflare + OpenAI，若有用 ElevenLabs 語音輸入也秀一下）
1:50-2:00　收尾（隊名、專案名稱）
錄製工具：OBS Studio 或直接用瀏覽器內建錄影 + 手機錄旁白，剪輯可用 CapCut 或 iMovie 快速完成。
影片上傳 YouTube 後記得設為「公開」或「非公開但知道連結的人可觀看」，並確認繳交表單能正確嵌入連結。
```
