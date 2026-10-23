// 巣に戻らないまま残った睡眠セッションの扱い（docs/dev-plan.md 決定ログ 2026-10-09・T-209）。
// DB に依存しない純粋な関数。

/** 起床予定からこの時間がたっても巣に戻らなければ、記録を締める */
export const STALE_AFTER_MS = 3 * 60 * 60 * 1000;

/** 起床予定がこれより前の進行中セッションは、締める対象 */
export function staleCutoff(now: Date): Date {
  return new Date(now.getTime() - STALE_AFTER_MS);
}

/** 締めるときの終了時刻（起床予定＋3時間） */
export function staleEndTime(plannedWakeTime: Date): Date {
  return new Date(plannedWakeTime.getTime() + STALE_AFTER_MS);
}
