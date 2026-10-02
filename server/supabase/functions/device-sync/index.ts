// 鶏 → サーバー：状態の報告と、次に鳴らすアラーム・進行中のセッション・設定の取得（docs/api-spec.md §3-2）
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

import { authenticateChicken, resolveEgg } from "../_shared/devices.ts";
import { CORS, type Db, jsonError, readJson } from "../_shared/http.ts";
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

    const [sessionResult, alarmResult, settingsResult] = await Promise.all([
      db
        .from("sleep_sessions")
        .select("id, status, start_time, planned_wake_time")
        .eq("user_id", chicken.user_id)
        .eq("status", "in_progress")
        .maybeSingle(),
      db.rpc("next_alarm_at", { p_user_id: chicken.user_id, p_from: now.toISOString() }).maybeSingle(),
      db.from("notification_settings").select("character_voice").eq("user_id", chicken.user_id).maybeSingle(),
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

    return Response.json({
      server_time: now.toISOString(),
      alarm,
      session,
      settings: { character_voice: settingsResult.data?.character_voice ?? "rooster" },
    });
  }),
};
