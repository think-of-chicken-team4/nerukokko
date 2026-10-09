// 日時の表示はすべて日本時間（Asia/Tokyo）。DB には UTC（timestamptz）で入っている。

const TIME_ZONE = "Asia/Tokyo";

const timeFormatter = new Intl.DateTimeFormat("ja-JP", {
  timeZone: TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const dateTimeFormatter = new Intl.DateTimeFormat("ja-JP", {
  timeZone: TIME_ZONE,
  month: "numeric",
  day: "numeric",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const hourFormatter = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, hour: "numeric", hourCycle: "h23" });

/** 例：07:30 */
export function formatTime(value: string | Date): string {
  return timeFormatter.format(new Date(value));
}

/** 例：10/2(金) 07:30 */
export function formatDateTime(value: string | Date): string {
  return dateTimeFormatter.format(new Date(value));
}

/** 日本時間の「時」（0〜23） */
export function jstHour(value: Date): number {
  return Number(hourFormatter.format(value));
}
