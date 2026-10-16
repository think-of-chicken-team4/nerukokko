import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { jstHour } from "@/lib/format";
import type { Phase } from "@/lib/phase";
import type { Database } from "@/types/database";

// 「就寝準備（prep）」は画面の操作で入るフェーズなので、DB からは判定しない（getHomePhase で cookie を見る）
export type DbPhase = Exclude<Phase, "prep">;

/** 「就寝準備へ進む」を押したことを覚えておく cookie。上部のステータスバー（layout）からも読めるように cookie にする */
export const PREP_COOKIE = "nerukokko-prep";
/** 押してから眠らないまま、この時間がたったら夕方確認に戻す */
export const PREP_MAX_AGE_SEC = 6 * 60 * 60;

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
  // 読み込みに失敗したら「夕方」と誤表示せず、エラー画面（error.tsx）を出す
  const { data: active, error: activeError } = await supabase
    .from("sleep_sessions")
    .select("id, start_time, planned_wake_time")
    .eq("status", "in_progress")
    .maybeSingle();
  if (activeError) throw new Error(`進行中の睡眠記録を読めませんでした: ${activeError.message}`);
  if (active) {
    const phase = now < new Date(active.planned_wake_time) ? "sleeping" : "wake";
    return { phase, session: active };
  }

  const { data: last, error: lastError } = await supabase
    .from("sleep_sessions")
    .select("id, start_time, planned_wake_time, end_time")
    .eq("status", "completed")
    .order("end_time", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastError) throw new Error(`直前の睡眠記録を読めませんでした: ${lastError.message}`);
  if (
    last?.end_time &&
    now.getTime() - new Date(last.end_time).getTime() < MORNING_WINDOW_MS &&
    jstHour(now) < MORNING_END_HOUR
  ) {
    return { phase: "morning", session: last };
  }

  return { phase: "dusk", session: null };
}

/**
 * ホームに表示するフェーズ。DB で「夕方確認」と判定され、「就寝準備へ進む」を押していれば「就寝準備」にする（§5-2）。
 */
export async function getHomePhase(
  supabase: SupabaseClient<Database>,
): Promise<{ phase: Phase; session: PhaseSession | null }> {
  const current = await getCurrentPhase(supabase);
  // has() ではなく値で見る。「戻る」で消した直後の再描画では、消した cookie が空の値で残って見えるため
  if (current.phase === "dusk" && (await cookies()).get(PREP_COOKIE)?.value === "1") {
    return { phase: "prep", session: null };
  }
  return current;
}
