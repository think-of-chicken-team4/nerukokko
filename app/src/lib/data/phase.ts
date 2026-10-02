import type { SupabaseClient } from "@supabase/supabase-js";

import { jstHour } from "@/lib/format";
import type { Phase } from "@/lib/phase";
import type { Database } from "@/types/database";

// 「就寝準備（prep）」は画面の操作で入るフェーズなので、DB からは判定しない
export type DbPhase = Exclude<Phase, "prep">;

export type PhaseSession = { id: string; start_time: string; planned_wake_time: string };

export type CurrentPhase = {
  phase: DbPhase;
  /** 睡眠記録・起床制御なら進行中の、朝の振り返りなら直前に完了したセッション */
  session: PhaseSession | null;
};

const MORNING_WINDOW_MS = 12 * 60 * 60 * 1000;
const MORNING_END_HOUR = 17;

/**
 * DB の状態から今のフェーズを判定する（docs/dev-plan.md §5-2）。
 * RLS により、ログイン中のユーザーのセッションだけが対象になる。
 */
export async function getCurrentPhase(
  supabase: SupabaseClient<Database>,
  now: Date = new Date(),
): Promise<CurrentPhase> {
  const { data: active } = await supabase
    .from("sleep_sessions")
    .select("id, start_time, planned_wake_time")
    .eq("status", "in_progress")
    .maybeSingle();
  if (active) {
    const phase = now < new Date(active.planned_wake_time) ? "sleeping" : "wake";
    return { phase, session: active };
  }

  const { data: last } = await supabase
    .from("sleep_sessions")
    .select("id, start_time, planned_wake_time, end_time")
    .eq("status", "completed")
    .order("end_time", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (
    last?.end_time &&
    now.getTime() - new Date(last.end_time).getTime() < MORNING_WINDOW_MS &&
    jstHour(now) < MORNING_END_HOUR
  ) {
    return { phase: "morning", session: last };
  }

  return { phase: "dusk", session: null };
}
