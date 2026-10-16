// 会話（chat・voice-chat）で AI に渡す、その人の睡眠の情報と、回数の上限の数え方（DB を使う部品）。

import type { ChatContext } from "./chat.ts";
import type { Db } from "./http.ts";
import { formatJst, jstDateKey } from "./jst.ts";
import { scoreLabel } from "./score.ts";

const HOUR_MS = 60 * 60 * 1000;

/** この1時間に、そのユーザーが話した回数（文字・音声の両方） */
export async function userMessagesInLastHour(db: Db, userId: string, now: Date): Promise<number> {
  const { count, error } = await db
    .from("chat_messages")
    .select("id, chat_sessions!inner(user_id)", { count: "exact", head: true })
    .eq("chat_sessions.user_id", userId)
    .eq("role", "user")
    .gte("created_at", new Date(now.getTime() - HOUR_MS).toISOString());
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** AI に渡す、この人の睡眠の情報 */
export async function loadContext(db: Db, userId: string, now: Date): Promise<ChatContext> {
  const [profile, lastNight, active, alarm, recommendation] = await Promise.all([
    db.from("users").select("display_name").eq("id", userId).maybeSingle(),
    db
      .from("sleep_sessions")
      .select("id, start_time, score")
      .eq("user_id", userId)
      .eq("status", "completed")
      .order("end_time", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db.from("sleep_sessions").select("start_time").eq("user_id", userId).eq("status", "in_progress").maybeSingle(),
    db.rpc("next_alarm_at", { p_user_id: userId, p_from: now.toISOString() }).maybeSingle(),
    db
      .from("sleep_recommendations")
      .select("recommended_bedtime, reasoning")
      .eq("user_id", userId)
      .gte("target_date", jstDateKey(now))
      .order("target_date")
      .limit(1)
      .maybeSingle(),
  ]);

  let last: ChatContext["lastNight"] = null;
  if (lastNight.data) {
    const [turns, snores] = await Promise.all([
      db.from("motion_events").select("id", { count: "exact", head: true }).eq("session_id", lastNight.data.id),
      db
        .from("audio_events")
        .select("id", { count: "exact", head: true })
        .eq("session_id", lastNight.data.id)
        .eq("event_type", "snore"),
    ]);
    const score = lastNight.data.score;
    last = {
      date: formatJst(lastNight.data.start_time),
      score,
      label: score === null ? null : scoreLabel(score),
      turns: turns.count ?? 0,
      snores: snores.count ?? 0,
    };
  }

  return {
    displayName: profile.data?.display_name ?? "",
    lastNight: last,
    sleepingSince: active.data ? formatJst(active.data.start_time) : null,
    tonight: recommendation.data
      ? { bedtime: formatJst(recommendation.data.recommended_bedtime), reasoning: recommendation.data.reasoning }
      : null,
    nextAlarm: alarm.data?.ring_at ? formatJst(alarm.data.ring_at) : null,
  };
}
