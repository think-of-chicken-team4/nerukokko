// 音声会話の決まり（voice.ts）のテスト。実行：cd server && npm run test:functions
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isWav, parseVoiceReply, toBase64 } from "../../supabase/functions/_shared/voice.ts";

function wavHeader(extra = 100): Uint8Array {
  const bytes = new Uint8Array(44 + extra);
  bytes.set([..."RIFF"].map((c) => c.charCodeAt(0)), 0);
  bytes.set([..."WAVE"].map((c) => c.charCodeAt(0)), 8);
  return bytes;
}

describe("isWav", () => {
  it("RIFF・WAVE で始まる録音だけを受け付ける", () => {
    assert.equal(isWav(wavHeader()), true);
    assert.equal(isWav(new TextEncoder().encode("ID3 mp3 のようなもの".padEnd(80, "x"))), false);
    assert.equal(isWav(wavHeader().subarray(0, 20)), false);
  });
});

describe("parseVoiceReply", () => {
  it("聞き取った文章と返事を取り出す", () => {
    assert.deepEqual(parseVoiceReply('{"user_text":" 最近寝付きが悪いんだ。 ","reply_text":"深呼吸してみるコケ。"}'), {
      userText: "最近寝付きが悪いんだ。",
      replyText: "深呼吸してみるコケ。",
    });
  });
  it("聞き取れなかった（空）・JSON でない・形が違うときは null", () => {
    assert.equal(parseVoiceReply('{"user_text":"","reply_text":""}'), null);
    assert.equal(parseVoiceReply("おはようコケ"), null);
    assert.equal(parseVoiceReply('{"text":"x"}'), null);
  });
});

describe("toBase64", () => {
  it("大きな録音でも、ふつうの base64 と同じになる", () => {
    const bytes = new Uint8Array(200_000).map((_, i) => i % 256);
    assert.equal(toBase64(bytes), Buffer.from(bytes).toString("base64"));
  });
});
