// 朝の振り返り：完了した睡眠セッションのスコアを計算して保存し、にわとりのコメントを残す。
// ingest-sensor-data（巣に戻ったとき）・close-stale-sessions（巣に戻らないまま3時間たったとき）・morning-summary（手動でやり直すとき）から呼ぶ。docs/api-spec.md §4-4・§5

import { morningComment, morningPrompt, toOneParagraph } from "./comment.ts";
import { generateText } from "./gemini.ts";
import { type Db, fetchAll } from "./http.ts";
import { computeSleepScore, type ScoreDetails } from "./score.ts";

export type MorningSummary = {
  session_id: string;
  /** 計測がなかった夜は null（Q11） */
  score: number | null;
  label: string | null;
  details: ScoreDetails;
  comment: string;
};

export class SummaryError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function runMorningSummary(db: Db, sessionId: string): Promise<MorningSummary> {
  const { data: session, error } = await db.from("sleep_sessions").select("*").eq("id", sessionId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!session) throw new SummaryError(404, "session_not_found", "睡眠セッションが見つかりません");
  if (session.status !== "completed" || !session.end_time) {
    throw new SummaryError(409, "session_not_completed", "起床していないセッションはスコアを計算できません");
  }

  const [motions, audioCount, breathing, environment, presence, profile] = await Promise.all([
    fetchAll((from, to) =>
      db.from("motion_events").select("timestamp").eq("session_id", sessionId).order("timestamp").range(from, to),
    ),
    db.from("audio_events").select("id", { count: "exact", head: true }).eq("session_id", sessionId),
    fetchAll((from, to) =>
      db.from("breathing_readings").select("breaths_per_min").eq("session_id", sessionId).order("timestamp").range(from, to),
    ),
    fetchAll((from, to) =>
      db
        .from("environment_readings")
        .select("temperature_c, humidity_pct")
        .eq("session_id", sessionId)
        .order("timestamp")
        .range(from, to),
    ),
    fetchAll((from, to) =>
      db.from("presence_events").select("timestamp, state").eq("session_id", sessionId).order("timestamp").range(from, to),
    ),
    db.from("users").select("display_name").eq("id", session.user_id).maybeSingle(),
  ]);
  if (audioCount.error) throw new Error(audioCount.error.message);

  const result = computeSleepScore({
    startTime: new Date(session.start_time),
    endTime: new Date(session.actual_wake_time ?? session.end_time),
    motionTimes: motions.map((m) => new Date(m.timestamp)),
    audioEventCount: audioCount.count ?? 0,
    breathsPerMin: breathing.map((b) => Number(b.breaths_per_min)),
    environment: environment.map((e) => ({
      temperatureC: e.temperature_c === null ? null : Number(e.temperature_c),
      humidityPct: e.humidity_pct === null ? null : Number(e.humidity_pct),
    })),
    presence: presence.map((p) => ({ time: new Date(p.timestamp), state: p.state as "in_bed" | "out_of_bed" })),
  });

  const { error: updateError } = await db
    .from("sleep_sessions")
    .update({ score: result.score, score_details: result.details })
    .eq("id", sessionId);
  if (updateError) throw new Error(updateError.message);

  // actual_wake_time がない完了セッションは、巣に戻らないまま自動で締めたもの（close-stale-sessions）
  // にわとりのコメントは Gemini で作る。キーがない・混雑・障害のときは定型文（T-203）
  const name = profile.data?.display_name ?? "";
  const wakeDetected = session.actual_wake_time !== null;
  const generated = await generateText({ ...morningPrompt(result, name, wakeDetected), maxOutputTokens: 300 });
  const comment = generated ? toOneParagraph(generated.text) : morningComment(result, name, wakeDetected);
  await saveMorningComment(db, session.user_id, sessionId, session.actual_wake_time ?? session.end_time, comment);

  return { session_id: sessionId, score: result.score, label: result.label, details: result.details, comment };
}

/** 朝の振り返りの会話（trigger = scheduled_morning）に、にわとりのコメントを1件だけ残す。やり直したら書き換える */
async function saveMorningComment(db: Db, userId: string, sessionId: string, wakeTime: string, comment: string) {
  const { data: existing, error } = await db
    .from("chat_sessions")
    .select("id")
    .eq("sleep_session_id", sessionId)
    .eq("trigger", "scheduled_morning")
    .maybeSingle();
  if (error) throw new Error(error.message);

  if (existing) {
    const { error: updateError } = await db
      .from("chat_messages")
      .update({ content: comment })
      .eq("chat_session_id", existing.id)
      .eq("role", "assistant");
    if (updateError) throw new Error(updateError.message);
    return;
  }

  const { data: chat, error: insertError } = await db
    .from("chat_sessions")
    .insert({ user_id: userId, sleep_session_id: sessionId, trigger: "scheduled_morning", started_at: wakeTime, ended_at: wakeTime })
    .select("id")
    .single();
  if (insertError) throw new Error(insertError.message);
  const { error: messageError } = await db
    .from("chat_messages")
    .insert({ chat_session_id: chat.id, role: "assistant", content: comment });
  if (messageError) throw new Error(messageError.message);
}
