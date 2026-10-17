// Google カレンダーのトークンの読み書き（DB を使う部品）。トークンは google_credentials（サーバーだけが読める）。

import {
  fetchFirstEvent,
  type FirstEvent,
  GoogleAuthError,
  type GoogleConfig,
  googleConfig,
  isAccessTokenFresh,
  refreshAccessToken,
} from "./google-calendar.ts";
import type { Db } from "./http.ts";

/** 使えるアクセストークン。連携していない・切れたときは null（切れたら連携を消す） */
async function accessToken(db: Db, config: GoogleConfig, userId: string, now: Date): Promise<string | null> {
  const { data: cred, error } = await db
    .from("google_credentials")
    .select("refresh_token, access_token, expires_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!cred) return null;
  if (cred.access_token && isAccessTokenFresh(cred.expires_at, now)) return cred.access_token;

  try {
    const tokens = await refreshAccessToken(config, cred.refresh_token, now);
    const { error: saveError } = await db
      .from("google_credentials")
      .update({
        access_token: tokens.accessToken,
        expires_at: tokens.expiresAt.toISOString(),
        // Google が新しい refresh token を返したときだけ置き換える
        ...(tokens.refreshToken ? { refresh_token: tokens.refreshToken } : {}),
      })
      .eq("user_id", userId);
    if (saveError) throw new Error(saveError.message);
    return tokens.accessToken;
  } catch (e) {
    if (e instanceof GoogleAuthError && e.revoked) {
      // 取り消された・期限が切れた（テスト中のアプリは7日で切れる）。設定画面で「連携していない」に戻す
      await db.from("google_credentials").delete().eq("user_id", userId);
      console.warn(`calendar (${userId}): 連携が切れたので消しました`);
      return null;
    }
    throw e;
  }
}

/**
 * その人のカレンダーの、その日（日本時間）の now より後の最初の予定。
 * 連携していない・設定がない・Google に届かないときは null（就寝提案はアラームだけで作る）。
 */
export async function loadFirstEvent(db: Db, userId: string, dateKey: string, now: Date = new Date()): Promise<FirstEvent | null> {
  const config = googleConfig();
  if (!config) return null;
  try {
    const token = await accessToken(db, config, userId, now);
    return token ? await fetchFirstEvent(token, dateKey, now) : null;
  } catch (e) {
    console.error(`calendar (${userId}) failed`, e);
    return null;
  }
}
