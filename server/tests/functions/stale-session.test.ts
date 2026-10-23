// 巣に戻らないまま残った記録の扱い（stale-session.ts）と、そのときの朝のコメント（comment.ts）のテスト
//   実行：cd server && npm run test:functions
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { morningComment } from "../../supabase/functions/_shared/comment.ts";
import { computeSleepScore } from "../../supabase/functions/_shared/score.ts";
import { STALE_AFTER_MS, staleCutoff, staleEndTime } from "../../supabase/functions/_shared/stale-session.ts";

describe("staleCutoff / staleEndTime", () => {
  it("起床予定から3時間", () => {
    assert.equal(STALE_AFTER_MS, 3 * 60 * 60 * 1000);
  });

  it("今から3時間前より前に起床予定だった記録が対象になる", () => {
    const now = new Date("2026-10-16T02:00:00Z");
    assert.equal(staleCutoff(now).toISOString(), "2026-10-15T23:00:00.000Z");
  });

  it("終わりは起床予定の3時間後", () => {
    assert.equal(staleEndTime(new Date("2026-10-15T22:15:00Z")).toISOString(), "2026-10-16T01:15:00.000Z");
  });
});

describe("morningComment（起床を検知できなかったとき）", () => {
  const start = new Date("2026-10-15T14:00:00Z");
  const result = computeSleepScore({
    startTime: start,
    endTime: new Date(start.getTime() + 8 * 60 * 60 * 1000),
    motionTimes: Array.from({ length: 12 }, (_, i) => new Date(start.getTime() + (30 + i * 35) * 60_000)),
    audioEventCount: 0,
    breathsPerMin: [14, 14, 15],
    environment: [{ temperatureC: 24, humidityPct: 50 }],
    presence: [],
  });

  it("ふだんは締めたことに触れない", () => {
    assert.ok(!morningComment(result, "テスト").includes("3時間後"));
  });

  it("検知できなかったら、自動で締めたことと、巣に戻してほしいことを伝える", () => {
    const comment = morningComment(result, "テスト", false);
    assert.ok(comment.startsWith("テストさん、おはようコケ！"));
    assert.ok(comment.includes("起床予定の3時間後までで記録を締めた"));
    assert.ok(comment.includes("巣に戻してほしい"));
  });
});

describe("morningComment（計測がなかった夜）", () => {
  const start = new Date("2026-10-15T14:00:00Z");
  const empty = computeSleepScore({
    startTime: start,
    endTime: new Date(start.getTime() + 8 * 60 * 60 * 1000),
    motionTimes: [],
    audioEventCount: 0,
    breathsPerMin: [],
    environment: [],
    presence: [],
  });

  it("スコアの代わりに、機器を確かめてほしいと伝える", () => {
    const comment = morningComment(empty, "テスト");
    assert.ok(comment.startsWith("テストさん、おはようコケ！"));
    assert.ok(comment.includes("スコアは出せなかった"));
    assert.ok(!comment.includes("null"));
  });

  it("起床も検知できなかったら、両方を伝える", () => {
    const comment = morningComment(empty, "", false);
    assert.ok(comment.includes("スコアは出せなかった") && comment.includes("3時間後"));
  });
});
