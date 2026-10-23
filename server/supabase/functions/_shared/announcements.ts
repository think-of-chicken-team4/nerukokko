// 鶏が話して知らせる内容（夕方の就寝提案・朝のコメント）を選ぶ（決定ログ 2026-10-16 Q9）。DB に依存しない純粋な関数。
// device-sync が鶏に渡し、鶏は speak で声にして流す（docs/api-spec.md §3-2・§3-4）。

/** 夕方の提案を話しはじめる時刻（日本時間の時） */
export const EVENING_FROM_HOUR = 19;
/** 朝のコメントを話すのは、記録が終わってからこの時間まで */
export const MORNING_WITHIN_MS = 3 * 60 * 60 * 1000;

export type AnnouncementKind = "evening_suggestion" | "morning_summary";
export type Announcement = { kind: AnnouncementKind; text: string };

export type AnnouncementInput = {
  now: Date;
  /** 日本時間の「時」（0〜23） */
  jstHour: number;
  eveningEnabled: boolean;
  morningEnabled: boolean;
  /** 進行中の記録があるか（寝ているあいだは話さない） */
  sleeping: boolean;
  recommendation: { recommended_bedtime: string; reasoning: string | null; announced_at: string | null } | null;
  lastNight: { end_time: string | null; morning_announced_at: string | null; comment: string | null } | null;
};

/** いま話すべき内容。どれも「まだ話していない」ものだけ */
export function pickAnnouncements(input: AnnouncementInput): Announcement[] {
  const result: Announcement[] = [];
  if (input.sleeping) return result;

  const n = input.lastNight;
  if (
    input.morningEnabled &&
    n?.end_time &&
    n.comment &&
    !n.morning_announced_at &&
    input.now.getTime() - new Date(n.end_time).getTime() <= MORNING_WITHIN_MS
  ) {
    result.push({ kind: "morning_summary", text: n.comment });
  }

  const r = input.recommendation;
  if (
    input.eveningEnabled &&
    r?.reasoning &&
    !r.announced_at &&
    input.jstHour >= EVENING_FROM_HOUR &&
    input.now.getTime() < new Date(r.recommended_bedtime).getTime()
  ) {
    result.push({ kind: "evening_suggestion", text: r.reasoning });
  }
  return result;
}
