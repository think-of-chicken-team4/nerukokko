// Google カレンダー連携（google-calendar.ts）のテスト。本物の Google は呼ばず、fetch を差し替える。
// 実行：cd server && npm run test:functions
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildAuthUrl,
  calendarTargetDate,
  DEFAULT_REDIRECT_URIS,
  exchangeCode,
  fetchFirstEvent,
  GOOGLE_SCOPE,
  GoogleAuthError,
  googleConfig,
  isAccessTokenFresh,
  isAllowedRedirect,
  jstDayRange,
  newState,
  pickFirstEvent,
  refreshAccessToken,
} from "../../supabase/functions/_shared/google-calendar.ts";

const env = (values: Record<string, string>) => (name: string) => values[name];
const CONFIG = { clientId: "cid", clientSecret: "secret", redirectUris: DEFAULT_REDIRECT_URIS };
const NOW = new Date("2026-10-16T10:00:00Z"); // 19:00 JST

function fakeFetch(status: number, body: unknown, calls: { url: string; init?: RequestInit }[] = []): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

describe("設定", () => {
  it("ID とシークレットがなければ null（まだ設定されていない）", () => {
    assert.equal(googleConfig(env({})), null);
    assert.equal(googleConfig(env({ GOOGLE_CLIENT_ID: "a" })), null);
  });
  it("戻り先は指定がなければローカルの Webアプリ", () => {
    assert.deepEqual(googleConfig(env({ GOOGLE_CLIENT_ID: "a", GOOGLE_CLIENT_SECRET: "b" }))!.redirectUris, DEFAULT_REDIRECT_URIS);
  });
  it("戻り先はカンマ区切りで複数書ける。それ以外は受け付けない", () => {
    const config = googleConfig(env({
      GOOGLE_CLIENT_ID: "a",
      GOOGLE_CLIENT_SECRET: "b",
      GOOGLE_REDIRECT_URIS: "https://x.vercel.app/settings/calendar/callback, http://localhost:3000/settings/calendar/callback",
    }))!;
    assert.equal(isAllowedRedirect(config, "https://x.vercel.app/settings/calendar/callback"), true);
    assert.equal(isAllowedRedirect(config, "https://evil.example/settings/calendar/callback"), false);
    assert.equal(isAllowedRedirect(config, 42), false);
  });
});

describe("同意画面の URL", () => {
  it("読み取り専用・offline・毎回同意・state 付き", () => {
    const url = new URL(buildAuthUrl(CONFIG, DEFAULT_REDIRECT_URIS[0], "st"));
    assert.equal(url.origin, "https://accounts.google.com");
    assert.equal(url.searchParams.get("scope"), GOOGLE_SCOPE);
    assert.equal(url.searchParams.get("access_type"), "offline");
    assert.equal(url.searchParams.get("prompt"), "consent");
    assert.equal(url.searchParams.get("state"), "st");
    assert.equal(url.searchParams.get("redirect_uri"), DEFAULT_REDIRECT_URIS[0]);
  });
  it("state は推測できない64文字", () => {
    const a = newState();
    assert.match(a, /^[0-9a-f]{64}$/);
    assert.notEqual(a, newState());
  });
});

describe("トークン", () => {
  it("code をトークンに換える（期限は expires_in から）", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const tokens = await exchangeCode(CONFIG, "code1", DEFAULT_REDIRECT_URIS[0], NOW, {
      fetchImpl: fakeFetch(200, { access_token: "at", expires_in: 3599, refresh_token: "rt", scope: GOOGLE_SCOPE }, calls),
    });
    assert.equal(tokens.accessToken, "at");
    assert.equal(tokens.refreshToken, "rt");
    assert.equal(tokens.expiresAt.toISOString(), "2026-10-16T10:59:59.000Z");
    const form = new URLSearchParams(String(calls[0].init?.body));
    assert.equal(form.get("grant_type"), "authorization_code");
    assert.equal(form.get("code"), "code1");
  });
  it("取り消された refresh token は revoked のエラー", async () => {
    await assert.rejects(
      refreshAccessToken(CONFIG, "rt", NOW, { fetchImpl: fakeFetch(400, { error: "invalid_grant" }) }),
      (e: unknown) => e instanceof GoogleAuthError && e.revoked,
    );
  });
  it("期限まで1分を切ったら更新する", () => {
    assert.equal(isAccessTokenFresh("2026-10-16T10:05:00Z", NOW), true);
    assert.equal(isAccessTokenFresh("2026-10-16T10:00:30Z", NOW), false);
    assert.equal(isAccessTokenFresh(null, NOW), false);
  });
});

describe("予定", () => {
  const after = new Date("2026-10-16T15:00:00Z"); // 0:00 JST
  it("終日・取り消し・不参加・もう始まった予定は除き、いちばん早い予定", () => {
    const first = pickFirstEvent([
      { summary: "終日", start: { date: "2026-10-17" } },
      { summary: "取り消し", status: "cancelled", start: { dateTime: "2026-10-17T07:00:00+09:00" } },
      { summary: "不参加", start: { dateTime: "2026-10-17T07:30:00+09:00" }, attendees: [{ self: true, responseStatus: "declined" }] },
      { summary: "  2限  ", start: { dateTime: "2026-10-17T10:40:00+09:00" } },
      { summary: "1限", start: { dateTime: "2026-10-17T08:50:00+09:00" } },
      { summary: "前の日", start: { dateTime: "2026-10-16T23:00:00+09:00" } },
    ], after);
    assert.deepEqual(first, { title: "1限", start: new Date("2026-10-16T23:50:00Z") });
  });
  it("名前がない予定は「予定」", () => {
    assert.equal(pickFirstEvent([{ start: { dateTime: "2026-10-17T09:00:00+09:00" } }], after)!.title, "予定");
  });
  it("日本時間の1日", () => {
    const { start, end } = jstDayRange("2026-10-17");
    assert.equal(start.toISOString(), "2026-10-16T15:00:00.000Z");
    assert.equal(end.toISOString(), "2026-10-17T15:00:00.000Z");
  });
  it("その日の予定を読む（主カレンダー・繰り返しを展開・日本時間）", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const first = await fetchFirstEvent("at", "2026-10-17", NOW, {
      fetchImpl: fakeFetch(200, { items: [{ summary: "1限", start: { dateTime: "2026-10-17T08:50:00+09:00" } }] }, calls),
    });
    assert.equal(first?.title, "1限");
    const url = new URL(calls[0].url);
    assert.equal(url.pathname, "/calendar/v3/calendars/primary/events");
    assert.equal(url.searchParams.get("timeMin"), "2026-10-16T15:00:00.000Z");
    assert.equal(url.searchParams.get("singleEvents"), "true");
    assert.equal((calls[0].init?.headers as Record<string, string>).authorization, "Bearer at");
  });
  it("トークンが使えなければ unauthorized", async () => {
    await assert.rejects(fetchFirstEvent("at", "2026-10-17", NOW, { fetchImpl: fakeFetch(401, {}) }), GoogleAuthError);
  });
});

describe("予定を見る日", () => {
  it("24時間以内にアラームがあればアラームの日", () => {
    assert.equal(calendarTargetDate(NOW, new Date("2026-10-16T22:15:00Z")), "2026-10-17");
  });
  it("アラームがない・遠いときは12時間後の日（19時なら翌日・深夜1時ならその日）", () => {
    assert.equal(calendarTargetDate(NOW, null), "2026-10-17");
    assert.equal(calendarTargetDate(NOW, new Date("2026-10-19T22:00:00Z")), "2026-10-17");
    assert.equal(calendarTargetDate(new Date("2026-10-16T16:00:00Z"), null), "2026-10-17");
  });
});
