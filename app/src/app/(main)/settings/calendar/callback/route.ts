import { type NextRequest, NextResponse } from "next/server";

import { calendarRedirectUri, invokeCalendar } from "@/lib/calendar";

// Google の同意画面から戻ってくる場所（T-205）。code をサーバー（calendar-connect）に渡してトークンに換え、設定画面に戻る。
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const back = (result: string) => NextResponse.redirect(new URL(`/settings?calendar=${result}`, request.url));

  if (params.get("error")) return back("denied");
  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state) return back("invalid_state");

  const result = await invokeCalendar<{ connected: boolean }>({
    action: "finish",
    code,
    state,
    redirect_uri: await calendarRedirectUri(),
  });
  return back("data" in result ? "connected" : result.errorCode);
}
