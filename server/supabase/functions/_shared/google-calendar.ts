// Google カレンダー連携（T-205、docs/api-spec.md §4-7）。OAuth の URL・トークンの交換と更新・予定の読み取り。
//
// - Google Cloud で作った OAuth クライアントの値を環境変数 GOOGLE_CLIENT_ID・GOOGLE_CLIENT_SECRET に置く
//   （ローカルは supabase/functions/.env、本番は `supabase secrets set`。作り方は docs/cloud-setup.md）。
// - 戻り先（redirect_uri）は GOOGLE_REDIRECT_URIS（カンマ区切り）にあるものだけ受け付ける。
// - 読むのは予定だけ（calendar.readonly）。予定を書き換えることはしない。
//
// Deno の機能は関数の中でだけ使い、Node のテスト（server/tests/functions/）からも fetch を差し替えて呼べるようにしている。

import { jstDateKey } from "./jst.ts";

export const GOOGLE_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

/** 既定で受け付ける戻り先（ローカルの Webアプリ） */
export const DEFAULT_REDIRECT_URIS = ["http://localhost:3000/settings/calendar/callback"];
/** 同意画面から戻るまでの制限時間 */
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
/** アクセストークンの期限がこれより近ければ更新する */
const REFRESH_MARGIN_MS = 60 * 1000;
export const GOOGLE_TIMEOUT_MS = 10_000;

export type GoogleConfig = { clientId: string; clientSecret: string; redirectUris: string[] };

export type GoogleOptions = {
  /** テストで差し替える */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

/** 環境変数を読む（Deno のときだけ。Node のテストでは undefined） */
function env(name: string): string | undefined {
  const deno = (globalThis as { Deno?: { env: { get(key: string): string | undefined } } }).Deno;
  return deno?.env.get(name);
}

/** OAuth クライアントの設定。ID かシークレットがなければ null（「まだ設定されていない」） */
export function googleConfig(read: (name: string) => string | undefined = env): GoogleConfig | null {
  const clientId = read("GOOGLE_CLIENT_ID")?.trim();
  const clientSecret = read("GOOGLE_CLIENT_SECRET")?.trim();
  if (!clientId || !clientSecret) return null;
  const listed = (read("GOOGLE_REDIRECT_URIS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return { clientId, clientSecret, redirectUris: listed.length > 0 ? listed : DEFAULT_REDIRECT_URIS };
}

/** 戻り先が許可したものか（Google 側の登録と同じものだけを使う） */
export function isAllowedRedirect(config: GoogleConfig, redirectUri: unknown): redirectUri is string {
  return typeof redirectUri === "string" && config.redirectUris.includes(redirectUri);
}

/** 推測できない state（同意画面から戻ってきたのが本人の操作か確かめる） */
export function newState(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** 同意画面の URL。refresh token をもらうため offline・毎回同意（prompt=consent）にする */
export function buildAuthUrl(config: GoogleConfig, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_URL}?${params}`;
}

export type GoogleTokens = { accessToken: string; expiresAt: Date; refreshToken?: string; scope?: string };

/** Google のトークンのエラー。invalid_grant は「連携が切れた」（取り消し・テスト中の7日の期限切れなど） */
export class GoogleAuthError extends Error {
  readonly code: string;
  readonly status: number;
  // Node のテスト（型を消すだけのモード）でも読めるよう、引数での readonly 宣言は使わない
  constructor(code: string, status: number) {
    super(`Google token error: ${code} (${status})`);
    this.code = code;
    this.status = status;
  }
  get revoked(): boolean {
    return this.code === "invalid_grant";
  }
}

async function request(url: string, init: RequestInit, options: GoogleOptions): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch;
  return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(options.timeoutMs ?? GOOGLE_TIMEOUT_MS) });
}

async function tokenRequest(form: Record<string, string>, now: Date, options: GoogleOptions): Promise<GoogleTokens> {
  const res = await request(
    TOKEN_URL,
    { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(form) },
    options,
  );
  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
    scope?: string;
    error?: string;
  };
  if (!res.ok || !body.access_token) throw new GoogleAuthError(body.error ?? "unknown", res.status);
  return {
    accessToken: body.access_token,
    expiresAt: new Date(now.getTime() + (body.expires_in ?? 3600) * 1000),
    refreshToken: body.refresh_token,
    scope: body.scope,
  };
}

/** 同意画面から戻ってきた code をトークンに換える */
export function exchangeCode(
  config: GoogleConfig,
  code: string,
  redirectUri: string,
  now: Date = new Date(),
  options: GoogleOptions = {},
): Promise<GoogleTokens> {
  return tokenRequest(
    {
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    },
    now,
    options,
  );
}

/** refresh token で新しいアクセストークンをもらう */
export function refreshAccessToken(
  config: GoogleConfig,
  refreshToken: string,
  now: Date = new Date(),
  options: GoogleOptions = {},
): Promise<GoogleTokens> {
  return tokenRequest(
    { refresh_token: refreshToken, client_id: config.clientId, client_secret: config.clientSecret, grant_type: "refresh_token" },
    now,
    options,
  );
}

/** 保存しているアクセストークンがまだ使えるか */
export function isAccessTokenFresh(expiresAt: string | null, now: Date): boolean {
  return !!expiresAt && new Date(expiresAt).getTime() - now.getTime() > REFRESH_MARGIN_MS;
}

/** 連携の解除。Google 側でも取り消す（失敗しても DB からは消すので、結果は見ない） */
export async function revokeToken(token: string, options: GoogleOptions = {}): Promise<void> {
  try {
    await request(
      REVOKE_URL,
      { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token }) },
      options,
    );
  } catch {
    // Google に届かなくても、こちらでは連携を消す
  }
}

/** Google Calendar API の予定（使う項目だけ） */
export type CalendarEvent = {
  summary?: string;
  status?: string;
  start?: { dateTime?: string; date?: string };
  attendees?: { self?: boolean; responseStatus?: string }[];
};

export type FirstEvent = { title: string; start: Date };

/** 日本時間のその日の 0:00〜24:00（UTC の時刻） */
export function jstDayRange(dateKey: string): { start: Date; end: Date } {
  const start = new Date(`${dateKey}T00:00:00+09:00`);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

/**
 * その日の最初の予定。終日の予定・取り消された予定・自分が「不参加」にした予定は除く。
 * after より前に始まる予定も除く（もう始まっている予定で起きる時刻は決めない）。
 */
export function pickFirstEvent(events: CalendarEvent[], after: Date): FirstEvent | null {
  const candidates = events.flatMap((e) => {
    if (e.status === "cancelled" || !e.start?.dateTime) return [];
    if (e.attendees?.some((a) => a.self && a.responseStatus === "declined")) return [];
    const start = new Date(e.start.dateTime);
    if (Number.isNaN(start.getTime()) || start.getTime() <= after.getTime()) return [];
    return [{ title: (e.summary ?? "").trim() || "予定", start }];
  });
  candidates.sort((a, b) => a.start.getTime() - b.start.getTime());
  return candidates[0] ?? null;
}

/** その日（日本時間）の、now より後の最初の予定を読む */
export async function fetchFirstEvent(
  accessToken: string,
  dateKey: string,
  now: Date,
  options: GoogleOptions = {},
): Promise<FirstEvent | null> {
  const { start, end } = jstDayRange(dateKey);
  const timeMin = start.getTime() > now.getTime() ? start : now;
  if (timeMin.getTime() >= end.getTime()) return null;
  const params = new URLSearchParams({
    timeMin: timeMin.toISOString(),
    timeMax: end.toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "20",
    timeZone: "Asia/Tokyo",
  });
  const res = await request(`${EVENTS_URL}?${params}`, { headers: { authorization: `Bearer ${accessToken}` } }, options);
  if (res.status === 401) throw new GoogleAuthError("unauthorized", 401);
  if (!res.ok) throw new Error(`Google Calendar API error: ${res.status}`);
  const body = (await res.json()) as { items?: CalendarEvent[] };
  return pickFirstEvent(body.items ?? [], now);
}

/**
 * 予定を見る日（日本時間）。24時間以内にアラームがあればアラームの日、なければ「12時間後の日」
 * （19時に作るなら翌日、深夜1時に作り直すならその日）。
 */
export function calendarTargetDate(now: Date, nextAlarm: Date | null): string {
  const ahead = nextAlarm ? nextAlarm.getTime() - now.getTime() : -1;
  const alarmSoon = ahead > 0 && ahead <= 24 * 60 * 60 * 1000;
  return jstDateKey(alarmSoon ? nextAlarm! : new Date(now.getTime() + 12 * 60 * 60 * 1000));
}
