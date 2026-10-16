import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import type { Database } from "@/types/database";

// ログインしていなくても開けるページ
const PUBLIC_PATHS = ["/login", "/auth"];

// すべてのリクエストの前に呼ばれ、ログインのセッション（cookie）を更新する。
// 未ログインで保護されたページを開いたらログイン画面へ、ログイン済みでログイン画面を開いたらホームへ移動する。
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => supabaseResponse.cookies.set(name, value, options));
        },
      },
    },
  );

  // createServerClient と getClaims() の間には何も書かないこと（ログアウトされる不具合の原因になる）
  const { data } = await supabase.auth.getClaims();
  const isLoggedIn = Boolean(data?.claims);

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((path) => pathname.startsWith(path));

  if (!isLoggedIn && !isPublic) {
    return redirectKeepingCookies(request, "/login", supabaseResponse);
  }
  if (isLoggedIn && pathname.startsWith("/login")) {
    return redirectKeepingCookies(request, "/", supabaseResponse);
  }

  // supabaseResponse はそのまま返す（cookie を作り直すとセッションがずれる）
  return supabaseResponse;
}

// リダイレクトするときも、更新したセッションの cookie を引き継ぐ
function redirectKeepingCookies(request: NextRequest, pathname: string, from: NextResponse) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = "";
  const response = NextResponse.redirect(url);
  from.cookies.getAll().forEach((cookie) => response.cookies.set(cookie));
  return response;
}
