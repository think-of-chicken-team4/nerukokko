// 夕方の就寝提案を作って保存する（T-206）。evening-suggestion（定期実行・Webアプリ）から呼ぶ。

import { toOneParagraph } from "./comment.ts";
import { eveningPrompt, eveningTemplate, planEvening } from "./evening.ts";
import { generateText } from "./gemini.ts";
import type { Db } from "./http.ts";

/** 寝つくまでの時間の平均に使う夜の数 */
const RECENT_NIGHTS = 7;

export type Recommendation = {
  target_date: string;
  recommended_bedtime: string;
  recommended_wake_time: string | null;
  required_sleep_minutes: number;
  reasoning: string | null;
};

/** そのユーザーの今夜の提案を作って保存する。アラームがなければ作らない（null） */
export async function runEveningSuggestion(db: Db, userId: string, now: Date = new Date()): Promise<Recommendation | null> {
  const [alarm, recent, profile] = await Promise.all([
    db.rpc("next_alarm_at", { p_user_id: userId, p_from: now.toISOString() }).maybeSingle(),
    db
      .from("sleep_sessions")
      .select("score_details")
      .eq("user_id", userId)
      .eq("status", "completed")
      .not("score_details", "is", null)
      .order("end_time", { ascending: false })
      .limit(RECENT_NIGHTS),
    db.from("users").select("display_name").eq("id", userId).maybeSingle(),
  ]);
  if (alarm.error) throw new Error(alarm.error.message);
  if (recent.error) throw new Error(recent.error.message);

  const latencies = (recent.data ?? []).flatMap((s) => {
    const latency = (s.score_details as { efficiency?: { onset_latency_min?: number } | null } | null)?.efficiency
      ?.onset_latency_min;
    return typeof latency === "number" ? [latency] : [];
  });
  const plan = planEvening(now, alarm.data?.ring_at ? new Date(alarm.data.ring_at) : null, latencies);
  if (!plan) return null;

  const generated = await generateText({ ...eveningPrompt(plan, profile.data?.display_name ?? ""), maxOutputTokens: 200 });
  const reasoning = generated ? toOneParagraph(generated.text) : eveningTemplate(plan);

  const row = {
    user_id: userId,
    target_date: plan.targetDate,
    recommended_bedtime: plan.bedtime.toISOString(),
    recommended_wake_time: plan.wake.toISOString(),
    required_sleep_minutes: plan.requiredSleepMin,
    reasoning,
    generated_at: now.toISOString(),
  };
  const { data, error } = await db
    .from("sleep_recommendations")
    .upsert(row, { onConflict: "user_id,target_date" })
    .select("target_date, recommended_bedtime, recommended_wake_time, required_sleep_minutes, reasoning")
    .single();
  if (error) throw new Error(error.message);
  return data;
}
