// アラームの曜日・時刻の扱い。DB の alarms.repeat_days は 0=日〜6=土、alarms.time は日本時間の "HH:MM:SS"

export const DAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"] as const;

/** 画面に並べる順（月曜はじまり） */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const WEEKDAYS = [1, 2, 3, 4, 5];
const WEEKEND = [0, 6];

export const MAX_ALARMS = 10;

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function sameDays(a: readonly number[], b: readonly number[]) {
  return a.length === b.length && b.every((d) => a.includes(d));
}

/** 例：毎日／平日／土日／月・水・金 */
export function formatRepeatDays(days: readonly number[]): string {
  if (sameDays(days, ALL_DAYS)) return "毎日";
  if (sameDays(days, WEEKDAYS)) return "平日";
  if (sameDays(days, WEEKEND)) return "土日";
  return WEEK_ORDER.filter((d) => days.includes(d))
    .map((d) => DAY_LABELS[d])
    .join("・");
}

/** "07:30:00" → "07:30" */
export function formatAlarmTime(time: string): string {
  return time.slice(0, 5);
}

export type AlarmInput = { time: string; days: number[] };

/** 入力を確かめて、DB に入れられる形にする。おかしければエラーの文言を返す */
export function validateAlarm(input: AlarmInput): { value: AlarmInput } | { error: string } {
  if (!TIME_PATTERN.test(input.time)) return { error: "時刻を選んでください" };
  const days = [...new Set(input.days)].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort((a, b) => a - b);
  if (days.length === 0) return { error: "鳴らす曜日を1つ以上選んでください" };
  return { value: { time: input.time, days } };
}
