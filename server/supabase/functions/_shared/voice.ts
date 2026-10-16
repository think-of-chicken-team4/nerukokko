// 音声会話（voice-chat、T-207）の決まりと、Gemini に渡す指示。docs/api-spec.md §3-3。DB に依存しない純粋な関数。

/** 録音の大きさの上限（WAV・PCM 16bit・モノラル・16kHz で約15秒） */
export const VOICE_MAX_BYTES = 512 * 1024;
/** 最後の発言からこの時間以内なら、同じ会話の続きとして扱う */
export const VOICE_SESSION_GAP_MS = 10 * 60 * 1000;

/** 録音を聞いて返事を作るのは文章だけより時間がかかるので、1モデルあたり長めに待つ（2026-10-16 に10秒では足りないことがあった） */
export const VOICE_GEMINI_TIMEOUT_MS = 20_000;

/** 聞き取れなかったとき */
export const VOICE_RETRY_REPLY = "ごめんコケ、うまく聞き取れなかったコケ。もう一回言ってほしいコケ。";
/** AI が使えないとき */
export const VOICE_FALLBACK_REPLY = "ちょっと今、考え中コケ…。少し時間をおいて、また話しかけてほしいコケ。";

/** Gemini に返してもらう形：聞き取った文章と、にわとりの返事 */
export const VOICE_SCHEMA = {
  type: "OBJECT",
  properties: {
    user_text: { type: "STRING", description: "録音で話された内容。聞き取れなければ空文字" },
    reply_text: { type: "STRING", description: "にわとりとしての返事（2〜3文）" },
  },
  required: ["user_text", "reply_text"],
};

export const VOICE_PROMPT = [
  "添付の録音は、ユーザーがにわとりのトサカのボタンを押して話した声です。",
  "user_text に話した内容をそのまま書き、reply_text ににわとりとしての返事を書いてください。",
  "声として読み上げるので、返事に絵文字や記号は使わないでください。",
  "無音・雑音だけ・聞き取れないときは、user_text と reply_text を空文字にしてください。",
].join("\n");

/** WAV のファイルか（先頭が RIFF、9〜12バイト目が WAVE） */
export function isWav(bytes: Uint8Array): boolean {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  return bytes.length > 44 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE";
}

/** Gemini の JSON の返事を読む。聞き取れなかった・形が違うときは null */
export function parseVoiceReply(text: string): { userText: string; replyText: string } | null {
  try {
    const value = JSON.parse(text) as { user_text?: unknown; reply_text?: unknown };
    const userText = typeof value.user_text === "string" ? value.user_text.trim() : "";
    const replyText = typeof value.reply_text === "string" ? value.reply_text.trim() : "";
    return userText && replyText ? { userText, replyText } : null;
  } catch {
    return null;
  }
}

/** バイト列を base64 にする（大きな録音でも呼び出しの引数の上限を超えないよう、少しずつ） */
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
