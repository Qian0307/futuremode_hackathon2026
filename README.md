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
   ┌───────▼──────────────────┐      ┌─────────▼──────────┐
   │  lib/ai.ts 供應商鏈       │      │  Cloudflare D1     │
   │  1. Workers AI (binding) │      │  (SQLite)          │
   │  2. Groq      (備援)      │      │  Drizzle ORM       │
   │  3. OpenAI    (選配)      │      │  users, activities │
   │  全失敗 → 規則式 fallback  │      └────────────────────┘
   │                          │
   │  ElevenLabs STT（語音）   │
   └──────────────────────────┘
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
        └─ 3. ctx.waitUntil() 背景呼叫 AI（Workers AI → Groq → OpenAI）
               └─ Zod 驗證通過 → 回頭 UPDATE 同一筆的 predicted_drain
                                    │
   前端在 2.5s / 6s refetch ────────┘  → 電池動畫更新
```

**為什麼要這樣繞一圈**：同步等 LLM 要好幾秒，demo 現場網路不穩時體驗很糟。
先回規則值再背景修正，使用者永遠是即時的；而且 AI 掛掉時功能不會消失，
只是停留在規則式估算（回應中的 `source` 欄位會標示 `rule`）。

### AI 供應商：三層 fallback

`lib/ai.ts` 的 `chatJson()` 是所有 AI 呼叫的唯一入口，依序嘗試：

| 順序 | 供應商 | 需要什麼 | 說明 |
|---|---|---|---|
| 1 | **Cloudflare Workers AI** | **不需要 API Key** | 走 `wrangler.toml` 的 `[ai]` binding，跟 D1／Pages 同一個帳號。預設模型 `@cf/meta/llama-3.3-70b-instruct-fp8-fast`（中文品質好）。免費額度每天 10,000 Neurons |
| 2 | Groq | `GROQ_API_KEY` | 免費、推論極快、OpenAI 相容介面 |
| 3 | OpenAI | `OPENAI_API_KEY` | 現場若有發 credits，設了就自動接上，不用改程式碼 |
| — | 規則式 fallback | 無 | 全部失敗時走 `lib/drain-rules.ts`，功能不中斷，回應的 `source` 會標示 `rule` |

刻意**不使用**各家的 structured output 參數——支援度不一，不支援時整個呼叫會失敗。
改用「prompt 明確要求 JSON + 容錯解析 + Zod 驗證 + 規則式 fallback」換取跨供應商的一致行為。
Workers AI 依模型回傳 `{response}` 或 OpenAI 格式的 `{choices[].message.content}`，兩種都有處理。

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

# 4. 啟動（AI 不需要任何設定——Workers AI 走 binding）
npm run dev          # http://localhost:3000

# 選配：語音輸入與備援 AI 才需要 Key，放在 .dev.vars（已在 .gitignore 中）
cat > .dev.vars <<'EOF'
ELEVENLABS_API_KEY=sk_xxxx   # Track D 語音輸入
GROQ_API_KEY=gsk_xxxx        # AI 備援
EOF
```

### 要看 demo 資料
seed 資料掛在 `anonymous_session_id = 'demo-session'` 底下。瀏覽器 console 執行：

```js
document.cookie = "sbm_session=demo-session; path=/"; location.reload();
```

### 沒有任何 API Key 也能跑
- **AI 完全不需要 Key**：Workers AI 走 binding，`wrangler` 登入即可用
- 連 Workers AI 都連不上時：自動改用 `lib/drain-rules.ts` 的規則式估算，功能完整不中斷
- 沒有 `ELEVENLABS_API_KEY`：語音按鈕自動收起，表單照常手動填寫

### ⚠️ WSL + `/mnt/c` 的已知問題
專案放在 Windows 檔案系統時，Next dev 的檔案監看（inotify）不會觸發，
**改了檔案畫面不會更新**。改完 server 端程式碼請重啟 `npm run dev`。
另外 `npm run dev` 與 `npm run pages:build` 不能同時跑（都會寫 `.next`）。

---

## 4. 部署（Cloudflare Pages）

**正式站台：https://social-battery-meter.pages.dev**

### 日常更新（初次設定完成後，只需要這一行）

```bash
npm run deploy
```

等同於 `npx @cloudflare/next-on-pages` 建置後，
`wrangler pages deploy .vercel/output/static --project-name social-battery-meter`。

> ⚠️ **`npm run dev` 不能跟 `npm run deploy` 同時跑**——兩者都會寫 `.next`，
> 會讓建置中途失敗。部署前先把 dev server 關掉。

### 初次設定（本專案已完成，換帳號才需要重跑）

```bash
# 1. 登入
npx wrangler login

# 2. 建立 D1，把回傳的 database_id 填進 wrangler.toml
npx wrangler d1 create social-battery-db

# 3. 建立 Pages 專案
npx wrangler pages project create social-battery-meter --production-branch main

# 4. 套用 migration 到正式資料庫
npx wrangler d1 migrations apply social-battery-db --remote

# 5. 灌入 demo 資料（選用；日期依執行當天換算）
npm run db:seed:remote

# 6. 部署
npm run deploy
```

### AI 不需要任何設定
Workers AI 走 `wrangler.toml` 的 `[ai]` binding，跟 D1 同一個帳號，
部署後就直接可用，**不需要申請或設定任何 API Key**。

### 選配的 secret

```bash
npx wrangler pages secret put ELEVENLABS_API_KEY   # Track D 語音輸入
npx wrangler pages secret put GROQ_API_KEY         # AI 備援
npx wrangler pages secret put OPENAI_API_KEY       # 現場有發 credits 再設
```

設定完要**重新部署一次**才會生效（`npm run deploy`）。
沒設 `ELEVENLABS_API_KEY` 時，語音按鈕會自己隱藏，表單照常手動填寫。

### 部署後驗收

```bash
URL=https://social-battery-meter.pages.dev

# AI 是否活著——要看到 "source":"ai"，看到 "rule" 代表 Workers AI 沒接上
curl -s -X POST $URL/api/predict-drain -H 'Content-Type: application/json' \
  -d '{"activity":{"type":"party","headcount":25,"familiarity":2,"durationMinutes":180},
       "profile":{"baseBatteryCapacity":38,"summary":"偏內向","rechargeStyle":"solitude"}}'

# 語音服務有沒有開啟
curl -s $URL/api/voice-to-text -H "Cookie: sbm_session=demo-session"
```

瀏覽器 console 執行下面這行，就會看到完整的 demo 情境：

```js
document.cookie = "sbm_session=demo-session; path=/"; location.reload();
```

### 部署檢查清單
- [x] `wrangler.toml` 的 `database_id` 已填入真實 id
- [x] Workers AI binding（`[ai]`）已設定，正式環境回 `source: "ai"`
- [x] migration 已套用到 remote D1
- [x] 所有 API Key 都是 Pages secret，**沒有**出現在任何 client component
- [ ] 換日之後要重跑 `npm run db:seed:remote`，demo 資料的七天視窗才會對齊

## 5. 使用到的第三方 API 與套件

| 項目 | 用途 | 來源 |
|---|---|---|
| **Cloudflare Workers AI**（`@cf/meta/llama-3.3-70b-instruct-fp8-fast`） | 主要 LLM：電量消耗預測、一週風險預警、語音語意解析、排程建議、週回顧 | https://developers.cloudflare.com/workers-ai |
| **Groq**（`llama-3.3-70b-versatile`） | AI 備援（選配） | https://groq.com |
| **OpenAI API**（`gpt-4o-mini`） | AI 選配，設了 Key 就自動接上 | https://platform.openai.com |
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
npm run test:prompts     # 10 組活動的預測區分度測試（離線可跑，測規則式基準）

# 測真實 AI（含 Workers AI）——要先 npm run dev
SBM_BASE_URL=http://localhost:3000 npm run test:prompts
npm run db:seed:generate # 驗證 demo 資料仍會觸發預期的低電量預警
```

`test:prompts` 的通過條件：10 組活動的預測值跨度 ≥ 40、落在 40–60 的不超過 5 組、
低壓組合 < 25、高壓組合 > 65——避免「AI 什麼都回 50」這種沒有區分度的結果。

---

## 授權

MIT License，見 [LICENSE](./LICENSE)。
