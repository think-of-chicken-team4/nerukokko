// 睡眠スコアの計算（supabase/functions/_shared/score.ts）のテスト
//   実行：cd server && npm run test:functions
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  computeSleepScore,
  findSleepOnset,
  outOfBedMinutes,
  scoreLabel,
  type ScoreInput,
} from "../../supabase/functions/_shared/score.ts";

const START = new Date("2026-10-01T14:00:00Z"); // 23:00 JST
const at = (minutes: number) => new Date(START.getTime() + minutes * 60_000);

function night(overrides: Partial<ScoreInput> = {}): ScoreInput {
  return {
    startTime: START,
    endTime: at(8 * 60), // 8時間
    motionTimes: Array.from({ length: 15 }, (_, i) => at(30 + i * 28)), // 15回、ばらけた寝返り
    audioEventCount: 0,
    breathsPerMin: [14, 14, 15, 14, 13, 14, 15, 14],
    environment: Array.from({ length: 10 }, () => ({ temperatureC: 24, humidityPct: 50 })),
    presence: [],
    ...overrides,
  };
}

describe("findSleepOnset", () => {
  it("開始直後から15分寝返りがなければ、開始時刻が入眠", () => {
    assert.deepEqual(findSleepOnset(START, at(480), [at(20)]), START);
  });

  it("寝返りが続いたあと、15分静かになった最初の寝返りの時刻が入眠", () => {
    const motions = [at(5), at(10), at(18), at(40)];
    assert.deepEqual(findSleepOnset(START, at(480), motions), at(18));
  });

  it("15分静かな区間がなければ、終了時刻（眠れなかった）", () => {
    const motions = Array.from({ length: 10 }, (_, i) => at(i * 5));
    assert.deepEqual(findSleepOnset(START, at(50), motions), at(50));
  });
});

describe("outOfBedMinutes", () => {
  it("入眠後に離床していた時間を数える", () => {
    const presence = [
      { time: at(100), state: "out_of_bed" as const },
      { time: at(110), state: "in_bed" as const },
    ];
    assert.equal(outOfBedMinutes(at(10), at(480), presence), 10);
  });

  it("入眠前の離床は数えない。戻らなければ終了まで数える", () => {
    const presence = [
      { time: at(0), state: "out_of_bed" as const },
      { time: at(5), state: "in_bed" as const },
      { time: at(470), state: "out_of_bed" as const },
    ];
    assert.equal(outOfBedMinutes(at(10), at(480), presence), 10);
  });
});

describe("computeSleepScore", () => {
  it("理想的な一晩はほぼ満点で「ぐっすり」", () => {
    const result = computeSleepScore(night());
    assert.ok(result.score >= 95, `score=${result.score}`);
    assert.equal(result.label, "ぐっすり眠れました");
    assert.equal(result.details.turn_balance?.count, 15);
    assert.equal(result.details.efficiency?.time_in_bed_min, 480);
    assert.equal(result.details.environment?.in_range_ratio, 1);
  });

  it("寝返り・在床の記録がなければ、睡眠効率と寝返りを除いて重みを割り直す", () => {
    const result = computeSleepScore(night({ motionTimes: [] }));
    assert.equal(result.details.efficiency, null);
    assert.equal(result.details.turn_balance, null);
    assert.deepEqual(Object.keys(result.details.weights_used).sort(), ["breathing", "environment", "quietness"]);
    assert.ok(result.score >= 95);
  });

  it("呼吸の計測が少なければ呼吸安定性を除く", () => {
    const result = computeSleepScore(night({ breathsPerMin: [14, 15] }));
    assert.equal(result.details.breathing, null);
  });

  it("いびきが多いと静音度が下がる（8時間で16回＝2回/時 → 80点）", () => {
    const result = computeSleepScore(night({ audioEventCount: 16 }));
    assert.equal(result.details.quietness.per_hour, 2);
    assert.equal(result.details.quietness.score, 80);
  });

  it("寝返りが目安から離れると減点（35回 → 60点）", () => {
    const motions = Array.from({ length: 35 }, (_, i) => at(60 + i * 12));
    const result = computeSleepScore(night({ motionTimes: motions }));
    assert.equal(result.details.turn_balance?.score, 60);
  });

  it("室温・湿度が推奨範囲外の割合だけ環境適合度が下がる", () => {
    const environment = [
      { temperatureC: 24, humidityPct: 50 },
      { temperatureC: 31, humidityPct: 50 },
      { temperatureC: 24, humidityPct: 70 },
      { temperatureC: null, humidityPct: 50 },
    ];
    const result = computeSleepScore(night({ environment }));
    assert.equal(result.details.environment?.readings, 3);
    assert.equal(result.details.environment?.score, 33);
  });

  it("寝つきが悪く途中で起きると睡眠効率が下がる", () => {
    const motions = [...Array.from({ length: 12 }, (_, i) => at(i * 5)), at(200), at(300)];
    const presence = [
      { time: at(120), state: "out_of_bed" as const },
      { time: at(180), state: "in_bed" as const },
    ];
    const result = computeSleepScore(night({ motionTimes: motions, presence }));
    const efficiency = result.details.efficiency!;
    assert.equal(efficiency.onset_latency_min, 55);
    assert.equal(efficiency.out_of_bed_min, 60);
    assert.equal(efficiency.total_sleep_min, 480 - 55 - 60);
  });

  it("スコアは0〜100の整数", () => {
    const result = computeSleepScore(
      night({ audioEventCount: 500, environment: [{ temperatureC: 35, humidityPct: 90 }], breathsPerMin: [5, 30, 5, 30, 5] }),
    );
    assert.ok(Number.isInteger(result.score) && result.score >= 0 && result.score <= 100);
  });
});

describe("scoreLabel", () => {
  it("85点以上・65点以上・それ未満でラベルが変わる", () => {
    assert.equal(scoreLabel(85), "ぐっすり眠れました");
    assert.equal(scoreLabel(84), "まずまずの睡眠でした");
    assert.equal(scoreLabel(65), "まずまずの睡眠でした");
    assert.equal(scoreLabel(64), "やや浅い睡眠でした");
  });
});
