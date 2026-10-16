// 音声合成（tts.ts）のテスト。本物の API は呼ばず、fetch を差し替える。実行：cd server && npm run test:functions
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseModels } from "../../supabase/functions/_shared/gemini.ts";
import { DEFAULT_TTS_MODELS, extractAudio, synthesizeSpeech, voiceFor } from "../../supabase/functions/_shared/tts.ts";

const audio = (data: string) =>
  new Response(JSON.stringify({ steps: [{ type: "model_output", content: [{ type: "audio", mime_type: "audio/wav", data }] }] }));

describe("synthesizeSpeech", () => {
  it("キャラボイスに合わせた声で頼み、WAV の base64 を返す", async () => {
    let body: { model: string; input: string; generation_config: { speech_config: { voice: string }[] } } | null = null;
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return audio("UklGR");
    }) as typeof fetch;
    const result = await synthesizeSpeech("  おはようコケ  ", "chick", { apiKey: "k", models: ["tts-a"], fetchImpl });
    assert.deepEqual(result, { mimeType: "audio/wav", base64: "UklGR", model: "tts-a" });
    assert.equal(body!.input, "おはようコケ");
    assert.equal(body!.generation_config.speech_config[0].voice, "Leda");
  });

  it("混雑なら次のモデル、全部だめなら null", async () => {
    const called: string[] = [];
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      called.push(JSON.parse(String(init?.body)).model);
      return new Response("{}", { status: 503 });
    }) as typeof fetch;
    assert.equal(await synthesizeSpeech("おはよう", "rooster", { apiKey: "k", models: ["a", "b"], fetchImpl }), null);
    assert.deepEqual(called, ["a", "b"]);
  });

  it("キーがない・文章が空なら、呼ばずに null", async () => {
    const fetchImpl = (async () => {
      throw new Error("呼ばれないはず");
    }) as typeof fetch;
    assert.equal(await synthesizeSpeech("おはよう", "rooster", { apiKey: "", fetchImpl }), null);
    assert.equal(await synthesizeSpeech("   ", "rooster", { apiKey: "k", fetchImpl }), null);
  });
});

describe("tts の小さな部品", () => {
  it("声：ひよこ以外はにわとり", () => {
    assert.equal(voiceFor("chick"), "Leda");
    assert.equal(voiceFor("rooster"), "Puck");
    assert.equal(voiceFor(null), "Puck");
  });
  it("音声の取り出し：audio/wav がなければ null", () => {
    assert.equal(extractAudio({ steps: [{ content: [{ type: "text", data: "x" }] }] }), null);
    assert.equal(extractAudio({}), null);
  });
  it("モデルの一覧が空なら、音声用の既定のモデル", () => {
    assert.deepEqual(parseModels("", DEFAULT_TTS_MODELS), DEFAULT_TTS_MODELS);
  });
});
