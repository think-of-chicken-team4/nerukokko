// Gemini の呼び出し（gemini.ts）と朝のコメントの指示（comment.ts の morningPrompt）のテスト。
// 本物の API は呼ばず、fetch を差し替える。実行：cd server && npm run test:functions
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { morningPrompt, toOneParagraph } from "../../supabase/functions/_shared/comment.ts";
import { extractText, generateText, isRetryable, parseModels } from "../../supabase/functions/_shared/gemini.ts";
import { computeSleepScore } from "../../supabase/functions/_shared/score.ts";

const ok = (text: string, finishReason = "STOP") =>
  new Response(JSON.stringify({ candidates: [{ finishReason, content: { parts: [{ text }] } }] }), { status: 200 });
const status = (code: number) => new Response(JSON.stringify({ error: { code } }), { status: code });

/** 呼ばれたモデルを記録しながら、順に応答を返す fetch */
function fakeFetch(responses: (Response | Error)[]) {
  const called: string[] = [];
  const impl = (async (url: string | URL | Request) => {
    called.push(String(url).split("/models/")[1].split(":")[0]);
    const next = responses.shift();
    if (!next) throw new Error("呼ばれすぎ");
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  return { impl, called };
}

const request = { system: "にわとり", prompt: "おはよう" };

describe("generateText", () => {
  it("1つ目のモデルで返事ができれば、それを返す", async () => {
    const f = fakeFetch([ok("おはようコケ！")]);
    const result = await generateText(request, { apiKey: "k", models: ["a", "b"], fetchImpl: f.impl });
    assert.deepEqual(result, { text: "おはようコケ！", model: "a" });
    assert.deepEqual(f.called, ["a"]);
  });

  it("混雑（503）・回数の上限（429）なら、次のモデルで試す", async () => {
    const f = fakeFetch([status(503), status(429), ok("おはようコケ！")]);
    const result = await generateText(request, { apiKey: "k", models: ["a", "b", "c"], fetchImpl: f.impl });
    assert.equal(result?.model, "c");
    assert.deepEqual(f.called, ["a", "b", "c"]);
  });

  it("キーが違う（401）なら、次のモデルを試さずに null（定型文にする）", async () => {
    const f = fakeFetch([status(401)]);
    assert.equal(await generateText(request, { apiKey: "k", models: ["a", "b"], fetchImpl: f.impl }), null);
    assert.deepEqual(f.called, ["a"]);
  });

  it("途中で切れた返事は使わず、次のモデルへ。全部だめなら null", async () => {
    const f = fakeFetch([ok("おはよう", "MAX_TOKENS"), new Error("timeout")]);
    assert.equal(await generateText(request, { apiKey: "k", models: ["a", "b"], fetchImpl: f.impl }), null);
    assert.deepEqual(f.called, ["a", "b"]);
  });

  it("キーがなければ、呼ばずに null", async () => {
    const f = fakeFetch([]);
    assert.equal(await generateText(request, { apiKey: "", models: ["a"], fetchImpl: f.impl }), null);
    assert.deepEqual(f.called, []);
  });
});

describe("gemini の小さな部品", () => {
  it("モデルの一覧は、カンマ区切りを読む。空なら既定", () => {
    assert.deepEqual(parseModels(" x, y ,,"), ["x", "y"]);
    assert.ok(parseModels(undefined).length > 0);
  });
  it("やり直す価値があるのは、404・429・5xx", () => {
    assert.deepEqual([400, 401, 403, 404, 429, 500, 503].map(isRetryable), [false, false, false, true, true, true, true]);
  });
  it("返事の取り出し：STOP 以外・空・形の違う応答は null", () => {
    assert.equal(extractText({ candidates: [{ finishReason: "SAFETY" }] }), null);
    assert.equal(extractText({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "  " }] } }] }), null);
    assert.equal(extractText({}), null);
  });
});

describe("morningPrompt", () => {
  const start = new Date("2026-10-15T14:00:00Z");
  const night = computeSleepScore({
    startTime: start,
    endTime: new Date(start.getTime() + 8 * 60 * 60 * 1000),
    motionTimes: Array.from({ length: 18 }, (_, i) => new Date(start.getTime() + (30 + i * 25) * 60_000)),
    audioEventCount: 2,
    breathsPerMin: [14, 14, 15, 14, 13],
    environment: [{ temperatureC: 24, humidityPct: 50 }],
    presence: [],
  });

  it("キャラクター設定と、記録の事実を渡す", () => {
    const { system, prompt } = morningPrompt(night, "テスト");
    assert.ok(system.includes("コケ"));
    assert.ok(prompt.includes(`睡眠スコア：${night.score}点`));
    assert.ok(prompt.includes("寝返り：18回"));
    assert.ok(prompt.includes("「テストさん、おはようコケ！」で始めて"));
  });

  it("計測がない夜・起床を検知できなかった夜は、そのことを渡す", () => {
    const empty = computeSleepScore({ ...{ startTime: start, endTime: start }, motionTimes: [], audioEventCount: 0, breathsPerMin: [], environment: [], presence: [] });
    const { prompt } = morningPrompt(empty, "", false);
    assert.ok(prompt.includes("スコアは出せなかった"));
    assert.ok(prompt.includes("3時間後で記録を締めた"));
    assert.ok(!prompt.includes("睡眠スコア："));
  });
});

describe("toOneParagraph", () => {
  it("空行・改行をつないで1段落にする", () => {
    assert.equal(toOneParagraph("おはようコケ！\n\n昨夜はよく眠れたコケ。\n  今日もがんばろうコケ。\n"), "おはようコケ！昨夜はよく眠れたコケ。今日もがんばろうコケ。");
  });
});
