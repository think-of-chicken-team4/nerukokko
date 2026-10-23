// 巣に戻らないまま起床予定から3時間たった睡眠セッションを締める（T-209、docs/api-spec.md §5）。
// Supabase Cron（pg_cron + pg_net）が10分ごとに secret キーで呼ぶ。設定は server/CLAUDE.md。
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

import { closeStaleSessions, summarizeClosed } from "../_shared/close-stale.ts";
import { CORS, type Db } from "../_shared/http.ts";

export default {
  fetch: withSupabase({ auth: "secret", cors: CORS }, async (_req, ctx) => {
    const db = ctx.supabaseAdmin as Db;
    const closed = await closeStaleSessions(db);
    // 件数は少ないので、スコアまで待ってから返す（定期実行のログで結果を確かめられるように）
    await summarizeClosed(db, closed);
    return Response.json({ closed });
  }),
};
