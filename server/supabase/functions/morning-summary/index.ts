// 朝の振り返り（スコアとにわとりのコメント）のやり直し（docs/api-spec.md §4-4）
// 通常は ingest-sensor-data が巣に戻ったときに自動で作る。Webアプリやデモから手動でやり直すときに使う。
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

import { CORS, type Db, jsonError, readJson } from "../_shared/http.ts";
import { runMorningSummary, SummaryError } from "../_shared/morning-summary.ts";

export default {
  // ログイン中のユーザー（自分のセッションだけ）か、サーバー内部（secret キー）から呼べる
  fetch: withSupabase({ auth: ["user", "secret"], cors: CORS }, async (req, ctx) => {
    const body = await readJson(req, 4 * 1024);
    if (body instanceof Response) return body;
    const sessionId = (body as { session_id?: unknown }).session_id;
    if (typeof sessionId !== "string" || sessionId.length === 0) {
      return jsonError(400, "invalid_body", "session_id が必要です");
    }

    if (ctx.authMode === "user") {
      // RLS が効くクライアントで読めるかどうかで、本人のセッションかを確かめる
      const { data: own } = await ctx.supabase.from("sleep_sessions").select("id").eq("id", sessionId).maybeSingle();
      if (!own) return jsonError(404, "session_not_found", "睡眠セッションが見つかりません");
    }

    try {
      return Response.json(await runMorningSummary(ctx.supabaseAdmin as Db, sessionId));
    } catch (error) {
      if (error instanceof SummaryError) return jsonError(error.status, error.code, error.message);
      throw error;
    }
  }),
};
