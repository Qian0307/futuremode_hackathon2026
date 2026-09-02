import scenario from "@/db/demo-scenario.json";
import type { PersonalityProfile } from "@/lib/types";

/**
 * Track C3：demo 情境資料。
 * 日期用「相對今天的第幾天」表示，seed 腳本會在執行當下換算成真實日期，
 * 這樣 demo 當天不用改資料就一定看得到未來 7 天的完整流程。
 */
export const DEMO_SCENARIO = scenario;
export const DEMO_PROFILE: PersonalityProfile = scenario.profile as PersonalityProfile;
