import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import type { Database } from "@/types/database";

// サーバー（Server Component・Server Action・Route Handler）で使う Supabase クライアント。
// ログイン中のユーザーの権限で動くので、RLS により本人のデータしか読み書きできない。
// グローバル変数に入れず、使う関数の中で毎回作ること。
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Server Component から呼ばれたときは cookie を書けないが、
            // proxy.ts がセッションを更新しているので無視してよい。
          }
        },
      },
    },
  );
}

// ログイン中のユーザー ID を返す。未ログインなら null。
// サーバー側では getSession() ではなく getClaims() で確かめる（JWT を検証するため）。
export async function getUserId(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return data?.claims?.sub ?? null;
}
