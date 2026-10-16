// にわとりのコメント（朝の振り返り）。
// Gemini 連携（dev-plan T-203・T-204）ができるまでの定型文で、Gemini が使えないときの予備としても使う。
// DB に依存しない純粋な関数。

import { CHICKEN_PERSONA } from "./character.ts";
import type { ScoreResult } from "./score.ts";

/**
 * wakeDetected = false は、巣に戻したことを検知できず、起床予定の3時間後で記録を締めたとき（T-209）。
 */
export function morningComment(result: ScoreResult, displayName: string, wakeDetected = true): string {
  const { score, label, details } = result;
  const name = displayName ? `${displayName}さん、` : "";
  const notice = wakeDetected
    ? ""
    : "たまごが巣に戻ったのがわからなかったから、起床予定の3時間後までで記録を締めたコケ。朝はたまごを巣に戻してほしいコケ。";

  // 計測がなかった夜（Q11）：スコアの代わりに、機器を確かめてもらう
  if (score === null) {
    return `${name}おはようコケ！昨夜は計測のデータが届かなかったから、スコアは出せなかったコケ。${notice}にわとりの電源と Wi-Fi、たまごの充電を確かめてほしいコケ。`;
  }
  const greeting = `${name}おはようコケ！昨夜のスコアは${score}点、「${label}」だったコケ。`;

  const turns = details.turn_balance?.count ?? 0;
  const latency = details.efficiency?.onset_latency_min ?? 0;
  const audio = details.quietness;
  const env = details.environment;

  let advice: string;
  if (latency >= 30) {
    advice = `寝つくまで${latency}分くらいかかったみたいコケ。寝る前のスマホは早めにおしまいにしようコケ。`;
  } else if (turns >= 25) {
    advice = `寝返りが${turns}回もあったコケ…ちょっと寝苦しかったかもコケ。室温を見直してみるコケ？`;
  } else if (audio.per_hour >= 1) {
    advice = `いびきや寝言が${audio.count}回あったコケ。疲れがたまってるのかもコケ、今夜は早めに休もうコケ。`;
  } else if (env && env.in_range_ratio < 0.5) {
    advice = "お部屋の温度や湿度が快適な範囲から外れていた時間が長かったコケ。エアコンや加湿器を使ってみるコケ？";
  } else if (score >= 85) {
    advice = "とってもよく眠れてたコケ！今日も元気にいこうコケ👍";
  } else {
    advice = "今夜は少し早めにお布団に入って、ゆっくり休もうコケ。";
  }
  return `${greeting}${notice}${advice}`;
}

/**
 * 朝のコメントを Gemini に作ってもらうための指示（T-203）。失敗したら morningComment（定型文）を使う。
 * スコアの内訳から、事実だけを箇条書きで渡す（数字を作らせないため）。
 */
export function morningPrompt(
  result: ScoreResult,
  displayName: string,
  wakeDetected = true,
): { system: string; prompt: string } {
  const { score, label, details } = result;
  const facts: string[] = [];
  if (score === null) {
    facts.push("昨夜は計測のデータが届かず、スコアは出せなかった（にわとりの電源・Wi-Fi、たまごの充電を確かめてほしい）");
  } else {
    facts.push(`睡眠スコア：${score}点（${label}）`);
  }
  if (details.efficiency) {
    const e = details.efficiency;
    facts.push(`眠っていた時間：約${Math.round(e.total_sleep_min / 6) / 10}時間（布団にいた時間 約${Math.round(e.time_in_bed_min / 6) / 10}時間）`);
    facts.push(`寝つくまで：約${e.onset_latency_min}分`);
    if (e.out_of_bed_min > 0) facts.push(`夜中に布団を出ていた時間：約${e.out_of_bed_min}分`);
  }
  if (details.turn_balance) facts.push(`寝返り：${details.turn_balance.count}回（目安は15回くらい）`);
  if (score !== null) facts.push(`いびき・寝言：${details.quietness.count}回`);
  if (details.breathing) facts.push(`呼吸の安定度：${details.breathing.score}点`);
  if (details.environment) {
    facts.push(`部屋の温度・湿度がちょうどよかった時間の割合：${Math.round(details.environment.in_range_ratio * 100)}%`);
  }
  if (!wakeDetected) {
    facts.push("たまごが巣に戻ったのがわからなかったので、起床予定の3時間後で記録を締めた（朝はたまごを巣に戻してほしい）");
  }

  const prompt = [
    `${displayName ? `${displayName}さん` : "ユーザー"}が起きました。昨夜の睡眠の記録は次のとおりです。`,
    ...facts.map((f) => `- ${f}`),
    "",
    `「${displayName ? `${displayName}さん、` : ""}おはようコケ！」で始めて、記録の中からいちばん大事なことを1つ伝え、今日か今夜にできる小さな工夫を1つすすめてください。`,
  ].join("\n");
  return { system: CHICKEN_PERSONA, prompt };
}

/** Gemini の返事を、吹き出しに出しやすい1段落にする（改行・空行をつなぐ。日本語なので空白は入れない） */
export function toOneParagraph(text: string): string {
  return text
    .split(/\s*\n+\s*/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("");
}
