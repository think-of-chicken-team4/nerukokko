import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;

/** グラフの1点（t はミリ秒の時刻） */
export type Point = { t: number; v: number };

export type NightSession = {
  id: string;
  start_time: string;
  end_time: string | null;
  planned_wake_time: string;
  actual_wake_time: string | null;
  status: string;
  score: number | null;
  /** スコアの内訳。score が null でもこれがあれば「計測できなかった夜」（Q11） */
  score_details: unknown;
};

export type NightRecord = {
  session: NightSession;
  /** グラフの横軸の範囲（就寝〜終了。記録中なら今まで） */
  range: { start: number; end: number };
  motions: number[];
  audio: { t: number; type: "snore" | "sleep_talk" }[];
  breathing: Point[];
  temperature: Point[];
  humidity: Point[];
  illuminance: Point[];
  messages: { role: "user" | "assistant"; content: string; created_at: string }[];
};

// Supabase は1回の読み込みで最大1000行（config.toml の max_rows）なので、それを超える夜は分けて読む
const PAGE = 1000;

async function fetchAll<T>(
  load: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  label: string,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await load(from, from + PAGE - 1);
    if (error) throw new Error(`${label}を読めませんでした: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

/** グラフに描く点を、時間で区切った区間ごとの平均にして maxPoints 個までに減らす */
export function downsample(points: Point[], maxPoints = 144): Point[] {
  if (points.length <= maxPoints) return points;
  const start = points[0].t;
  const span = points[points.length - 1].t - start || 1;
  const buckets = new Map<number, { t: number; v: number; n: number }>();
  for (const p of points) {
    const key = Math.min(maxPoints - 1, Math.floor(((p.t - start) / span) * maxPoints));
    const b = buckets.get(key) ?? { t: 0, v: 0, n: 0 };
    b.t += p.t;
    b.v += p.v;
    b.n += 1;
    buckets.set(key, b);
  }
  return [...buckets.values()].map((b) => ({ t: b.t / b.n, v: b.v / b.n })).sort((a, b) => a.t - b.t);
}

function toPoints<R extends { timestamp: string }>(rows: R[], value: (row: R) => number | null): Point[] {
  return rows.flatMap((row) => {
    const v = value(row);
    return v === null ? [] : [{ t: new Date(row.timestamp).getTime(), v: Number(v) }];
  });
}

/**
 * 記録（1晩）の画面に出すデータ（APP-08）。見つからない（別のユーザーの記録など）ときは null。
 * 会話ログは、その夜に紐づいた会話（chat_sessions.sleep_session_id）のメッセージ。
 */
export async function getNightRecord(supabase: Client, sessionId: string, now: Date = new Date()): Promise<NightRecord | null> {
  const { data: session, error } = await supabase
    .from("sleep_sessions")
    .select("id, start_time, end_time, planned_wake_time, actual_wake_time, status, score, score_details")
    .eq("id", sessionId)
    .maybeSingle();
  if (error) throw new Error(`睡眠記録を読めませんでした: ${error.message}`);
  if (!session) return null;

  const [motionRows, audioRows, breathingRows, envRows, chatResult] = await Promise.all([
    fetchAll(
      (from, to) =>
        supabase.from("motion_events").select("timestamp").eq("session_id", sessionId).order("timestamp").range(from, to),
      "寝返り",
    ),
    fetchAll(
      (from, to) =>
        supabase
          .from("audio_events")
          .select("timestamp, event_type")
          .eq("session_id", sessionId)
          .order("timestamp")
          .range(from, to),
      "いびき・寝言",
    ),
    fetchAll(
      (from, to) =>
        supabase
          .from("breathing_readings")
          .select("timestamp, breaths_per_min")
          .eq("session_id", sessionId)
          .order("timestamp")
          .range(from, to),
      "呼吸数",
    ),
    fetchAll(
      (from, to) =>
        supabase
          .from("environment_readings")
          .select("timestamp, temperature_c, humidity_pct, illuminance_lux")
          .eq("session_id", sessionId)
          .order("timestamp")
          .range(from, to),
      "室温・湿度・明るさ",
    ),
    supabase
      .from("chat_sessions")
      .select("chat_messages(role, content, created_at)")
      .eq("sleep_session_id", sessionId),
  ]);
  if (chatResult.error) throw new Error(`会話を読めませんでした: ${chatResult.error.message}`);

  const start = new Date(session.start_time).getTime();
  const end = session.end_time ? new Date(session.end_time).getTime() : Math.max(start + 60_000, now.getTime());
  const messages = (chatResult.data ?? [])
    .flatMap((c) => c.chat_messages)
    .map((m) => ({ ...m, role: m.role === "user" ? ("user" as const) : ("assistant" as const) }))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  return {
    session,
    range: { start, end },
    motions: motionRows.map((r) => new Date(r.timestamp).getTime()),
    audio: audioRows.map((r) => ({
      t: new Date(r.timestamp).getTime(),
      type: r.event_type === "sleep_talk" ? ("sleep_talk" as const) : ("snore" as const),
    })),
    breathing: downsample(toPoints(breathingRows, (r) => r.breaths_per_min)),
    temperature: downsample(toPoints(envRows, (r) => r.temperature_c)),
    humidity: downsample(toPoints(envRows, (r) => r.humidity_pct)),
    illuminance: downsample(toPoints(envRows, (r) => r.illuminance_lux)),
    messages,
  };
}
