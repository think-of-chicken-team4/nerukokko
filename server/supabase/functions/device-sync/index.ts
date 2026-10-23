// 鶏 → サーバー：状態の報告と、次に鳴らすアラーム・進行中のセッション・設定の取得（docs/api-spec.md §3-2）
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

import { type Announcement, pickAnnouncements } from "../_shared/announcements.ts";
import { closeStaleSessions, summarizeClosed } from "../_shared/close-stale.ts";
import { authenticateChicken, resolveEgg } from "../_shared/devices.ts";
import { CORS, type Db, jsonError, readJson, runInBackground } from "../_shared/http.ts";
import { jstDateKey } from "../_shared/jst.ts";
import { normalizeMac } from "../_shared/ingest-payload.ts";

const MAX_BODY_BYTES = 16 * 1024;

// status として保存する項目と、その値の型（api-spec §3-2）。それ以外は保存しない
const STATUS_FIELDS = {
  alarm_ringing: "boolean",
  egg_connected: "boolean",
  egg_docked: "boolean",
  egg_battery_level: "number",
  temperature_c: "number",
  humidity_pct: "number",
  illuminance_lux: "number",
} as const;

export default {
  fetch: withSupabase({ auth: "publishable", cors: CORS }, async (req, ctx) => {
    const db = ctx.supabaseAdmin as Db;
    const chicken = await authenticateChicken(req, db);
    if (chicken instanceof Response) return chicken;

    const body = await readJson(req, MAX_BODY_BYTES);
    if (body instanceof Response) return body;
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return jsonError(400, "invalid_body", "JSON のオブジェクトを送ってください");
    }
    const input = body as Record<string, unknown>;
    const rawStatus = (typeof input.status === "object" && input.status !== null ? input.status : {}) as Record<string, unknown>;
    const status = Object.fromEntries(
      Object.entries(STATUS_FIELDS)
        .filter(([key, type]) => typeof rawStatus[key] === type)
        .map(([key]) => [key, rawStatus[key]]),
    );

    const now = new Date();
    const { error: updateError } = await db
      .from("devices")
      .update({
        last_seen: now.toISOString(),
        status: { ...status, reported_at: now.toISOString() },
        ...(typeof input.firmware_version === "string" ? { firmware_version: input.firmware_version } : {}),
      })
      .eq("id", chicken.id);
    if (updateError) throw new Error(updateError.message);

    // たまごとつながっていれば、たまごの最終通信とバッテリーも更新する
    const eggMac = normalizeMac(input.egg_mac_address);
    if (eggMac) {
      const egg = await resolveEgg(db, chicken.user_id, eggMac);
      if (egg && status.egg_connected === true) {
        const battery = status.egg_battery_level;
        const { error } = await db
          .from("devices")
          .update({
            last_seen: now.toISOString(),
            ...(typeof battery === "number" && battery >= 0 && battery <= 100 ? { battery_level: Math.round(battery) } : {}),
          })
          .eq("id", egg.id);
        if (error) throw new Error(error.message);
      }
    }

    // 巣に戻らないまま起床予定から3時間たった記録を締める（定期実行の close-stale-sessions の予備。T-209）
    // 締めたあとは進行中のセッションがなくなるので、鶏のアラームも止まる（alarm は次のアラームになる）
    const closed = await closeStaleSessions(db, { userId: chicken.user_id, now });
    if (closed.length > 0) runInBackground(summarizeClosed(db, closed), "morning-summary (stale)");

    const [sessionResult, alarmResult, settingsResult] = await Promise.all([
      db
        .from("sleep_sessions")
        .select("id, status, start_time, planned_wake_time")
        .eq("user_id", chicken.user_id)
        .eq("status", "in_progress")
        .maybeSingle(),
      db.rpc("next_alarm_at", { p_user_id: chicken.user_id, p_from: now.toISOString() }).maybeSingle(),
      db
        .from("notification_settings")
        .select("character_voice, evening_suggestion, morning_score")
        .eq("user_id", chicken.user_id)
        .maybeSingle(),
    ]);
    for (const result of [sessionResult, alarmResult, settingsResult]) {
      if (result.error) throw new Error(result.error.message);
    }

    // 進行中のセッションがあればその起床予定時刻、なければ有効なアラームの次の時刻に鳴らす
    const session = sessionResult.data;
    const nextAlarm = alarmResult.data;
    const alarm = session
      ? { ring_at: session.planned_wake_time, source: "session", alarm_id: null }
      : nextAlarm
        ? { ring_at: nextAlarm.ring_at, source: "alarm", alarm_id: nextAlarm.alarm_id }
        : null;

    const announcements = await takeAnnouncements(db, chicken.user_id, now, {
      sleeping: session !== null,
      eveningEnabled: settingsResult.data?.evening_suggestion ?? true,
      morningEnabled: settingsResult.data?.morning_score ?? true,
    });

    return Response.json({
      server_time: now.toISOString(),
      alarm,
      session,
      settings: { character_voice: settingsResult.data?.character_voice ?? "rooster" },
      announcements,
    });
  }),
};

const jstHourFormatter = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tokyo", hour: "numeric", hourCycle: "h23" });

/**
 * 鶏が話して知らせる内容（夕方の就寝提案・朝のコメント）を選び、渡したことを記録する（決定ログ 2026-10-16 Q9）。
 * 「まだ話していない」ものだけを、条件付きの更新で取り出すので、同時に2回呼ばれても二重には渡さない。
 */
async function takeAnnouncements(
  db: Db,
  userId: string,
  now: Date,
  flags: { sleeping: boolean; eveningEnabled: boolean; morningEnabled: boolean },
): Promise<Announcement[]> {
  const [recommendation, lastNight] = await Promise.all([
    db
      .from("sleep_recommendations")
      .select("id, recommended_bedtime, reasoning, announced_at")
      .eq("user_id", userId)
      .gte("target_date", jstDateKey(now))
      .order("target_date")
      .limit(1)
      .maybeSingle(),
    db
      .from("sleep_sessions")
      .select("id, end_time, morning_announced_at")
      .eq("user_id", userId)
      .eq("status", "completed")
      .order("end_time", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (recommendation.error) throw new Error(recommendation.error.message);
  if (lastNight.error) throw new Error(lastNight.error.message);

  let comment: string | null = null;
  if (lastNight.data && !lastNight.data.morning_announced_at) {
    const { data } = await db
      .from("chat_sessions")
      .select("chat_messages(role, content)")
      .eq("sleep_session_id", lastNight.data.id)
      .eq("trigger", "scheduled_morning")
      .maybeSingle();
    comment = data?.chat_messages.find((m) => m.role === "assistant")?.content ?? null;
  }

  const picked = pickAnnouncements({
    now,
    jstHour: Number(jstHourFormatter.format(now)),
    ...flags,
    recommendation: recommendation.data,
    lastNight: lastNight.data ? { ...lastNight.data, comment } : null,
  });

  const taken: Announcement[] = [];
  for (const announcement of picked) {
    const update =
      announcement.kind === "evening_suggestion"
        ? db
            .from("sleep_recommendations")
            .update({ announced_at: now.toISOString() })
            .eq("id", recommendation.data!.id)
            .is("announced_at", null)
        : db
            .from("sleep_sessions")
            .update({ morning_announced_at: now.toISOString() })
            .eq("id", lastNight.data!.id)
            .is("morning_announced_at", null);
    const { data, error } = await update.select("id");
    if (error) throw new Error(error.message);
    if (data && data.length > 0) taken.push(announcement);
  }
  return taken;
}
