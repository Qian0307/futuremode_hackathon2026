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
