# 社交電量計 · Social Battery Meter

> **SITCON Hackathon 2026 · 賽道：AI for Everyday Life**
> 用 AI 幫「社交能量」建模——像手機電池一樣，預測每場社交活動會消耗多少心理能量，
> 並幫你規劃一週行程，在 burnout 發生**之前**就看見它。

---

## 1. 專案介紹

內向者與高敏感族群常常沒有意識到自己的社交能量已經見底，直到情緒崩潰或極度疲憊才驚覺。
現有的行事曆只管理「時間」，不管理「心理資源」——它會告訴你週三下午有空，
卻不會告訴你週二那場 25 人的迎新已經把你掏空了。

**社交電量計**把抽象的社交能量變成一顆看得見的電池：

1. **人格快篩**（6 題）→ 算出你的基礎電池容量與充電方式
2. **AI 消耗預測** → 輸入活動的類型、人數、熟悉度、時長，估算會掉幾 % 電
3. **跨日累積模型** → 睡一覺只回充八成，前一天的赤字會帶到隔天
4. **一週總覽 + 風險預警** → 標出電量過低的日子，給出具體可執行的建議
5. **主動排程** → 說出你想安排的活動，AI 直接告訴你排哪天不會透支
6. **事後回顧與校準** → 回報實際消耗，系統越用越準，並回顧「哪類活動最常被低估」

它不是心情日記，而是**未來導向的資源規劃工具**——像理財 App 管理金錢一樣管理社交能量。

### 功能總覽

| 頁面 | 功能 |
|---|---|
| `/onboarding` | 6 題人格快篩，產生基礎電池容量與人格摘要 |
| `/`（今天） | 大型電池視覺化、今日行程、事後回報卡片 |
| `/week` | 七天電量總覽、AI 風險預警、Apple 行事曆訂閱 |
| `/plan` | 說一句話，AI 建議把活動排在哪天哪個時段 |
| `/review` | 過去七天預測 vs 實際、準確度統計、AI 回顧 |

---

## 2. 系統架構

```
                    ┌──────────────────────────────────────────┐
                    │  瀏覽器（Next.js App Router, React 18）   │
                    │  BatteryGauge / ActivitySheet /          │
                    │  VoiceInputButton / CalendarSubscribe    │
                    └───────────────┬──────────────────────────┘
                                    │ fetch（同源）
                    ┌───────────────▼──────────────────────────┐
                    │  middleware.ts：per-IP rate limiting      │
                    └───────────────┬──────────────────────────┘
                                    │
   ┌────────────────────────────────▼─────────────────────────────────┐
   │  Next.js Route Handlers（全部 runtime = "edge"）                  │
   │                                                                   │
   │  POST /api/onboarding          規則計分，不呼叫 AI                 │
   │  POST /api/predict-drain       Zod 驗證 → OpenAI → Zod 驗證輸出    │
   │  POST /api/activities          規則式估算立刻回應，AI 背景 refine   │
   │  GET  /api/activities/week     七天電量 + AI 風險預警              │
   │  PATCH /api/activities/:id/actual-drain   回報 + 校準基礎容量      │
   │  POST /api/voice-to-text       ElevenLabs Speech-to-Text          │
   │  POST /api/parse-voice-activity  自然語言 → 結構化欄位             │
   │  POST /api/schedule-suggest    依電量建議排程時段                  │
   │  GET  /api/review/week         過去七天回顧與準確度分析            │
   │  GET  /api/calendar/:token     iCalendar feed（token 認證）        │
   └───────┬──────────────────────────────────┬────────────────────────┘
           │                                   │
   ┌───────▼─────────┐               ┌─────────▼──────────┐
   │  OpenAI         │               │  Cloudflare D1     │
   │  gpt-4o-mini    │               │  (SQLite)          │
   │  ElevenLabs STT │               │  Drizzle ORM       │
   └─────────────────┘               │  users, activities │
                                     └────────────────────┘
```

### 核心資料流：新增一場活動

```
使用者填表單（或按住說話）
   │
   ├─ 語音 → POST /api/voice-to-text（ElevenLabs）→ transcript
   │         → POST /api/parse-voice-activity（gpt-4o-mini）→ 自動帶入欄位
   │
   └─ POST /api/activities
        │
        ├─ 1. lib/drain-rules.ts 規則式估算（純計算，零 I/O）
        ├─ 2. 立刻寫入 D1 並回應 201  ← 使用者不用等 AI
        └─ 3. ctx.waitUntil() 背景呼叫 OpenAI
               └─ Zod 驗證通過 → 回頭 UPDATE 同一筆的 predicted_drain
                                    │
   前端在 2.5s / 6s refetch ────────┘  → 電池動畫更新
```

**為什麼要這樣繞一圈**：同步等 OpenAI 要好幾秒，demo 現場網路不穩時體驗很糟。
先回規則值再背景修正，使用者永遠是即時的；而且 AI 掛掉時功能不會消失，
只是停留在規則式估算（回應中的 `source` 欄位會標示 `rule`）。

### 電量模型

- 每天起床電量 = `min(基礎容量, 前一天剩餘 + 基礎容量 × 0.8)`
- **睡一覺只回充八成**，所以前一天的赤字會帶到隔天——這是 burnout 累積的來源
- 當天結束電量 < 30% 視為風險日，觸發 AI 建議
- 數學實作在 `lib/battery.ts` 的 `simulateWeek()`，seed 腳本與 runtime 共用同一份

實際效果（demo 資料）：迎新派對當天燒到 0% → 隔天起床只剩 46% →
就算只有一堂課也掉到 28%。**中間那天的低電量完全是前一天累積出來的。**

---

## 3. 本地執行

```bash
git clone <this-repo>
cd futuremode
npm install

# 1. 建立本機 D1 資料庫（第一次才需要）
npx wrangler d1 create social-battery-db
#    把回傳的 database_id 填進 wrangler.toml

# 2. 套用 migration
npx wrangler d1 migrations apply social-battery-db --local

# 3. 灌入 demo 資料（日期會依執行當天換算）
npm run db:seed:local

# 4. 設定 API Key（本機用 .dev.vars，已在 .gitignore 中）
cat > .dev.vars <<'EOF'
OPENAI_API_KEY=sk-xxxx
ELEVENLABS_API_KEY=sk_xxxx   # 選配，沒有的話語音按鈕會自動降級
EOF

# 5. 啟動
npm run dev          # http://localhost:3000
```

### 要看 demo 資料
seed 資料掛在 `anonymous_session_id = 'demo-session'` 底下。瀏覽器 console 執行：

```js
document.cookie = "sbm_session=demo-session; path=/"; location.reload();
```

### 沒有 API Key 也能跑
- 沒有 `OPENAI_API_KEY`：自動改用 `lib/drain-rules.ts` 的規則式估算，功能完整不中斷
- 沒有 `ELEVENLABS_API_KEY`：語音按鈕自動收起，表單照常手動填寫

### ⚠️ WSL + `/mnt/c` 的已知問題
專案放在 Windows 檔案系統時，Next dev 的檔案監看（inotify）不會觸發，
**改了檔案畫面不會更新**。改完 server 端程式碼請重啟 `npm run dev`。
另外 `npm run dev` 與 `npm run pages:build` 不能同時跑（都會寫 `.next`）。

---

## 4. 部署（Cloudflare Pages）

```bash
# 1. 建立正式 D1 並套用 migration
npx wrangler d1 create social-battery-db
npx wrangler d1 migrations apply social-battery-db --remote
npm run db:seed:remote          # demo 資料，正式上線可略過

# 2. 設定 secret（不寫進 wrangler.toml，也不進 git）
npx wrangler pages secret put OPENAI_API_KEY
npx wrangler pages secret put ELEVENLABS_API_KEY   # 選配

# 3. 建置 + 部署
npm run deploy
# 等同於：npx @cloudflare/next-on-pages && wrangler pages deploy .vercel/output/static
```

本機預覽 Cloudflare 環境：`npm run preview`

### 部署檢查清單
- [ ] `wrangler.toml` 的 `database_id` 已換成真實 id
- [ ] `OPENAI_API_KEY` 已設為 Pages secret，且**沒有**出現在任何 client component
- [ ] Pages 專案 compatibility flags 含 `nodejs_compat`
- [ ] migration 已套用到 remote D1
- [ ] Apple 行事曆訂閱需要公開網址，部署後要重新產生一次訂閱連結

---

## 5. 使用到的第三方 API 與套件

| 項目 | 用途 | 來源 |
|---|---|---|
| **OpenAI API**（`gpt-4o-mini`） | 電量消耗預測、一週風險預警、語音語意解析、排程建議、週回顧 | https://platform.openai.com |
| **ElevenLabs Speech-to-Text**（`scribe_v1`） | Track D 語音輸入轉文字 | https://elevenlabs.io |
| **Next.js 14**（App Router） | 前後端同一專案，Route Handlers 走 edge runtime | https://nextjs.org |
| **Cloudflare D1** | SQLite-based 資料庫 | https://developers.cloudflare.com/d1 |
| **Cloudflare Pages** + `@cloudflare/next-on-pages` | 部署 | https://github.com/cloudflare/next-on-pages |
| **Drizzle ORM** | Schema 定義與 migration | https://orm.drizzle.team |
| **shadcn/ui** 風格元件 + **Radix UI** | Button / Card / Sheet / Slider / Select | https://ui.shadcn.com |
| **Tailwind CSS 3** | 樣式 | https://tailwindcss.com |
| **Framer Motion** | 電池液體填充動畫、頁面轉場 | https://www.framer.com/motion |
| **Zod** | 所有 API 輸入與 AI 輸出的驗證 | https://zod.dev |
| **lucide-react** | Icon | https://lucide.dev |
| **iCalendar (RFC 5545)** | Apple / Google 行事曆訂閱，自行實作於 `lib/ics.ts` | https://datatracker.ietf.org/doc/html/rfc5545 |

---

## 6. 心理學理論依據

本專案的消耗係數與 prompt 設計奠基於三個既有的心理學概念，
完整說明寫在 `lib/prompts/predict-drain.ts` 的 system prompt 與註解中。

1. **外向性光譜（Extraversion, Big Five / Five-Factor Model）**
   外向性是連續向度而非二分類別。外向者在社交刺激下的皮質激發成本較低，
   同一場活動對偏內向者的資源耗損可能是外向者的數倍。
   → 對應到系統的 `baseBatteryCapacity`（0-100）與 `capacityFactor()`。

2. **資源保存理論（Conservation of Resources Theory, Hobfoll, 1989）**
   心理資源有限，且消耗呈非線性——資源存量越低，後續耗損越快，
   並且「資源損失螺旋」會跨時段累積。
   → 對應到 `durationFactor()` 的指數項，以及**跨日累積模型**
   （`lib/battery.ts`：睡一覺只回充八成，赤字滾到隔天）。

3. **印象管理與自我調節耗損（Impression Management / Ego Depletion）**
   面對不熟悉的對象時，維持社會形象需要持續的自我監控，
   這種認知控制本身就會消耗資源；面對親密對象時該成本趨近於零。
   → 對應到 `familiarity`（1-5）這個系統中權重最高的調節變項，
   以及 `rechargeStyle = "specific_people"` 的折扣係數。

> **安全界線**：本專案是行程規劃工具，**不提供任何醫療診斷或心理治療**。
> 所有 AI prompt 都嵌入 `lib/safety.ts` 的安全條款；
> 偵測到自傷/自殺等危機關鍵字時**不會送進 LLM**，直接回傳制式文字並引導至安心專線 1925。

---

## 7. 專案結構

```
app/
  page.tsx                   今日首頁（大電池 + 今日行程 + 回報卡片）
  onboarding/page.tsx        6 題人格快篩
  week/page.tsx              一週總覽 + 風險預警 + 日曆訂閱
  plan/page.tsx              排日程系統
  review/page.tsx            回顧系統
  api/                       10 條 Route Handlers（全部 edge runtime）
components/
  BatteryGauge.tsx           SVG + Framer Motion 電池（純前端，size: "lg" | "sm"）
  ActivitySheet.tsx          底部彈出的新增活動表單（含語音輸入）
  VoiceInputButton.tsx       按住錄音，權限被拒時自動降級
  CalendarSubscribe.tsx      Apple 行事曆訂閱
  ui/                        button / card / sheet / slider / select / label / progress
lib/
  types.ts                   共用型別（唯一真相來源）
  battery.ts                 電量模型純函式核心（跨日累積）
  drain-rules.ts             規則式消耗估算（AI fallback + 測試基準）
  predict.ts                 安全檢查 → AI → Zod → fallback
  schedule.ts / review.ts    排程與回顧邏輯
  ics.ts                     iCalendar 產生器
  safety.ts                  危機關鍵字偵測 + 制式回應
  ai.ts / elevenlabs.ts      外部 API 封裝（server-only）
  prompts/                   5 支 prompt，全部內嵌安全規範
db/
  schema.ts, migrations/     Drizzle schema 與 migration
  demo-scenario.json         Demo 情境資料（相對日期）
scripts/
  generate-seed.ts           產生 seed（依執行當天換算，並驗證預警日符合預期）
  test-prompts.ts            10 組活動的預測區分度測試
```

---

## 8. 測試

```bash
npm run typecheck        # 全專案型別檢查
npm run test:prompts     # 10 組活動的預測區分度測試（離線可跑）
OPENAI_API_KEY=sk-... npm run test:prompts   # 連真實 AI 一起測
npm run db:seed:generate # 驗證 demo 資料仍會觸發預期的低電量預警
```

`test:prompts` 的通過條件：10 組活動的預測值跨度 ≥ 40、落在 40–60 的不超過 5 組、
低壓組合 < 25、高壓組合 > 65——避免「AI 什麼都回 50」這種沒有區分度的結果。

---

## 授權

MIT License，見 [LICENSE](./LICENSE)。
#   f u t u r e m o d e _ h a c k a t h o n 2 0 2 6  
 