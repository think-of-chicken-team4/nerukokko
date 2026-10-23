import type { SupabaseClient } from "@supabase/supabase-js";

import { jstDateKey } from "@/lib/format";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;

const DAY_MS = 24 * 60 * 60 * 1000;
export const WEEK_DAYS = 7;

export type WeekNight = {
  id: string;
  start_time: string;
  end_time: string | null;
  status: string;
  score: number | null;
  /** スコアの内訳。score が null でもこれがあれば「計測できなかった夜」（Q11） */
  score_details: unknown;
  turns: number;
  snores: number;
};

/** 棒グラフの1日分。dateKey は起きた日（日本時間）。その日に起きた夜がなければ score は null */
export type WeekDay = { dateKey: string; date: Date; score: number | null; sessionId: string | null };

export type WeekRecord = {
  days: WeekDay[];
  /** スコアが出た夜の平均（なければ null） */
  average: number | null;
  /** 直近7日の夜（新しい順。中止した夜も含む） */
  nights: WeekNight[];
};

/**
 * 記録（週間）の画面に出すデータ（APP-09）。今日を含む直近7日に始まった夜を集める。
 * 棒グラフは「起きた日」（終了した日、日本時間）ごとに1本。同じ日に複数あれば、あとに終わった夜のスコアを使う。
 */
export async function getWeekRecord(supabase: Client, now: Date = new Date()): Promise<WeekRecord> {
  const from = new Date(now.getTime() - WEEK_DAYS * DAY_MS);
  const { data: sessions, error } = await supabase
    .from("sleep_sessions")
    .select("id, start_time, end_time, status, score, score_details")
    .gte("start_time", from.toISOString())
    .order("start_time", { ascending: false });
  if (error) throw new Error(`睡眠記録を読めませんでした: ${error.message}`);

  // 回数は夜ごとに数える（一晩で数百件になりうるので、行は読まずに件数だけ聞く）
  const counts = await Promise.all(
    sessions.map(async (s) => {
      const [motion, audio] = await Promise.all([
        supabase.from("motion_events").select("id", { count: "exact", head: true }).eq("session_id", s.id),
        supabase
          .from("audio_events")
          .select("id", { count: "exact", head: true })
          .eq("session_id", s.id)
          .eq("event_type", "snore"),
      ]);
      if (motion.error || audio.error) throw new Error("寝返り・いびきの回数を読めませんでした");
      return { turns: motion.count ?? 0, snores: audio.count ?? 0 };
    }),
  );
  const nights: WeekNight[] = sessions.map((s, i) => ({ ...s, ...counts[i] }));

  const scored = nights
    .filter((n) => n.status === "completed" && n.score !== null && n.end_time)
    .sort((a, b) => a.end_time!.localeCompare(b.end_time!));
  const byDay = new Map(scored.map((n) => [jstDateKey(n.end_time!), n]));

  const days: WeekDay[] = Array.from({ length: WEEK_DAYS }, (_, i) => {
    const date = new Date(now.getTime() - (WEEK_DAYS - 1 - i) * DAY_MS);
    const key = jstDateKey(date);
    const night = byDay.get(key);
    return { dateKey: key, date, score: night?.score ?? null, sessionId: night?.id ?? null };
  });
  const scores = days.flatMap((d) => (d.score === null ? [] : [d.score]));

  return {
    days,
    average: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
    nights,
  };
}
