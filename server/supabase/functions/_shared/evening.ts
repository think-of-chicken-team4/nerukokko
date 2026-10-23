// 夕方の就寝提案（evening-suggestion、T-206）の計算と、Gemini に渡す指示。DB に依存しない純粋な関数。
// 計算方法は docs/dev-plan.md 決定ログ 2026-10-16・2026-10-17、docs/spec-changes.md A-23・A-27。

import { CHICKEN_PERSONA } from "./character.ts";
import type { FirstEvent } from "./google-calendar.ts";
import { formatJst, jstDateKey } from "./jst.ts";

/** 眠りたい時間（分）。90分の睡眠の周期 × 5 */
export const REQUIRED_SLEEP_MIN = 450;
/** 寝つくまでの時間の初期値（分）。記録がない人に使う */
export const DEFAULT_ONSET_MIN = 15;
/** 寝つくまでの時間として見込む下限・上限（分）。記録が0分でも少しは見込み、寝つけなかった夜に引っ張られすぎないように */
export const MIN_ONSET_MIN = 10;
export const MAX_ONSET_MIN = 60;
/** 明日の最初の予定の何分前に起きるか（身支度・朝ごはん・移動） */
export const PREP_BEFORE_EVENT_MIN = 90;
/** この時間より先のアラームは「明日の朝」とみなさない */
const LOOKAHEAD_MS = 24 * 60 * 60 * 1000;

export type EveningPlan = {
  /** 起きる日（日本時間）。sleep_recommendations.target_date */
  targetDate: string;
  wake: Date;
  /** 起きる時刻を何で決めたか（アラーム／カレンダーの予定） */
  wakeSource: "alarm" | "event";
  bedtime: Date;
  requiredSleepMin: number;
  onsetMin: number;
  /** 次のアラーム（24時間以内）。なければ null */
  alarm: Date | null;
  /** 明日の最初の予定（カレンダー連携しているとき） */
  event: FirstEvent | null;
  /** 予定に間に合うには、アラームより早く起きる必要がある（アラームは自動では変えず、早めるようすすめる） */
  alarmTooLate: boolean;
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
 * 起きる時刻は、次のアラーム（24時間以内）と「明日の最初の予定 − 90分」の早いほう。
 * どちらもなければ提案しない（null）。
 */
export function planEvening(
  now: Date,
  nextAlarm: Date | null,
  onsetLatencies: number[],
  firstEvent: FirstEvent | null = null,
): EveningPlan | null {
  const alarm = nextAlarm && nextAlarm.getTime() > now.getTime() && nextAlarm.getTime() - now.getTime() <= LOOKAHEAD_MS
    ? nextAlarm
    : null;
  const eventWake = firstEvent ? new Date(firstEvent.start.getTime() - PREP_BEFORE_EVENT_MIN * 60_000) : null;
  const event = eventWake && eventWake.getTime() > now.getTime() && eventWake.getTime() - now.getTime() <= LOOKAHEAD_MS
    ? firstEvent
    : null;
  if (!alarm && !event) return null;

  const useEvent = !!event && (!alarm || eventWake!.getTime() < alarm.getTime());
  const wake = useEvent ? eventWake! : alarm!;
  const onsetMin = expectedOnsetMinutes(onsetLatencies);
  return {
    targetDate: jstDateKey(alarm ?? event!.start),
    wake,
    wakeSource: useEvent ? "event" : "alarm",
    bedtime: new Date(wake.getTime() - (REQUIRED_SLEEP_MIN + onsetMin) * 60_000),
    requiredSleepMin: REQUIRED_SLEEP_MIN,
    onsetMin,
    alarm,
    event,
    alarmTooLate: useEvent && !!alarm,
  };
}

/** 時刻だけ（例：23:00） */
function hm(value: Date): string {
  return formatJst(value).split(" ").pop() ?? "";
}

/** Gemini が使えないときの理由文 */
export function eveningTemplate(plan: EveningPlan): string {
  if (plan.wakeSource === "alarm") {
    return `明日は${hm(plan.wake)}に起きるから、7時間半眠れるように${hm(plan.bedtime)}までに寝るのがおすすめコケ。`;
  }
  const first = `明日は${hm(plan.event!.start)}から予定があるから、${hm(plan.wake)}に起きられるように${hm(plan.bedtime)}までに寝るのがおすすめコケ。`;
  return plan.alarmTooLate ? `${first}アラーム（${hm(plan.alarm!)}）を${hm(plan.wake)}に早めておくと安心コケ。` : first;
}

/**
 * 理由文を Gemini に作ってもらう指示。事実だけを渡す。
 * 予定の名前は送らない（無料枠では送った内容が Google の改善に使われるため。時刻だけを渡す）
 */
export function eveningPrompt(plan: EveningPlan, displayName: string): { system: string; prompt: string } {
  const facts = [
    ...(plan.event ? [`明日の最初の予定の開始：${hm(plan.event.start)}（準備に${PREP_BEFORE_EVENT_MIN}分見込む）`] : []),
    ...(plan.alarm ? [`明日のアラーム：${hm(plan.alarm)}`] : []),
    `明日の起床予定：${hm(plan.wake)}`,
    `眠りたい時間：7時間半（90分の睡眠のリズム5回ぶん）`,
    `ふだん寝つくまでにかかる時間：約${plan.onsetMin}分`,
    `おすすめの就寝時刻：${hm(plan.bedtime)}`,
    ...(plan.alarmTooLate ? [`アラームのままだと予定に間に合わないので、アラームを${hm(plan.wake)}に早めるようすすめる`] : []),
  ];
  const prompt = [
    `${displayName ? `${displayName}さん` : "ユーザー"}に、今夜の就寝時刻をすすめます。次の情報をもとに、なぜその時刻なのかを${plan.alarmTooLate ? "2〜3" : "1〜2"}文で、にわとりの口調で伝えてください。`,
    ...facts.map((f) => `- ${f}`),
    "時刻は情報のとおりに書き、ほかの数字は作らないでください。あいさつは不要です。",
  ].join("\n");
  return { system: CHICKEN_PERSONA, prompt };
}
