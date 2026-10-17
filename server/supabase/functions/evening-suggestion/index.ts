// 夕方の就寝提案（docs/api-spec.md §4-5、T-206）。
// - 定期実行（Supabase Cron、毎日 10:00 UTC＝19:00 日本時間）が secret キーで呼ぶ → 全ユーザーぶん作る
// - Webアプリ（ログインしたユーザー）が呼ぶ → その人の分だけ作り直す（デモ用）
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

import { runEveningSuggestion } from "../_shared/evening-suggestion.ts";
import { CORS, type Db } from "../_shared/http.ts";

export default {
  fetch: withSupabase({ auth: ["user", "secret"], cors: CORS }, async (_req, ctx) => {
    const db = ctx.supabaseAdmin as Db;

    if (ctx.authMode === "user") {
      const recommendation = await runEveningSuggestion(db, ctx.userClaims!.id);
      return Response.json({ recommendation });
    }

    // 全ユーザー：1人が失敗しても残りは続ける。Gemini の上限に配慮して1人ずつ順に
    const { data: users, error } = await db.from("users").select("id");
    if (error) throw new Error(error.message);
    let created = 0;
    let skipped = 0;
    let failed = 0;
    for (const user of users ?? []) {
      try {
        if (await runEveningSuggestion(db, user.id)) created += 1;
        else skipped += 1;
      } catch (e) {
        failed += 1;
        console.error(`evening-suggestion (${user.id}) failed`, e);
      }
    }
    return Response.json({ created, skipped, failed });
  }),
};
