// テキスト会話（chat、T-204）の決まりと、Gemini に渡す指示。docs/api-spec.md §4-3。
// DB に依存しない純粋な関数。

import { CHICKEN_PERSONA } from "./character.ts";
import type { GeminiTurn } from "./gemini.ts";

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
};

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
