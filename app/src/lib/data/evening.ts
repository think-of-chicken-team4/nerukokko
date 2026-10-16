import type { SupabaseClient } from "@supabase/supabase-js";

import { jstDateKey } from "@/lib/format";
import type { Database } from "@/types/database";

import { getDeviceReadiness, type DeviceReadiness } from "./devices";

type Client = SupabaseClient<Database>;

const DEFAULT_SLEEP_MS = 8 * 60 * 60 * 1000;

export type Recommendation = {
  recommended_bedtime: string;
  recommended_wake_time: string | null;
  first_event_title: string | null;
  first_event_start: string | null;
  reasoning: string | null;
};

export type EveningData = {
  /** 次に鳴るアラーム。なければ null（「眠りにつく」から8時間後に起こす） */
  nextAlarmAt: string | null;
  /** 今夜の就寝提案（evening-suggestion が作る、T-206）。まだなければ null */
  recommendation: Recommendation | null;
  devices: DeviceReadiness;
};

/**
 * 夕方確認・就寝準備の画面に出すデータ。
 * 就寝提案は「起きる日」（target_date）ごとに1件なので、次に起きる日（アラーム、なければ8時間後）の日付で探す。
 */
export async function getEveningData(supabase: Client, userId: string, now: Date = new Date()): Promise<EveningData> {
  const [alarmResult, devices] = await Promise.all([
    supabase.rpc("next_alarm_at", { p_user_id: userId, p_from: now.toISOString() }).maybeSingle(),
    getDeviceReadiness(supabase, false, now),
  ]);
  if (alarmResult.error) throw new Error(`次のアラームを読めませんでした: ${alarmResult.error.message}`);

  const nextAlarmAt = alarmResult.data?.ring_at ?? null;
  const wakeDate = jstDateKey(nextAlarmAt ?? new Date(now.getTime() + DEFAULT_SLEEP_MS));
  const { data: recommendation, error } = await supabase
    .from("sleep_recommendations")
    .select("recommended_bedtime, recommended_wake_time, first_event_title, first_event_start, reasoning")
    .eq("target_date", wakeDate)
    .maybeSingle();
  if (error) throw new Error(`就寝提案を読めませんでした: ${error.message}`);

  return { nextAlarmAt, recommendation, devices };
}
