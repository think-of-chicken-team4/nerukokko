import type { SupabaseClient } from "@supabase/supabase-js";

import type { ScoreDetails } from "@/types/score";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;

export type SleepCounts = {
  turns: number;
  snores: number;
  temperatureC: number | null;
  humidityPct: number | null;
};

/** 睡眠中の画面の初期表示：寝返り・いびき/寝言の回数と、最新の室温・湿度 */
export async function getSleepCounts(supabase: Client, sessionId: string): Promise<SleepCounts> {
  const [motion, audio, env] = await Promise.all([
    supabase.from("motion_events").select("id", { count: "exact", head: true }).eq("session_id", sessionId),
    supabase.from("audio_events").select("id", { count: "exact", head: true }).eq("session_id", sessionId),
    supabase
      .from("environment_readings")
      .select("temperature_c, humidity_pct")
      .eq("session_id", sessionId)
      .order("timestamp", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  return {
    turns: motion.count ?? 0,
    snores: audio.count ?? 0,
    temperatureC: env.data?.temperature_c ?? null,
    humidityPct: env.data?.humidity_pct ?? null,
  };
}

export type MorningData = {
  session: {
    id: string;
    start_time: string;
    actual_wake_time: string | null;
    planned_wake_time: string;
    score: number | null;
    score_details: ScoreDetails | null;
  };
  comment: string | null;
  counts: SleepCounts;
};

/** 朝の振り返りの画面：スコア・内訳・にわとりのコメント・昨夜の回数 */
export async function getMorningData(supabase: Client, sessionId: string): Promise<MorningData | null> {
  const [sessionResult, commentResult, counts] = await Promise.all([
    supabase
      .from("sleep_sessions")
      .select("id, start_time, actual_wake_time, planned_wake_time, score, score_details")
      .eq("id", sessionId)
      .maybeSingle(),
    supabase
      .from("chat_sessions")
      .select("chat_messages(content, role)")
      .eq("sleep_session_id", sessionId)
      .eq("trigger", "scheduled_morning")
      .maybeSingle(),
    getSleepCounts(supabase, sessionId),
  ]);
  const session = sessionResult.data;
  if (!session) return null;
  const comment = commentResult.data?.chat_messages.find((m) => m.role === "assistant")?.content ?? null;
  return {
    session: { ...session, score_details: session.score_details as ScoreDetails | null },
    comment,
    counts,
  };
}
