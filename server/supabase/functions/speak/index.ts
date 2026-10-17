// 鶏 → サーバー：文章を、にわとりの声（WAV）にする（docs/api-spec.md §3-4）。
// device-sync で受け取った「話す内容」（announcements）を、鶏が声にして流すために使う。
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

import { authenticateChicken } from "../_shared/devices.ts";
import { CORS, type Db, jsonError, readJson } from "../_shared/http.ts";
import { synthesizeSpeech, TTS_MAX_LENGTH } from "../_shared/tts.ts";

export default {
  fetch: withSupabase({ auth: "publishable", cors: CORS }, async (req, ctx) => {
    const db = ctx.supabaseAdmin as Db;
    const chicken = await authenticateChicken(req, db);
    if (chicken instanceof Response) return chicken;

    const body = await readJson(req, 4 * 1024);
    if (body instanceof Response) return body;
    const text = typeof (body as { text?: unknown })?.text === "string" ? (body as { text: string }).text.trim() : "";
    if (text.length === 0 || text.length > TTS_MAX_LENGTH) {
      return jsonError(400, "invalid_text", `text は1〜${TTS_MAX_LENGTH}文字で送ってください`);
    }

    const { data: settings } = await db
      .from("notification_settings")
      .select("character_voice")
      .eq("user_id", chicken.user_id)
      .maybeSingle();
    const speech = await synthesizeSpeech(text, settings?.character_voice);

    // 声にできなかったら audio: null。鶏は保存してある定型の音声を流す
    return Response.json({ audio: speech ? { mime_type: speech.mimeType, base64: speech.base64 } : null });
  }),
};
