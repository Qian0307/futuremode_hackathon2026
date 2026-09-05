import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

/**
 * users
 * personality_profile 以 JSON 字串儲存，對應 /lib/types.ts 的 PersonalityProfile。
 */
export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    anonymousSessionId: text("anonymous_session_id").notNull(),
    personalityProfile: text("personality_profile").notNull(), // JSON: PersonalityProfile
    baseBatteryCapacity: integer("base_battery_capacity").notNull(),
    /**
     * Apple/Google 行事曆訂閱用的 token。
     * 行事曆用戶端抓 .ics 時不會帶 cookie，所以需要一個放在網址裡的隨機憑證。
     * 舊資料可能為 NULL，第一次開啟訂閱時才產生。
     */
    calendarToken: text("calendar_token"),
    createdAt: text("created_at").notNull(),
  },
  (t) => ({
    anonSessionIdx: index("users_anonymous_session_id_idx").on(t.anonymousSessionId),
    calendarTokenIdx: index("users_calendar_token_idx").on(t.calendarToken),
  })
);

/**
 * activities
 * 欄位對應 /lib/types.ts 的 Activity。
 */
export const activities = sqliteTable(
  "activities",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    type: text("type").notNull(), // ActivityType
    headcount: integer("headcount").notNull(),
    familiarity: integer("familiarity").notNull(), // 1-5
    durationMinutes: integer("duration_minutes").notNull(),
    scheduledAt: text("scheduled_at").notNull(), // ISO 8601
    predictedDrain: integer("predicted_drain").notNull(), // 0-100
    actualDrain: integer("actual_drain"), // nullable
    createdAt: text("created_at").notNull(),
  },
  (t) => ({
    userIdx: index("activities_user_id_idx").on(t.userId),
    scheduledIdx: index("activities_scheduled_at_idx").on(t.scheduledAt),
  })
);

export type UserRow = typeof users.$inferSelect;
export type ActivityRow = typeof activities.$inferSelect;
