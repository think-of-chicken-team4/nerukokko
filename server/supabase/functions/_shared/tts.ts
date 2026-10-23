// Gemini の音声合成（TTS）。にわとりが話す声を作る（決定ログ 2026-10-16、Q5・Q9）。
//
// - Interactions API（/v1beta/interactions）に文章を送ると、WAV（24kHz・モノラル・16bit）が base64 で返る。
//   これは docs/api-spec.md §3-3（voice-chat）・§3-4（speak）で鶏に返す形式と同じなので、そのまま渡せる。
// - モデルは GEMINI_TTS_MODELS（カンマ区切り。既定 gemini-3.8-flash-tts → gemini-3.8-flash-lite-tts）を上から試す。
//   全部だめなら null → 鶏は保存してある定型の音声を流す。
// - 声はキャラボイスの設定（notification_settings.character_voice）で選ぶ。
// Node のテストからも、fetch を差し替えて呼べる。

import { isRetryable, parseModels } from "./gemini.ts";

const INTERACTIONS_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";

export const DEFAULT_TTS_MODELS = ["gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts"];

/** キャラボイスと Gemini の声の対応（2026-10-16 にサンプルを作って選んだ。音声サンプル/ にあり） */
export const VOICES = {
  rooster: "Puck", // にわとり（標準）：Upbeat
  chick: "Leda", // ひよこ（高め）：Youthful
} as const;
export type CharacterVoice = keyof typeof VOICES;

export const TTS_TIMEOUT_MS = 20_000;
/** 一度に声にする文章の長さの上限 */
export const TTS_MAX_LENGTH = 300;

export type TtsOptions = {
  apiKey?: string;
  models?: string[];
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export type TtsResult = { mimeType: "audio/wav"; base64: string; model: string };

function env(name: string): string | undefined {
  const deno = (globalThis as { Deno?: { env: { get(key: string): string | undefined } } }).Deno;
  return deno?.env.get(name);
}

export function voiceFor(setting: string | null | undefined): string {
  return setting === "chick" ? VOICES.chick : VOICES.rooster;
}

/** 応答から WAV の base64 を取り出す。なければ null */
export function extractAudio(body: unknown): string | null {
  const steps = (body as { steps?: { content?: { type?: string; mime_type?: string; data?: string }[] }[] })?.steps ?? [];
  for (const step of steps) {
    for (const part of step.content ?? []) {
      if (part.type === "audio" && part.mime_type === "audio/wav" && part.data) return part.data;
    }
  }
  return null;
}

/** 文章を声（WAV）にする。キーがない・文章が空・全部のモデルが失敗したら null。例外は投げない */
export async function synthesizeSpeech(
  text: string,
  characterVoice: string | null | undefined,
  options: TtsOptions = {},
): Promise<TtsResult | null> {
  const input = text.trim().slice(0, TTS_MAX_LENGTH);
  const apiKey = options.apiKey ?? env("GEMINI_API_KEY");
  if (!apiKey || input.length === 0) return null;
  const models = options.models ?? parseModels(env("GEMINI_TTS_MODELS"), DEFAULT_TTS_MODELS);
  const doFetch = options.fetchImpl ?? fetch;

  for (const model of models) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? TTS_TIMEOUT_MS);
    try {
      const res = await doFetch(INTERACTIONS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          model,
          input,
          response_format: { type: "audio" },
          generation_config: { speech_config: [{ voice: voiceFor(characterVoice) }] },
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        console.warn(`tts ${model}: HTTP ${res.status}`);
        if (isRetryable(res.status)) continue;
        return null;
      }
      const base64 = extractAudio(await res.json());
      if (base64) return { mimeType: "audio/wav", base64, model };
      console.warn(`tts ${model}: 音声が返ってこなかった`);
    } catch (error) {
      console.warn(`tts ${model}: ${error instanceof Error ? error.name : "error"}`);
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}
