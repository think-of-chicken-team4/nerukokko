// Google カレンダー連携の開始・完了・解除（docs/api-spec.md §4-7、T-205）。Webアプリ（ログインしたユーザー）が呼ぶ。
// - { action: "start", redirect_uri }       → 同意画面の URL を返す（state を保存。10分で使えなくなる）
// - { action: "finish", code, state, redirect_uri } → code をトークンに換えて保存する
// - { action: "disconnect" }                 → Google 側でも取り消して、トークンを消す
// OAuth クライアント（GOOGLE_CLIENT_ID・GOOGLE_CLIENT_SECRET）がなければ 503 not_configured。
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

import {
  buildAuthUrl,
  exchangeCode,
  GoogleAuthError,
  googleConfig,
  GOOGLE_SCOPE,
  isAllowedRedirect,
  newState,
  OAUTH_STATE_TTL_MS,
  revokeToken,
} from "../_shared/google-calendar.ts";
import { CORS, type Db, jsonError, readJson } from "../_shared/http.ts";

type Input = { action?: unknown; redirect_uri?: unknown; code?: unknown; state?: unknown };

export default {
  fetch: withSupabase({ auth: "user", cors: CORS }, async (req, ctx) => {
    const userId = ctx.userClaims!.id;
    const body = await readJson(req, 4 * 1024);
    if (body instanceof Response) return body;
    const input = (body ?? {}) as Input;
    // トークンの表はクライアントから読めないので、本人の行だけを secret の権限で扱う
    const db = ctx.supabaseAdmin as Db;

    if (input.action === "disconnect") {
      const { data: cred } = await db
        .from("google_credentials")
        .select("refresh_token")
        .eq("user_id", userId)
        .maybeSingle();
      if (cred) await revokeToken(cred.refresh_token);
      const { error } = await db.from("google_credentials").delete().eq("user_id", userId);
      if (error) throw new Error(error.message);
      return Response.json({ connected: false });
    }

    const config = googleConfig();
    if (!config) {
      return jsonError(503, "not_configured", "カレンダー連携はまだ設定されていません（Google の OAuth クライアントが必要です）");
    }
    if (input.action !== "start" && input.action !== "finish") {
      return jsonError(400, "invalid_action", "action は start・finish・disconnect のどれかです");
    }
    if (!isAllowedRedirect(config, input.redirect_uri)) {
      return jsonError(400, "invalid_redirect_uri", "戻り先の URL が登録されていません（GOOGLE_REDIRECT_URIS）");
    }
    const redirectUri = input.redirect_uri;
    const now = new Date();

    if (input.action === "start") {
      // 古い state を片付けてから作る
      await db.from("oauth_states").delete().lt("created_at", new Date(now.getTime() - OAUTH_STATE_TTL_MS).toISOString());
      const state = newState();
      const { error } = await db.from("oauth_states").insert({ state, user_id: userId, redirect_uri: redirectUri });
      if (error) throw new Error(error.message);
      return Response.json({ url: buildAuthUrl(config, redirectUri, state) });
    }

    // finish：state は1回だけ使える。本人のもので、10分以内・同じ戻り先であること
    if (typeof input.code !== "string" || typeof input.state !== "string" || !input.code || !input.state) {
      return jsonError(400, "invalid_request", "code と state が必要です");
    }
    const { data: saved, error: stateError } = await db
      .from("oauth_states")
      .delete()
      .eq("state", input.state)
      .select("user_id, redirect_uri, created_at")
      .maybeSingle();
    if (stateError) throw new Error(stateError.message);
    if (
      !saved || saved.user_id !== userId || saved.redirect_uri !== redirectUri ||
      now.getTime() - new Date(saved.created_at).getTime() > OAUTH_STATE_TTL_MS
    ) {
      return jsonError(400, "invalid_state", "連携の手続きの期限が切れました。もう一度やり直してください");
    }

    let tokens;
    try {
      tokens = await exchangeCode(config, input.code, redirectUri, now);
    } catch (e) {
      if (e instanceof GoogleAuthError) return jsonError(400, "google_error", `Google で連携できませんでした（${e.code}）`);
      throw e;
    }
    if (!tokens.scope?.split(" ").includes(GOOGLE_SCOPE)) {
      return jsonError(400, "scope_missing", "カレンダーを読む許可がありませんでした。同意画面でチェックを入れてください");
    }
    if (!tokens.refreshToken) {
      return jsonError(400, "no_refresh_token", "Google から更新用のトークンが届きませんでした。もう一度やり直してください");
    }
    const { error } = await db.from("google_credentials").upsert({
      user_id: userId,
      refresh_token: tokens.refreshToken,
      access_token: tokens.accessToken,
      expires_at: tokens.expiresAt.toISOString(),
      scope: tokens.scope ?? null,
      connected_at: now.toISOString(),
    });
    if (error) throw new Error(error.message);
    return Response.json({ connected: true });
  }),
};
