import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "@/types/database";

// ブラウザ（"use client" のコンポーネント）で使う Supabase クライアント。
// Realtime の購読やフォーム送信など、画面の操作に応じた読み書きで使う。
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
