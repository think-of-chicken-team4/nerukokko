// 夕方の就寝提案（evening-suggestion、T-206）の計算と、Gemini に渡す指示。DB に依存しない純粋な関数。
// 計算方法は docs/dev-plan.md 決定ログ 2026-10-16・docs/spec-changes.md A-23。

import { CHICKEN_PERSONA } from "./character.ts";
import { formatJst, jstDateKey } from "./jst.ts";

/** 眠りたい時間（分）。90分の睡眠の周期 × 5 */
export const REQUIRED_SLEEP_MIN = 450;
/** 寝つくまでの時間の初期値（分）。記録がない人に使う */
export const DEFAULT_ONSET_MIN = 15;
/** 寝つくまでの時間として見込む下限・上限（分）。記録が0分でも少しは見込み、寝つけなかった夜に引っ張られすぎないように */
export const MIN_ONSET_MIN = 10;
export const MAX_ONSET_MIN = 60;
/** この時間より先のアラームは「明日の朝」とみなさない */
const LOOKAHEAD_MS = 24 * 60 * 60 * 1000;

export type EveningPlan = {
  /** 起きる日（日本時間）。sleep_recommendations.target_date */
  targetDate: string;
  wake: Date;
  bedtime: Date;
  requiredSleepMin: number;
  onsetMin: number;
};

/** 直近の夜の「寝つくまでの時間」の平均（分）。記録がなければ初期値 */
export function expectedOnsetMinutes(latencies: number[]): number {
  const valid = latencies.filter((m) => Number.isFinite(m) && m >= 0);
  if (valid.length === 0) return DEFAULT_ONSET_MIN;
  const avg = valid.reduce((a, b) => a + b, 0) / valid.length;
  return Math.min(MAX_ONSET_MIN, Math.max(MIN_ONSET_MIN, Math.round(avg)));
}

/**
 * 推奨就寝時刻 = 起きる時刻 − 眠りたい時間 − 寝つくまでの時間。
 * 起きる時刻は次のアラーム（24時間以内）。なければ提案しない（null）。
 */
export function planEvening(now: Date, nextAlarm: Date | null, onsetLatencies: number[]): EveningPlan | null {
  if (!nextAlarm || nextAlarm.getTime() <= now.getTime() || nextAlarm.getTime() - now.getTime() > LOOKAHEAD_MS) {
    return null;
  }
  const onsetMin = expectedOnsetMinutes(onsetLatencies);
  return {
    targetDate: jstDateKey(nextAlarm),
    wake: nextAlarm,
    bedtime: new Date(nextAlarm.getTime() - (REQUIRED_SLEEP_MIN + onsetMin) * 60_000),
    requiredSleepMin: REQUIRED_SLEEP_MIN,
    onsetMin,
  };
}

/** 時刻だけ（例：23:00） */
function hm(value: Date): string {
  return formatJst(value).split(" ").pop() ?? "";
}

/** Gemini が使えないときの理由文 */
export function eveningTemplate(plan: EveningPlan): string {
  return `明日は${hm(plan.wake)}に起きるから、7時間半眠れるように${hm(plan.bedtime)}までに寝るのがおすすめコケ。`;
}

/** 理由文を Gemini に作ってもらう指示。事実だけを渡す */
export function eveningPrompt(plan: EveningPlan, displayName: string): { system: string; prompt: string } {
  const facts = [
    `明日の起床予定：${hm(plan.wake)}`,
    `眠りたい時間：7時間半（90分の睡眠のリズム5回ぶん）`,
    `ふだん寝つくまでにかかる時間：約${plan.onsetMin}分`,
    `おすすめの就寝時刻：${hm(plan.bedtime)}`,
  ];
  const prompt = [
    `${displayName ? `${displayName}さん` : "ユーザー"}に、今夜の就寝時刻をすすめます。次の情報をもとに、なぜその時刻なのかを1〜2文で、にわとりの口調で伝えてください。`,
    ...facts.map((f) => `- ${f}`),
    "時刻は情報のとおりに書き、ほかの数字は作らないでください。あいさつは不要です。",
  ].join("\n");
  return { system: CHICKEN_PERSONA, prompt };
}
