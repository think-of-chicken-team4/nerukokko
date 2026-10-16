// 夕方の就寝提案の計算（evening.ts）のテスト。実行：cd server && npm run test:functions
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_ONSET_MIN,
  eveningPrompt,
  eveningTemplate,
  expectedOnsetMinutes,
  MAX_ONSET_MIN,
  planEvening,
} from "../../supabase/functions/_shared/evening.ts";

const NOW = new Date("2026-10-16T10:00:00Z"); // 19:00 JST
const ALARM = new Date("2026-10-16T22:15:00Z"); // 翌 07:15 JST

describe("expectedOnsetMinutes", () => {
  it("記録がなければ15分", () => assert.equal(expectedOnsetMinutes([]), DEFAULT_ONSET_MIN));
  it("直近の平均（四捨五入）", () => assert.equal(expectedOnsetMinutes([10, 20, 31]), 20));
  it("寝つけなかった夜に引っ張られすぎないよう60分まで", () => assert.equal(expectedOnsetMinutes([200, 100]), MAX_ONSET_MIN));
  it("おかしな値は除く", () => assert.equal(expectedOnsetMinutes([Number.NaN, -5, 30]), 30));
  it("記録が0分でも10分は見込む", () => assert.equal(expectedOnsetMinutes([0, 0]), 10));
});

describe("planEvening", () => {
  it("起床 − 7時間半 − 寝つくまでの時間", () => {
    const plan = planEvening(NOW, ALARM, [])!;
    assert.equal(plan.targetDate, "2026-10-17");
    assert.equal(plan.bedtime.toISOString(), "2026-10-16T14:30:00.000Z"); // 23:30 − 15分 = 23:30 JST → 07:15 − 7:45
    assert.equal(plan.requiredSleepMin, 450);
  });
  it("寝つくまでの時間が長い人は、そのぶん早めに", () => {
    assert.equal(planEvening(NOW, ALARM, [40, 40])!.bedtime.toISOString(), "2026-10-16T14:05:00.000Z");
  });
  it("アラームがない・過ぎている・24時間より先なら提案しない", () => {
    assert.equal(planEvening(NOW, null, []), null);
    assert.equal(planEvening(NOW, new Date("2026-10-16T09:00:00Z"), []), null);
    assert.equal(planEvening(NOW, new Date("2026-10-18T10:00:00Z"), []), null);
  });
});

describe("理由文", () => {
  const plan = planEvening(NOW, ALARM, [])!;
  it("定型文は起床と就寝の時刻を入れる", () => {
    assert.equal(eveningTemplate(plan), "明日は07:15に起きるから、7時間半眠れるように23:30までに寝るのがおすすめコケ。");
  });
  it("Gemini への指示に事実を渡す", () => {
    const { system, prompt } = eveningPrompt(plan, "テスト");
    assert.ok(system.includes("コケ"));
    assert.ok(prompt.includes("おすすめの就寝時刻：23:30") && prompt.includes("テストさん"));
  });
});
