// Gemini API の呼び出し（文章の生成）。docs/dev-plan.md 決定ログ 2026-10-16（Q5）。
//
// - キーは環境変数 GEMINI_API_KEY（AI Studio で作る。2026-05-28 以降は「AQ.」で始まる auth key）。
//   ヘッダー x-goog-api-key で送る。ローカルは supabase/functions/.env、本番は `supabase secrets set`。
// - モデルは GEMINI_MODELS（カンマ区切り）の順に試す。混雑（503）・回数の上限（429）・タイムアウトなら次のモデルへ。
//   全部だめなら null を返すので、呼び出し側は定型文（comment.ts など）を使う。
// - 無料枠では、送った内容が Google の製品の改善に使われる（決定ログに記載）。
//
// Deno の機能は関数の中でだけ使い、Node のテスト（server/tests/functions/）からも fetch を差し替えて呼べるようにしている。

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

/** 既定のモデル（上から順に試す）。2026-10-16 に、この2つが新規ユーザーで使えることを確認した */
export const DEFAULT_MODELS = ["gemini-3.6-flash", "gemini-3.8-flash"];

/**
 * 「考える量」。短い返事に考える処理は要らないので、いちばん少なくする。
 * モデルによって使える値が違う（3.8-flash は minimal を受け付けない。2026-10-16 確認）
 */
const THINKING_LEVEL: Record<string, string> = {
  "gemini-3.6-flash": "minimal",
  "gemini-3.8-flash": "low",
};
const DEFAULT_THINKING_LEVEL = "low";

export const GEMINI_TIMEOUT_MS = 10_000;

export type GeminiOptions = {
  apiKey?: string;
  models?: string[];
  timeoutMs?: number;
  /** テストで差し替える */
  fetchImpl?: typeof fetch;
};

export type GeminiTurn = { role: "user" | "model"; text: string };

export type GeminiRequest = {
  /** キャラクター設定などの指示 */
  system: string;
  /** 今回のお願い（データを含む） */
  prompt: string;
  /** それまでの会話（古い順）。チャットで使う */
  history?: GeminiTurn[];
  maxOutputTokens?: number;
};

export type GeminiResult = { text: string; model: string };

/** 環境変数を読む（Deno のときだけ。Node のテストでは undefined） */
function env(name: string): string | undefined {
  const deno = (globalThis as { Deno?: { env: { get(key: string): string | undefined } } }).Deno;
  return deno?.env.get(name);
}

/** "a, b ,,c" → ["a", "b", "c"]。空なら fallback（既定は文章用のモデル） */
export function parseModels(value: string | undefined, fallback: string[] = DEFAULT_MODELS): string[] {
  const models = (value ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter((m) => m.length > 0);
  return models.length > 0 ? models : fallback;
}

/** 次のモデルで試し直す価値があるエラーか（混雑・回数の上限・サーバー側の障害・モデルがない） */
export function isRetryable(status: number): boolean {
  return status === 404 || status === 429 || status >= 500;
}

/** 応答から文章を取り出す。途中で切れた・安全のため止められた・空のときは null */
export function extractText(body: unknown): string | null {
  const candidate = (body as { candidates?: { finishReason?: string; content?: { parts?: { text?: string }[] } }[] })
    ?.candidates?.[0];
  if (!candidate || candidate.finishReason !== "STOP") return null;
  const text = (candidate.content?.parts ?? [])
    .map((p) => p.text ?? "")
    .join("")
    .trim();
  return text.length > 0 ? text : null;
}

/**
 * 文章を作る。キーがない・全部のモデルが失敗したときは null（呼び出し側で定型文にする）。
 * 例外は投げない（朝の振り返りなど、Gemini がなくても続けたい処理から呼ぶため）
 */
export async function generateText(request: GeminiRequest, options: GeminiOptions = {}): Promise<GeminiResult | null> {
  const apiKey = options.apiKey ?? env("GEMINI_API_KEY");
  if (!apiKey) return null;
  const models = options.models ?? parseModels(env("GEMINI_MODELS"));
  const doFetch = options.fetchImpl ?? fetch;

  for (const model of models) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? GEMINI_TIMEOUT_MS);
    try {
      const res = await doFetch(`${API_BASE}/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: request.system }] },
          contents: [
            ...(request.history ?? []).map((turn) => ({ role: turn.role, parts: [{ text: turn.text }] })),
            { role: "user", parts: [{ text: request.prompt }] },
          ],
          generationConfig: {
            maxOutputTokens: request.maxOutputTokens ?? 400,
            thinkingConfig: { thinkingLevel: THINKING_LEVEL[model] ?? DEFAULT_THINKING_LEVEL },
          },
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        console.warn(`gemini ${model}: HTTP ${res.status}`);
        if (isRetryable(res.status)) continue;
        return null; // キーが違う（401・403）、送り方が違う（400）など。次のモデルでも直らない
      }
      const text = extractText(await res.json());
      if (text) return { text, model };
      console.warn(`gemini ${model}: 応答が空か途中で切れた`);
    } catch (error) {
      console.warn(`gemini ${model}: ${error instanceof Error ? error.name : "error"}`);
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}
