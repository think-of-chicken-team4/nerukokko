// 日本時間（Asia/Tokyo）での表示。DB は UTC（timestamptz）なので、AI に渡す文章を作るときに使う。純粋な関数。

const dateTime = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  month: "numeric",
  day: "numeric",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const dateKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" });

/** 例：10/16(金) 23:00 */
export function formatJst(value: string | Date): string {
  return dateTime.format(new Date(value));
}

/** 例：2026-10-16（DB の date 型と比べるとき） */
export function jstDateKey(value: string | Date): string {
  return dateKey.format(new Date(value));
}
