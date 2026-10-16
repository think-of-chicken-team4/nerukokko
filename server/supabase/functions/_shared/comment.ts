// にわとりのコメント（朝の振り返り）。
// Gemini 連携（dev-plan T-203・T-204）ができるまでの定型文で、Gemini が使えないときの予備としても使う。
// DB に依存しない純粋な関数。

import type { ScoreResult } from "./score.ts";

export function morningComment(result: ScoreResult, displayName: string): string {
  const { score, label, details } = result;
  const greeting = `${displayName ? `${displayName}さん、` : ""}おはようコケ！昨夜のスコアは${score}点、「${label}」だったコケ。`;

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
  return `${greeting}${advice}`;
}
