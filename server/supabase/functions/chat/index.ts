// Webアプリのにわとりとのテキスト会話（docs/api-spec.md §4-3、T-204）。
// 発言を保存し、睡眠の情報とこの会話の直近10件を Gemini に渡して返事を作る。Gemini が使えなければ定型の返事。
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

import {
  CHAT_FALLBACK,
  CHAT_HISTORY_LIMIT,
  CHAT_HOURLY_LIMIT,
  CHAT_LIMIT_REPLY,
  type ChatContext,
  chatSystem,
  toHistory,
  validateMessage,
} from "../_shared/chat.ts";
import { toOneParagraph } from "../_shared/comment.ts";
import { generateText } from "../_shared/gemini.ts";
import { CORS, type Db, jsonError, readJson } from "../_shared/http.ts";
import { formatJst, jstDateKey } from "../_shared/jst.ts";
import { scoreLabel } from "../_shared/score.ts";

const HOUR_MS = 60 * 60 * 1000;

export default {
  fetch: withSupabase({ auth: "user", cors: CORS }, async (req, ctx) => {
    const userId = ctx.userClaims!.id;
    const body = await readJson(req, 4 * 1024);
    if (body instanceof Response) return body;
    const input = (body ?? {}) as { message?: unknown; chat_session_id?: unknown };
    const checked = validateMessage(input.message);
    if ("error" in checked) return jsonError(400, "invalid_message", checked.error);

    // 会話の保存は RLS を通らない（クライアントには書き込みを許していない）。本人の分だけを扱う
    const db = ctx.supabaseAdmin as Db;
    const now = new Date();

    const chatSessionId = await resolveChatSession(db, userId, input.chat_session_id, now);
    const history = await recentMessages(db, chatSessionId);

    const { error: userError } = await db
      .from("chat_messages")
      .insert({ chat_session_id: chatSessionId, role: "user", content: checked.message });
    if (userError) throw new Error(userError.message);

    // 1時間の上限（Gemini の無料枠を使い切らないため）。超えたら AI を呼ばずに休憩をすすめる
    const overLimit = (await userMessagesInLastHour(db, userId, now)) > CHAT_HOURLY_LIMIT;
    const generated = overLimit
      ? null
      : await generateText({
          system: chatSystem(await loadContext(db, userId, now)),
          prompt: checked.message,
          history: toHistory(history),
          maxOutputTokens: 400,
        });
    const reply = generated ? toOneParagraph(generated.text) : overLimit ? CHAT_LIMIT_REPLY : CHAT_FALLBACK;

    const { error: replyError } = await db
      .from("chat_messages")
      .insert({ chat_session_id: chatSessionId, role: "assistant", content: reply });
    if (replyError) throw new Error(replyError.message);
    await db.from("chat_sessions").update({ ended_at: new Date().toISOString() }).eq("id", chatSessionId);

    return Response.json({ chat_session_id: chatSessionId, reply, fallback: generated === null });
  }),
};

/** 続きの会話なら、その会話の id（本人のアプリでの会話に限る）。そうでなければ新しく作る */
async function resolveChatSession(db: Db, userId: string, requested: unknown, now: Date): Promise<string> {
  if (typeof requested === "string" && requested.length > 0) {
    const { data } = await db
      .from("chat_sessions")
      .select("id")
      .eq("id", requested)
      .eq("user_id", userId)
      .eq("trigger", "app")
      .maybeSingle();
    if (data) return data.id;
  }
  const { data, error } = await db
    .from("chat_sessions")
    .insert({ user_id: userId, trigger: "app", started_at: now.toISOString() })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

/** この会話の直近の発言（古い順） */
async function recentMessages(db: Db, chatSessionId: string) {
  const { data, error } = await db
    .from("chat_messages")
    .select("role, content")
    .eq("chat_session_id", chatSessionId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(CHAT_HISTORY_LIMIT);
  if (error) throw new Error(error.message);
  return (data ?? []).reverse();
}

async function userMessagesInLastHour(db: Db, userId: string, now: Date): Promise<number> {
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
async function loadContext(db: Db, userId: string, now: Date): Promise<ChatContext> {
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
