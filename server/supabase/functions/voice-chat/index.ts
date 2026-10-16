// 鶏 → サーバー：トサカのボタンを押して話した声に、にわとりの声で返事をする（docs/api-spec.md §3-3、T-207）。
// 録音を Gemini に送って、聞き取りと返事を1回で作り、Gemini の TTS で声にする（決定ログ 2026-10-16 Q5）。
// 録音は保存しない。聞き取った文章と返事だけを chat_messages に残す（Q7）。
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

import { CHAT_HISTORY_LIMIT, CHAT_HOURLY_LIMIT, CHAT_LIMIT_REPLY, chatSystem, toHistory } from "../_shared/chat.ts";
import { loadContext, userMessagesInLastHour } from "../_shared/chat-context.ts";
import { authenticateChicken } from "../_shared/devices.ts";
import { generateText } from "../_shared/gemini.ts";
import { CORS, type Db, jsonError } from "../_shared/http.ts";
import { synthesizeSpeech } from "../_shared/tts.ts";
import {
  isWav,
  parseVoiceReply,
  toBase64,
  VOICE_FALLBACK_REPLY,
  VOICE_GEMINI_TIMEOUT_MS,
  VOICE_MAX_BYTES,
  VOICE_PROMPT,
  VOICE_RETRY_REPLY,
  VOICE_SCHEMA,
  VOICE_SESSION_GAP_MS,
} from "../_shared/voice.ts";

export default {
  fetch: withSupabase({ auth: "publishable", cors: CORS }, async (req, ctx) => {
    const db = ctx.supabaseAdmin as Db;
    const chicken = await authenticateChicken(req, db);
    if (chicken instanceof Response) return chicken;
    const userId = chicken.user_id;

    if (!(req.headers.get("content-type") ?? "").startsWith("audio/wav")) {
      return jsonError(400, "invalid_audio", "Content-Type: audio/wav で録音を送ってください");
    }
    const declared = Number(req.headers.get("content-length") ?? "0");
    if (declared > VOICE_MAX_BYTES) return jsonError(413, "payload_too_large", "録音は512KB（約15秒）までです");
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (bytes.length > VOICE_MAX_BYTES) return jsonError(413, "payload_too_large", "録音は512KB（約15秒）までです");
    if (!isWav(bytes)) return jsonError(400, "invalid_audio", "WAV の形式ではありません");

    const now = new Date();
    const requested = new URL(req.url).searchParams.get("chat_session_id");
    const chatSessionId = await resolveVoiceSession(db, userId, requested, now);
    const [history, settings] = await Promise.all([
      recentMessages(db, chatSessionId),
      db.from("notification_settings").select("character_voice").eq("user_id", userId).maybeSingle(),
    ]);

    // 1時間の上限（文字の会話と合わせて数える）
    if ((await userMessagesInLastHour(db, userId, now)) >= CHAT_HOURLY_LIMIT) {
      return await respond(chatSessionId, "", CHAT_LIMIT_REPLY, true, settings.data?.character_voice);
    }

    const generated = await generateText({
      system: chatSystem(await loadContext(db, userId, now)),
      prompt: VOICE_PROMPT,
      history: toHistory(history),
      audio: { mimeType: "audio/wav", base64: toBase64(bytes) },
      jsonSchema: VOICE_SCHEMA,
      maxOutputTokens: 500,
    }, { timeoutMs: VOICE_GEMINI_TIMEOUT_MS });
    if (!generated) {
      return await respond(chatSessionId, "", VOICE_FALLBACK_REPLY, true, settings.data?.character_voice);
    }
    const parsed = parseVoiceReply(generated.text);
    if (!parsed) {
      return await respond(chatSessionId, "", VOICE_RETRY_REPLY, true, settings.data?.character_voice);
    }

    const { error } = await db.from("chat_messages").insert([
      { chat_session_id: chatSessionId, role: "user", content: parsed.userText },
      { chat_session_id: chatSessionId, role: "assistant", content: parsed.replyText },
    ]);
    if (error) throw new Error(error.message);
    await db.from("chat_sessions").update({ ended_at: new Date().toISOString() }).eq("id", chatSessionId);

    return await respond(chatSessionId, parsed.userText, parsed.replyText, false, settings.data?.character_voice);
  }),
};

/** 返事を声にして返す。声にできなければ audio: null（鶏は定型の音声を流す） */
async function respond(chatSessionId: string, userText: string, replyText: string, fallback: boolean, voice: string | undefined) {
  const speech = await synthesizeSpeech(replyText, voice);
  return Response.json({
    chat_session_id: chatSessionId,
    user_text: userText,
    reply_text: replyText,
    audio: speech ? { mime_type: speech.mimeType, base64: speech.base64 } : null,
    fallback,
  });
}

/**
 * 続きの会話か、新しい会話か。指定された id が本人のボタンでの会話で、最後の発言から10分以内なら続き。
 * 新しい会話は、記録中ならその夜に紐づける（記録の「会話ログ」に出る）
 */
async function resolveVoiceSession(db: Db, userId: string, requested: string | null, now: Date): Promise<string> {
  if (requested) {
    const { data } = await db
      .from("chat_sessions")
      .select("id, ended_at, started_at")
      .eq("id", requested)
      .eq("user_id", userId)
      .eq("trigger", "button")
      .maybeSingle();
    const last = data ? new Date(data.ended_at ?? data.started_at).getTime() : 0;
    if (data && now.getTime() - last <= VOICE_SESSION_GAP_MS) return data.id;
  }
  const { data: active } = await db
    .from("sleep_sessions")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "in_progress")
    .maybeSingle();
  const { data, error } = await db
    .from("chat_sessions")
    .insert({ user_id: userId, trigger: "button", started_at: now.toISOString(), sleep_session_id: active?.id ?? null })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

async function recentMessages(db: Db, chatSessionId: string) {
  const { data, error } = await db
    .from("chat_messages")
    .select("role, content")
    .eq("chat_session_id", chatSessionId)
    .order("id", { ascending: false })
    .limit(CHAT_HISTORY_LIMIT);
  if (error) throw new Error(error.message);
  return (data ?? []).reverse();
}
