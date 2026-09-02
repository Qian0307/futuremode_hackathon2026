import { findUserBySession, rowToProfile } from "@/lib/repo";
import { getSessionIdFromRequest } from "@/lib/session";
import type { PersonalityProfile } from "@/lib/types";
import type { UserRow } from "@/db/schema";

export interface CurrentUser {
  row: UserRow;
  profile: PersonalityProfile;
}

/** 從 cookie 取得目前的匿名使用者；沒有就回 null（呼叫端回 401 並引導去做快篩）。 */
export async function getCurrentUser(req: Request): Promise<CurrentUser | null> {
  const sessionId = getSessionIdFromRequest(req);
  if (!sessionId) return null;
  const row = await findUserBySession(sessionId);
  if (!row) return null;
  return { row, profile: rowToProfile(row) };
}
