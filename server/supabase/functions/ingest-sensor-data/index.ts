// 鶏 → サーバー：計測データの取り込み（docs/api-spec.md §3-1）
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

import { authenticateChicken, type Device, resolveEgg } from "../_shared/devices.ts";
import { CORS, type Db, readJson, runInBackground, type TableName } from "../_shared/http.ts";
import {
  findSessionFor,
  isParseError,
  ITEM_KINDS,
  type ItemKind,
  parseIngestPayload,
  type ParsedPayload,
  type Skipped,
} from "../_shared/ingest-payload.ts";
import { runMorningSummary } from "../_shared/morning-summary.ts";

const MAX_BODY_BYTES = 1024 * 1024;

type Session = { id: string; start_time: string; end_time: string | null; status: string };

export default {
  fetch: withSupabase({ auth: "publishable", cors: CORS }, async (req, ctx) => {
    const db = ctx.supabaseAdmin as Db;
    const chicken = await authenticateChicken(req, db);
    if (chicken instanceof Response) return chicken;

    const body = await readJson(req, MAX_BODY_BYTES);
    if (body instanceof Response) return body;

    const now = new Date();
    const payload = parseIngestPayload(body, now);
    if (isParseError(payload)) {
      return Response.json({ error: payload.error }, { status: payload.error.status });
    }

    const egg = payload.egg ? await resolveEgg(db, chicken.user_id, payload.egg.macAddress) : null;
    await touchDevices(db, chicken, payload, egg, now);

    const sessions = await loadSessions(db, chicken.user_id, payload);
    const skipped: Skipped[] = [...payload.skipped];
    const accepted = Object.fromEntries(ITEM_KINDS.map((k) => [k, 0])) as Record<ItemKind, number>;
    const touchedSessionIds = new Set<string>();

    // どのセッションの計測かを時刻で決める。どのセッションにも入らない計測はスキップ（api-spec §3-1）
    const withSession = <T extends { index: number; time: Date }>(kind: ItemKind, items: T[]) =>
      items.flatMap((item) => {
        const session = findSessionFor(sessions, item.time);
        if (!session) {
          skipped.push({ kind, index: item.index, reason: "no_session" });
          return [];
        }
        touchedSessionIds.add(session.id);
        return [{ item, sessionId: session.id }];
      });

    // たまごの計測なのにたまごが分からない（別のユーザーのたまご・egg が送られていない）ときはスキップ
    const deviceFor = (kind: ItemKind, index: number, isEgg: boolean): string | null => {
      if (!isEgg) return chicken.id;
      if (egg) return egg.id;
      skipped.push({ kind, index, reason: "invalid_value" });
      return null;
    };

    const inserts: Promise<void>[] = [];
    const insert = <Row extends { timestamp: string }>(
      kind: ItemKind,
      table: TableName,
      onConflict: string,
      rows: { index: number; row: Row; key: string }[],
      keyOf: (row: Record<string, unknown>) => string,
    ) => {
      if (rows.length === 0) return;
      inserts.push(
        (async () => {
          const { data, error } = await db
            .from(table)
            // deno-lint-ignore no-explicit-any
            .upsert(rows.map((r) => r.row) as any, { onConflict, ignoreDuplicates: true })
            .select(onConflict);
          if (error) throw new Error(`${table}: ${error.message}`);
          const saved = new Set((data as unknown as Record<string, unknown>[]).map(keyOf));
          for (const r of rows) {
            if (saved.has(r.key)) accepted[kind] += 1;
            else skipped.push({ kind, index: r.index, reason: "duplicate" });
          }
        })(),
      );
    };
    const key = (deviceId: unknown, timestamp: unknown, extra = "") =>
      `${deviceId}|${new Date(String(timestamp)).getTime()}|${extra}`;

    insert(
      "environment",
      "environment_readings",
      "device_id,timestamp",
      withSession("environment", payload.environment).map(({ item, sessionId }) => ({
        index: item.index,
        key: key(chicken.id, item.time.toISOString()),
        row: {
          session_id: sessionId,
          device_id: chicken.id,
          timestamp: item.time.toISOString(),
          temperature_c: item.temperatureC,
          humidity_pct: item.humidityPct,
          illuminance_lux: item.illuminanceLux,
        },
      })),
      (r) => key(r.device_id, r.timestamp),
    );

    insert(
      "breathing",
      "breathing_readings",
      "device_id,timestamp,signal_source",
      withSession("breathing", payload.breathing).map(({ item, sessionId }) => ({
        index: item.index,
        key: key(chicken.id, item.time.toISOString(), item.source),
        row: {
          session_id: sessionId,
          device_id: chicken.id,
          timestamp: item.time.toISOString(),
          breaths_per_min: item.breathsPerMin,
          signal_source: item.source,
        },
      })),
      (r) => key(r.device_id, r.timestamp, String(r.signal_source)),
    );

    insert(
      "motion_events",
      "motion_events",
      "device_id,timestamp,detection_source",
      withSession("motion_events", payload.motion_events).flatMap(({ item, sessionId }) => {
        const deviceId = deviceFor("motion_events", item.index, item.source === "accelerometer");
        if (!deviceId) return [];
        return [{
          index: item.index,
          key: key(deviceId, item.time.toISOString(), item.source),
          row: {
            session_id: sessionId,
            device_id: deviceId,
            timestamp: item.time.toISOString(),
            intensity: item.intensity,
            detection_source: item.source,
          },
        }];
      }),
      (r) => key(r.device_id, r.timestamp, String(r.detection_source)),
    );

    insert(
      "audio_events",
      "audio_events",
      "device_id,timestamp,event_type",
      withSession("audio_events", payload.audio_events).flatMap(({ item, sessionId }) => {
        const deviceId = deviceFor("audio_events", item.index, item.device === "egg");
        if (!deviceId) return [];
        return [{
          index: item.index,
          key: key(deviceId, item.time.toISOString(), item.type),
          row: {
            session_id: sessionId,
            device_id: deviceId,
            timestamp: item.time.toISOString(),
            event_type: item.type,
            duration_ms: item.durationMs,
            confidence: item.confidence,
          },
        }];
      }),
      (r) => key(r.device_id, r.timestamp, String(r.event_type)),
    );

    insert(
      "presence_events",
      "presence_events",
      "device_id,timestamp",
      withSession("presence_events", payload.presence_events).map(({ item, sessionId }) => ({
        index: item.index,
        key: key(chicken.id, item.time.toISOString()),
        row: { session_id: sessionId, device_id: chicken.id, timestamp: item.time.toISOString(), state: item.state },
      })),
      (r) => key(r.device_id, r.timestamp),
    );

    // 充電イベントはセッションの外でも記録する（session_id は NULL 可）
    insert(
      "charge_events",
      "charge_events",
      "egg_device_id,timestamp,event_type",
      payload.charge_events.flatMap((item) => {
        const eggId = deviceFor("charge_events", item.index, true);
        if (!eggId) return [];
        return [{
          index: item.index,
          key: key(eggId, item.time.toISOString(), item.type),
          row: {
            egg_device_id: eggId,
            session_id: findSessionFor(sessions, item.time)?.id ?? null,
            timestamp: item.time.toISOString(),
            event_type: item.type,
          },
        }];
      }),
      (r) => key(r.egg_device_id, r.timestamp, String(r.event_type)),
    );

    await Promise.all(inserts);
    await fillSessionDevices(db, [...touchedSessionIds], chicken, egg);

    // たまごが巣に戻った（charge_start）→ 進行中のセッションを完了にし、朝の振り返りをバックグラウンドで作る
    if (egg) {
      const wakeTime = payload.charge_events
        .filter((c) => c.type === "charge_start")
        .map((c) => c.time)
        .sort((a, b) => a.getTime() - b.getTime())[0];
      if (wakeTime) {
        const completedId = await completeActiveSession(db, chicken.user_id, wakeTime, egg.id);
        if (completedId) {
          runInBackground(runMorningSummary(db, completedId), "morning-summary");
        }
      }
    }

    const { data: active } = await db
      .from("sleep_sessions")
      .select("id, status")
      .eq("user_id", chicken.user_id)
      .eq("status", "in_progress")
      .maybeSingle();

    skipped.sort((a, b) => ITEM_KINDS.indexOf(a.kind) - ITEM_KINDS.indexOf(b.kind) || a.index - b.index);
    return Response.json({ accepted, skipped, session: active ?? null });
  }),
};

/** 鶏・たまごの最終通信時刻とファームウェア・バッテリーを更新する */
async function touchDevices(db: Db, chicken: Device, payload: ParsedPayload, egg: Device | null, now: Date) {
  const updates = [
    db.from("devices").update({ last_seen: now.toISOString(), firmware_version: payload.firmwareVersion }).eq("id", chicken.id),
  ];
  if (egg && payload.egg) {
    updates.push(
      db
        .from("devices")
        .update({
          last_seen: now.toISOString(),
          ...(payload.egg.firmwareVersion ? { firmware_version: payload.egg.firmwareVersion } : {}),
          ...(payload.egg.batteryLevel !== null ? { battery_level: payload.egg.batteryLevel } : {}),
        })
        .eq("id", egg.id),
    );
  }
  for (const { error } of await Promise.all(updates)) {
    if (error) throw new Error(error.message);
  }
}

/** 送られてきた計測時刻の範囲に重なる、そのユーザーの睡眠セッション */
async function loadSessions(db: Db, userId: string, payload: ParsedPayload): Promise<Session[]> {
  const times = ITEM_KINDS.flatMap((kind) => payload[kind].map((item) => item.time.getTime()));
  if (times.length === 0) return [];
  const from = new Date(Math.min(...times)).toISOString();
  const to = new Date(Math.max(...times)).toISOString();
  const { data, error } = await db
    .from("sleep_sessions")
    .select("id, start_time, end_time, status")
    .eq("user_id", userId)
    .lte("start_time", to)
    .or(`end_time.is.null,end_time.gte.${from}`);
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** セッションに鶏・たまごがまだ紐づいていなければ紐づける */
async function fillSessionDevices(db: Db, sessionIds: string[], chicken: Device, egg: Device | null) {
  if (sessionIds.length === 0) return;
  const tasks = [
    db.from("sleep_sessions").update({ chicken_device_id: chicken.id }).in("id", sessionIds).is("chicken_device_id", null),
  ];
  if (egg) {
    tasks.push(db.from("sleep_sessions").update({ egg_device_id: egg.id }).in("id", sessionIds).is("egg_device_id", null));
  }
  for (const { error } of await Promise.all(tasks)) {
    if (error) throw new Error(error.message);
  }
}

/** 進行中のセッションを、たまごが巣に戻った時刻で完了にする。完了にしたセッションの ID を返す */
async function completeActiveSession(db: Db, userId: string, wakeTime: Date, eggId: string): Promise<string | null> {
  const { data: active, error } = await db
    .from("sleep_sessions")
    .select("id, start_time, egg_device_id")
    .eq("user_id", userId)
    .eq("status", "in_progress")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!active || new Date(active.start_time) > wakeTime) return null;

  const wake = wakeTime.toISOString();
  const { error: updateError } = await db
    .from("sleep_sessions")
    .update({
      status: "completed",
      end_time: wake,
      actual_wake_time: wake,
      ...(active.egg_device_id ? {} : { egg_device_id: eggId }),
    })
    .eq("id", active.id)
    .eq("status", "in_progress");
  if (updateError) throw new Error(updateError.message);
  return active.id;
}
