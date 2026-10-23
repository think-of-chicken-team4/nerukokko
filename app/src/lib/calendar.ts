import { FunctionsHttpError } from "@supabase/supabase-js";
import { headers } from "next/headers";

import { createClient } from "@/lib/supabase/server";

// Google カレンダー連携（T-205）。トークンは Edge Function（calendar-connect）が扱い、Webアプリには来ない。

/** 同意画面から戻る場所。Google Cloud の「承認済みのリダイレクト URI」と、関数の GOOGLE_REDIRECT_URIS に同じものを登録する */
export const CALENDAR_CALLBACK_PATH = "/settings/calendar/callback";

/** いま開いている Webアプリの URL から、戻り先を作る（ローカルは http://localhost:3000/…、Vercel は https://…） */
export async function calendarRedirectUri(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https");
  return `${proto}://${host}${CALENDAR_CALLBACK_PATH}`;
}

type CalendarBody =
  | { action: "start"; redirect_uri: string }
  | { action: "finish"; code: string; state: string; redirect_uri: string }
  | { action: "disconnect" };

/** calendar-connect を呼ぶ。失敗したらエラーの code（docs/api-spec.md §4-7）を返す */
export async function invokeCalendar<T>(body: CalendarBody): Promise<{ data: T } | { errorCode: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.functions.invoke<T>("calendar-connect", { body });
  if (!error && data) return { data };
  if (error instanceof FunctionsHttpError) {
    const detail = (await error.context.json().catch(() => null)) as { error?: { code?: string } } | null;
    return { errorCode: detail?.error?.code ?? "unknown" };
  }
  return { errorCode: "network" };
}

/** 設定画面に出すメッセージ（?calendar=… で受け取る） */
export function calendarMessage(code: string | undefined): { ok: boolean; text: string } | null {
  switch (code) {
    case undefined:
      return null;
    case "connected":
      return { ok: true, text: "Googleカレンダーと連携しました。今夜から、明日の予定に合わせて就寝時刻を提案します。" };
    case "disconnected":
      return { ok: true, text: "連携を解除しました。" };
    case "denied":
      return { ok: false, text: "連携をキャンセルしました。" };
    case "not_configured":
      return { ok: false, text: "カレンダー連携はまだ準備中です（管理者が Google の設定をする必要があります）。" };
    case "invalid_state":
      return { ok: false, text: "連携の手続きの期限が切れました。もう一度「連携する」を押してください。" };
    case "scope_missing":
      return { ok: false, text: "カレンダーを見る許可がありませんでした。同意画面でカレンダーにチェックを入れてください。" };
    default:
      return { ok: false, text: "連携できませんでした。時間をおいて、もう一度試してください。" };
  }
}
