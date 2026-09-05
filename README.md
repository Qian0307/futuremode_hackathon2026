# 社交電量計 · Social Battery Meter

用 AI 幫「社交能量」建模——像手機電池一樣，預測每個社交活動會消耗多少心理能量，
並幫使用者規劃一週行程，避免過度消耗導致 burnout。

> FUTUREMODE 2026 · BUILDMODE Hackathon｜賽道：AI for Everyday Life

---

## 技術棧

| 層 | 選型 |
|---|---|
| 前端 | Next.js 14 (App Router) + TypeScript + Tailwind CSS 3 + shadcn/ui 風格元件 |
| 動畫 | Framer Motion（電池液體填充、頁面轉場） |
| 後端 | Next.js Route Handlers（全部 `runtime = "edge"`） |
| 驗證 | Zod（每個 API 的輸入與 AI 輸出都驗） |
| 資料庫 | Cloudflare D1 + Drizzle ORM |
| AI | OpenAI `gpt-4o-mini`（server-side only，背景 refine） |
| 部署 | Cloudflare Pages（`@cloudflare/next-on-pages`） |

---

## 專案結構

```
app/
  layout.tsx                 全站外框 + 導覽
  page.tsx                   今日首頁（大電池 + 今日行程 + 事後回報卡片）
  onboarding/page.tsx        6 題人格快篩
  week/page.tsx              一週總覽 + AI 風險預警
  api/
    onboarding/route.ts                    POST  人格快篩 -> PersonalityProfile
    predict-drain/route.ts                 POST  電量消耗預測
    activities/route.ts                    POST  新增活動（內部先跑預測）
    activities/week/route.ts               GET   未來 7 天 + 每天電量 + 預警
    activities/[id]/actual-drain/route.ts  PATCH 事後回報 + 校準基礎容量
components/
  BatteryGauge.tsx           SVG + Framer Motion 電池元件（純前端，size: "lg" | "sm"）
  ActivitySheet.tsx          底部彈出的新增活動表單
  ui/                        button / card / sheet / slider / select / label / progress
lib/
  types.ts                   共用型別（唯一真相來源，見 CLAUDE.md 0.2）
  prompts/predict-drain.ts   Track C1：消耗預測 prompt
  prompts/weekly-risk-warning.ts  Track C2：一週風險預警 prompt
  safety.ts                  安全規範：危機關鍵字偵測 + 制式回應
  ai.ts                      OpenAI 呼叫封裝（server-only，base URL 可覆寫）
  background.ts              把工作丟到 ctx.waitUntil() 背景執行
  predict.ts                 預測流程：安全檢查 -> AI -> Zod -> 規則式 fallback
  drain-rules.ts             規則式消耗估算（fallback + 測試基準）
  onboarding.ts              6 題題庫 + 加權計分
  battery.ts                 電量模型的純函式核心（跨日累積），seed 腳本共用同一份
  week.ts                    一週電量彙總 + 風險預警組裝
  repo.ts                    資料存取層（D1，無 binding 時自動退回記憶體）
db/
  schema.ts                  Drizzle schema
  migrations/                Migration SQL
  demo-scenario.json         Track C3：demo 情境資料（相對日期）
scripts/
  generate-seed.ts           由情境資料產生 db/seed.sql（依執行當天換算日期）
  test-prompts.ts            Track C1.3：10 組活動的區分度測試
middleware.ts                API rate limiting
```

---

## 本機開發

```bash
npm install

# 1. 建立本機 D1 資料庫（第一次才需要）
npx wrangler d1 create social-battery-db
#    把回傳的 database_id 填進 wrangler.toml

# 2. 產生並套用 migration
npm run db:generate          # 由 db/schema.ts 產生 SQL
npm run db:migrate:local

# 3. 灌入 demo 資料（日期會依今天換算）
npm run db:seed:local

# 4. 設定 API Key（本機）
echo 'OPENAI_API_KEY=sk-xxxx' > .dev.vars
#    可選：OPENAI_BASE_URL 可改打相容端點（gateway / proxy / 測試用 mock）

# 5. 開發
npm run dev
```

> **D1 是必要的。** `lib/repo.ts` 在拿不到 binding 時會退到記憶體儲存以免直接 crash，
> 但那只在「同一個 isolate 內」有效——Next 本機的 edge 模擬每個 request 都是新的 sandbox，
> 所以沒接 D1 時會一直看到「尚未完成人格快篩」。開發與部署都請照上面步驟設定 D1。
> 需要純前端獨立開發時，`components/BatteryGauge.tsx` 本來就不打任何 API，可以單獨使用。

> **沒有設定 OPENAI_API_KEY 也能跑。** `lib/predict.ts` 會自動改用 `lib/drain-rules.ts`
> 的規則式估算，功能不會中斷，只是少了 AI 生成的說明文字。

### 要看 demo 資料
seed 資料掛在 `anonymous_session_id = 'demo-session'` 底下。在瀏覽器 console 執行：

```js
document.cookie = "sbm_session=demo-session; path=/";
location.reload();
```

---

## 測試

```bash
npm run typecheck        # TypeScript 全專案型別檢查
npm run test:prompts     # Track C1.3：10 組活動的預測區分度測試
OPENAI_API_KEY=sk-... npm run test:prompts   # 連真實 AI 一起測
npm run db:seed:generate # 驗證 demo 資料仍會產生 >= 2 天的低電量預警
```

### WSL + `/mnt/c` 的已知問題
專案放在 Windows 檔案系統時，Next dev 的檔案監看（inotify）不會觸發，
**改了檔案畫面不會更新**。改完 server 端程式碼請重啟 `npm run dev`。

---

## 部署到 Cloudflare Pages

```bash
# 1. 建立正式 D1 並套用 migration
npx wrangler d1 create social-battery-db
npm run db:migrate:remote
npm run db:seed:remote        # demo 資料，正式上線可略過

# 2. 設定 secret（不要寫進 wrangler.toml，也不要進 git）
npx wrangler pages secret put OPENAI_API_KEY

# 3. 建置 + 部署
npm run deploy
# 等同於：npx @cloudflare/next-on-pages && wrangler pages deploy .vercel/output/static
```

本機預覽 Cloudflare 環境（會用到 D1 與 secret）：

```bash
npm run preview
```

### 部署檢查清單
- [ ] `wrangler.toml` 的 `database_id` 已換成真實 id
- [ ] `OPENAI_API_KEY` 已設為 Pages secret，且**沒有**出現在任何 client component
- [ ] Pages 專案的 compatibility flags 含 `nodejs_compat`
- [ ] migration 已套用到 remote D1

---

## 安全規範（CLAUDE.md 第 0.5 節的實作位置）

| 規範 | 實作 |
|---|---|
| 不提供醫療診斷或危機處置 | `lib/safety.ts` 的 `SAFETY_CLAUSE`，嵌入每一個 system prompt |
| 危機關鍵字回制式文字 | `lib/safety.ts` 的 `detectCrisis()`，命中就**不進 LLM**，直接回 `CRISIS_RESPONSE` |
| API Key 只在 server-side | `lib/ai.ts` 檔首的 `import "server-only"`，誤用在 client component 會在 build 階段失敗 |
| 輸入驗證 | `lib/schemas.ts` + `lib/api.ts` 的 `parseBody()`，每個 route 都走同一套 |
| Rate limiting | `middleware.ts`，predict-drain 每分鐘 15 次 |

**Rate limiting 的已知限制**：計數存在 isolate 記憶體，Cloudflare 多節點不共享，
屬於「防手滑與防單機腳本」等級。若要嚴格全域限流，之後換成 Durable Object 或 KV。

---

## API

### `POST /api/onboarding`
```jsonc
// req
{ "answers": [0, 1, 2, 1, 0, 1] }   // 6 個 0-3 的選項 index
// res
{ "profile": { "baseBatteryCapacity": 45, "summary": "…", "rechargeStyle": "solitude" }, "userId": "…" }
```
同時會 set 一個 httpOnly cookie `sbm_session` 當作匿名身分。

### `POST /api/predict-drain`
```jsonc
// req: DrainPredictionRequest
{ "activity": { "type": "party", "headcount": 25, "familiarity": 2, "durationMinutes": 180 },
  "profile":  { "baseBatteryCapacity": 38, "summary": "…", "rechargeStyle": "solitude" } }
// res: DrainPredictionResponse (+ source)
{ "predictedDrain": 82, "reason": "消耗偏高：25 人的場合需要一直分配注意力。", "source": "ai" }
```
`source` 為 `ai` | `rule`（fallback）| `crisis`（命中安全規範）。

### `POST /api/activities`
輸入 activity 四個欄位 + `scheduledAt`，回傳 `{ activity, reason, source, refining }`。

**不會等 AI。** 呼叫 OpenAI 要好幾秒，讓使用者按下「加入行程」後盯著轉圈很糟，
demo 現場網路不好時更明顯。所以流程是：

1. 用 `lib/drain-rules.ts` 的規則式估算立刻存檔並回應（純計算，沒有 I/O）
2. 把 AI 預測丟進 `ctx.waitUntil()` 背景跑，完成後回頭更新同一筆的 `predicted_drain`
3. 前端在 2.5 秒與 6 秒後各 refetch 一次去接修正後的數字，期間顯示「AI 校準中…」

`refining: true` 代表背景工作已排定（只有設了 `OPENAI_API_KEY` 才會是 true）。
若使用者在 AI 回來前就回報了實際消耗，`refinePredictedDrain()` 會跳過覆寫——
實際回報比預測更有價值。

**這是延遲的優化，不是成本的優化**：AI 一樣會被呼叫一次。

### `GET /api/activities/week`
回傳 `{ profile, startDate, days[7], totalActivities }`。
每個 day 含 `activities`、`totalDrain`、`startBattery`、`remainingBattery`、`isLow`、`warning`。
加 `?warnings=0` 可略過 AI 預警呼叫（首頁用，比較快）。

### `PATCH /api/activities/:id/actual-drain`
```jsonc
{ "feedback": "more" }   // more | same | less（也可直接給 actualDrain 數字）
```
換算成 `actual_drain` 後存入；與預測的差距超過 20% 時，`base_battery_capacity` ±5。

---

## 電量模型

- **電量會跨日累積**：睡一覺只回充 `baseBatteryCapacity × 0.8`（上限是基礎容量），
  所以前一天沒補回來的赤字會帶到隔天。這是這個 app 存在的理由——
  burnout 來自累積，不是單一天排太滿。數學在 `lib/battery.ts` 的 `simulateWeek()`。
- 每天回傳兩個數字：`startBattery`（起床）與 `remainingBattery`（結束）。
  `startBattery` 低於基礎容量就代表這天被前一天拖累，UI 與 AI prompt 都會據此改變說法。
- 已知簡化：當天消耗超過起床電量時截在 0，不記「透支」的部分。
- 當天結束電量 < 30% 視為風險日，觸發 Track C2 的 AI 建議。
- 消耗係數的心理學依據（外向性光譜、資源保存理論）寫在
  `lib/prompts/predict-drain.ts` 的註解與 prompt 本文中，
  規則式 fallback `lib/drain-rules.ts` 用同一套邏輯的數值化版本。
#   f u t u r e m o d e _ h a c k a t h o n 2 0 2 6  
 