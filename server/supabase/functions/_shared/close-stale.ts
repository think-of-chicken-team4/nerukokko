// 巣に戻らないまま起床予定から3時間たった睡眠セッションを完了にし、朝の振り返り（スコアとコメント）を作る（T-209）。
// close-stale-sessions（定期実行）と device-sync（鶏が30秒ごとに呼ぶ、念のため）から呼ぶ。

import type { Db } from "./http.ts";
import { runMorningSummary } from "./morning-summary.ts";
import { staleCutoff, staleEndTime } from "./stale-session.ts";

/**
 * 締めたセッションの id を返す。userId を渡すとそのユーザーの分だけ。
 * 締めたあとのスコア計算は、呼び出し側が runMorningSummary をそのまま待つか、バックグラウンドで行う。
 */
export async function closeStaleSessions(db: Db, options: { userId?: string; now?: Date } = {}): Promise<string[]> {
  const now = options.now ?? new Date();
  let query = db
    .from("sleep_sessions")
    .select("id, planned_wake_time")
    .eq("status", "in_progress")
    .lt("planned_wake_time", staleCutoff(now).toISOString());
  if (options.userId) query = query.eq("user_id", options.userId);
  const { data: stale, error } = await query;
  if (error) throw new Error(error.message);

  const closed: string[] = [];
  for (const session of stale ?? []) {
    // status = in_progress を条件にして、同時に巣に戻った（charge_start）場合と二重に締めない
    // actual_wake_time は入れない（起床を検知できなかった印。朝の画面とコメントで使う）
    const { data, error: updateError } = await db
      .from("sleep_sessions")
      .update({ status: "completed", end_time: staleEndTime(new Date(session.planned_wake_time)).toISOString() })
      .eq("id", session.id)
      .eq("status", "in_progress")
      .select("id");
    if (updateError) throw new Error(updateError.message);
    if (data && data.length > 0) closed.push(session.id);
  }
  return closed;
}

/** 締めたセッションのスコアとコメントを作る。1件が失敗しても残りは続ける */
export async function summarizeClosed(db: Db, sessionIds: string[]): Promise<void> {
  for (const id of sessionIds) {
    try {
      await runMorningSummary(db, id);
    } catch (error) {
      console.error(`morning-summary (stale ${id}) failed`, error);
    }
  }
}
