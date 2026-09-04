import { and, asc, eq, gte, lt } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { Activity, ActivityType, PersonalityProfile } from "@/lib/types";
import type { ActivityRow, UserRow } from "@/db/schema";

/* ------------------------------------------------------------------ */
/* 記憶體 fallback：沒有 D1 binding 時使用（本機純前端開發 / demo 保命用） */
/* ------------------------------------------------------------------ */
type MemStore = { users: UserRow[]; activities: ActivityRow[] };
const globalForMem = globalThis as unknown as { __sbmMem?: MemStore };
function mem(): MemStore {
  if (!globalForMem.__sbmMem) globalForMem.__sbmMem = { users: [], activities: [] };
  return globalForMem.__sbmMem;
}

/* ------------------------------------------------------------------ */
/* Row <-> Domain type 轉換                                            */
/* ------------------------------------------------------------------ */
export function rowToActivity(row: ActivityRow): Activity {
  return {
    id: row.id,
    userId: row.userId,
    type: row.type as ActivityType,
    headcount: row.headcount,
    familiarity: row.familiarity as Activity["familiarity"],
    durationMinutes: row.durationMinutes,
    scheduledAt: row.scheduledAt,
    predictedDrain: row.predictedDrain,
    actualDrain: row.actualDrain ?? null,
    createdAt: row.createdAt,
  };
}

export function rowToProfile(row: UserRow): PersonalityProfile {
  try {
    return JSON.parse(row.personalityProfile) as PersonalityProfile;
  } catch {
    return {
      baseBatteryCapacity: row.baseBatteryCapacity,
      summary: "尚未完成人格快篩",
      rechargeStyle: "mixed",
    };
  }
}

/* ------------------------------------------------------------------ */
/* Users                                                               */
/* ------------------------------------------------------------------ */
export async function findUserBySession(sessionId: string): Promise<UserRow | null> {
  const db = await getDb();
  if (!db) return mem().users.find((u) => u.anonymousSessionId === sessionId) ?? null;
  const rows = await db.select().from(schema.users).where(eq(schema.users.anonymousSessionId, sessionId)).limit(1);
  return rows[0] ?? null;
}

export async function findUserById(id: string): Promise<UserRow | null> {
  const db = await getDb();
  if (!db) return mem().users.find((u) => u.id === id) ?? null;
  const rows = await db.select().from(schema.users).where(eq(schema.users.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function upsertUser(row: UserRow): Promise<UserRow> {
  const db = await getDb();
  if (!db) {
    const store = mem();
    const idx = store.users.findIndex((u) => u.anonymousSessionId === row.anonymousSessionId);
    if (idx >= 0) store.users[idx] = { ...row, id: store.users[idx].id };
    else store.users.push(row);
    return store.users.find((u) => u.anonymousSessionId === row.anonymousSessionId)!;
  }
  const existing = await findUserBySession(row.anonymousSessionId);
  if (existing) {
    await db
      .update(schema.users)
      .set({
        personalityProfile: row.personalityProfile,
        baseBatteryCapacity: row.baseBatteryCapacity,
      })
      .where(eq(schema.users.id, existing.id));
    return { ...existing, personalityProfile: row.personalityProfile, baseBatteryCapacity: row.baseBatteryCapacity };
  }
  await db.insert(schema.users).values(row);
  return row;
}

export async function updateBaseCapacity(userId: string, capacity: number): Promise<void> {
  const clamped = Math.max(0, Math.min(100, Math.round(capacity)));
  const db = await getDb();
  if (!db) {
    const u = mem().users.find((x) => x.id === userId);
    if (u) {
      u.baseBatteryCapacity = clamped;
      try {
        const p = JSON.parse(u.personalityProfile) as PersonalityProfile;
        p.baseBatteryCapacity = clamped;
        u.personalityProfile = JSON.stringify(p);
      } catch {
        /* profile 壞掉就只更新數字欄位 */
      }
    }
    return;
  }
  const user = await findUserById(userId);
  if (!user) return;
  let profileJson = user.personalityProfile;
  try {
    const p = JSON.parse(profileJson) as PersonalityProfile;
    p.baseBatteryCapacity = clamped;
    profileJson = JSON.stringify(p);
  } catch {
    /* ignore */
  }
  await db
    .update(schema.users)
    .set({ baseBatteryCapacity: clamped, personalityProfile: profileJson })
    .where(eq(schema.users.id, userId));
}

/* ------------------------------------------------------------------ */
/* Activities                                                          */
/* ------------------------------------------------------------------ */
export async function insertActivity(row: ActivityRow): Promise<Activity> {
  const db = await getDb();
  if (!db) {
    mem().activities.push(row);
    return rowToActivity(row);
  }
  await db.insert(schema.activities).values(row);
  return rowToActivity(row);
}

export async function listActivitiesBetween(userId: string, startIso: string, endIso: string): Promise<Activity[]> {
  const db = await getDb();
  if (!db) {
    return mem()
      .activities.filter((a) => a.userId === userId && a.scheduledAt >= startIso && a.scheduledAt < endIso)
      .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
      .map(rowToActivity);
  }
  const rows = await db
    .select()
    .from(schema.activities)
    .where(
      and(
        eq(schema.activities.userId, userId),
        gte(schema.activities.scheduledAt, startIso),
        lt(schema.activities.scheduledAt, endIso)
      )
    )
    .orderBy(asc(schema.activities.scheduledAt));
  return rows.map(rowToActivity);
}

export async function findActivityById(id: string): Promise<Activity | null> {
  const db = await getDb();
  if (!db) {
    const row = mem().activities.find((a) => a.id === id);
    return row ? rowToActivity(row) : null;
  }
  const rows = await db.select().from(schema.activities).where(eq(schema.activities.id, id)).limit(1);
  return rows[0] ? rowToActivity(rows[0]) : null;
}

/**
 * 只更新 predictedDrain（AI 背景 refine 用）。
 * 使用者若已經回報過實際消耗就不覆蓋——那筆資料比預測更有價值。
 */
export async function refinePredictedDrain(id: string, predictedDrain: number): Promise<boolean> {
  const db = await getDb();
  if (!db) {
    const row = mem().activities.find((a) => a.id === id);
    if (!row || row.actualDrain !== null) return false;
    row.predictedDrain = predictedDrain;
    return true;
  }
  const existing = await findActivityById(id);
  if (!existing || existing.actualDrain !== null) return false;
  await db.update(schema.activities).set({ predictedDrain }).where(eq(schema.activities.id, id));
  return true;
}

export async function updateActualDrain(id: string, actualDrain: number): Promise<void> {
  const db = await getDb();
  if (!db) {
    const row = mem().activities.find((a) => a.id === id);
    if (row) row.actualDrain = actualDrain;
    return;
  }
  await db.update(schema.activities).set({ actualDrain }).where(eq(schema.activities.id, id));
}
