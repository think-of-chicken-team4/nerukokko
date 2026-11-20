// テキスト会話（chat、T-204）の決まりと、Gemini に渡す指示。docs/api-spec.md §4-3。
// DB に依存しない純粋な関数。

import { CHICKEN_PERSONA } from "./character.ts";
import type { GeminiTurn } from "./gemini.ts";
import { jstDateKey } from "./jst.ts";

export const CHAT_MAX_LENGTH = 500;
/** Gemini に渡す、この会話の直近の発言の数 */
export const CHAT_HISTORY_LIMIT = 10;
/** 1人が1時間に送れる発言の数（Gemini の無料枠を使い切らないため） */
export const CHAT_HOURLY_LIMIT = 30;

/** Gemini が使えないとき（キーがない・混雑・障害）の返事 */
export const CHAT_FALLBACK = "ごめんコケ、いまちょっと考えがまとまらないコケ…。少し時間をおいて、もう一度話しかけてほしいコケ。";
/** 1時間の上限を超えたときの返事 */
export const CHAT_LIMIT_REPLY = "たくさんお話ししてくれてうれしいコケ！でも少し休憩しようコケ。また少しあとで話しかけてほしいコケ。";

export function validateMessage(value: unknown): { message: string } | { error: string } {
  if (typeof value !== "string") return { error: "message を文字で送ってください" };
  const message = value.trim();
  if (message.length === 0) return { error: "メッセージが空です" };
  if (message.length > CHAT_MAX_LENGTH) return { error: `メッセージは${CHAT_MAX_LENGTH}文字までです` };
  return { message };
}

/** DB の発言（古い順）を Gemini の会話の形にする */
export function toHistory(messages: { role: string; content: string }[]): GeminiTurn[] {
  return messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", text: m.content }));
}

export type ChatContext = {
  displayName: string;
  /** 直近に完了した夜 */
  lastNight: { date: string; score: number | null; label: string | null; turns: number; snores: number } | null;
  /** いま記録中なら就寝時刻（日本時間の表示） */
  sleepingSince: string | null;
  /** 今夜の就寝提案（日本時間の表示） */
  tonight: { bedtime: string; reasoning: string | null } | null;
  /** 次に鳴るアラーム（日本時間の表示） */
  nextAlarm: string | null;
  /** 質問で指定された日のGoogleカレンダー。カレンダーの質問でないときはnull */
  calendar: {
    dateLabel: string;
    events: string[];
    suggestedWake: string | null;
    wakeReason: string | null;
    prepMinutes: number;
  } | null;
};

export type CalendarQueryDate = { dateKey: string; label: string };
export type CalendarWake = { wake: Date; isWakePlan: boolean };

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;
const DAY_MS = 24 * 60 * 60 * 1000;

function dateFromKey(dateKey: string): Date {
  // 日本時間の正午はUTCでも同じ日付なので、getUTC*で曜日と日付を安全に扱える。
  return new Date(`${dateKey}T12:00:00+09:00`);
}

function queryDate(date: Date): CalendarQueryDate {
  const dateKey = jstDateKey(date);
  const noon = dateFromKey(dateKey);
  return { dateKey, label: `${noon.getUTCMonth() + 1}/${noon.getUTCDate()}(${WEEKDAYS[noon.getUTCDay()]})` };
}

/** 「明後日」「日曜日」「11月15日」など、質問で指定された日本時間の日付を求める。 */
export function calendarQueryDate(message: string, now: Date): CalendarQueryDate | null {
  if (!/(カレンダー|予定|起き|起床)/.test(message)) return null;
  const today = dateFromKey(jstDateKey(now));
  const addDays = (days: number) => queryDate(new Date(today.getTime() + days * DAY_MS));

  const explicit = message.match(/(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日|(?:(\d{4})[/-])?(\d{1,2})[/-](\d{1,2})/);
  if (explicit) {
    const year = Number(explicit[1] ?? explicit[4] ?? today.getUTCFullYear());
    const month = Number(explicit[2] ?? explicit[5]);
    const day = Number(explicit[3] ?? explicit[6]);
    const candidate = new Date(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T12:00:00+09:00`);
    if (!Number.isNaN(candidate.getTime()) && candidate.getUTCMonth() + 1 === month && candidate.getUTCDate() === day) {
      return queryDate(candidate);
    }
  }
  if (message.includes("明後日")) return addDays(2);
  if (message.includes("明日")) return addDays(1);
  if (message.includes("今日")) return addDays(0);

  const weekday = message.match(/([日月火水木金土])曜(?:日)?/);
  if (weekday) {
    const target = WEEKDAYS.indexOf(weekday[1] as (typeof WEEKDAYS)[number]);
    const days = (target - today.getUTCDay() + 7) % 7;
    return addDays(days);
  }
  // 日付を指定しないカレンダー質問は、従来どおり明日を見る。
  return addDays(1);
}

/** 最初の予定から起床時刻を決める。「起床」の予定なら開始時刻、それ以外は準備時間だけ前にする。 */
export function calendarWakeTime(title: string, start: Date, prepMinutes: number): CalendarWake {
  const isWakePlan = /(起床|起きる|起きて|起き、|起き$)/.test(title);
  return { wake: new Date(start.getTime() - (isWakePlan ? 0 : prepMinutes) * 60_000), isWakePlan };
}

/** Geminiが使えない場合でも、カレンダー・起床時刻の質問には取得済みの事実から答える。 */
export function contextualChatFallback(message: string, context: ChatContext): string {
  const asksSchedule = /(カレンダー|予定|起き|起床)/.test(message);
  if (asksSchedule && context.calendar) {
    const calendar = context.calendar;
    if (calendar.events.length === 0) return `${calendar.dateLabel}には、Googleカレンダーの予定は見つからなかったコケ。`;
    const schedule = calendar.events.join("、");
    const wake = calendar.suggestedWake
      ? `${calendar.wakeReason ?? `朝の準備時間を${calendar.prepMinutes}分として`}、${calendar.suggestedWake}に起きるのがおすすめコケ。`
      : "時刻が決まった予定がないため、起きる時刻はいつもの生活に合わせて決めてほしいコケ。";
    return `${calendar.dateLabel}の予定は、${schedule}コケ。${wake}`;
  }
  return CHAT_FALLBACK;
}

/** キャラクター設定に、この人の睡眠の情報を足す（会話の中で使ってよい事実として渡す） */
export function chatSystem(context: ChatContext): string {
  const facts: string[] = [];
  if (context.displayName) facts.push(`話し相手の呼び名：${context.displayName}さん`);
  if (context.sleepingSince) facts.push(`いま睡眠を記録中（${context.sleepingSince} に寝始めた）`);
  if (context.lastNight) {
    const n = context.lastNight;
    facts.push(
      n.score === null
        ? `直近の夜（${n.date}）：計測のデータが届かず、スコアなし`
        : `直近の夜（${n.date}）：スコア ${n.score}点（${n.label}）、寝返り ${n.turns}回、いびき ${n.snores}回`,
    );
  } else {
    facts.push("睡眠の記録はまだない");
  }
  if (context.tonight) {
    facts.push(`今夜のおすすめの就寝時刻：${context.tonight.bedtime}${context.tonight.reasoning ? `（${context.tonight.reasoning}）` : ""}`);
  }
  facts.push(context.nextAlarm ? `次のアラーム：${context.nextAlarm}` : "アラームは未設定");

  return [
    CHICKEN_PERSONA,
    "これはアプリでの文字の会話です。睡眠や生活のことを中心に、相手の話にやさしく答えてください。",
    "睡眠の記録について聞かれたら、次の情報だけを使って答えてください。",
    ...facts.map((f) => `- ${f}`),
  ].join("\n");
}
