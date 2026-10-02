import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

/**
 * ログイン中のユーザーとして Realtime を購読する。戻り値の関数で購読をやめる（useEffect の後片付けで呼ぶ）。
 *
 * @supabase/ssr のブラウザクライアントは、cookie から復元したログインを Realtime の接続に自動では渡さない。
 * 渡さないと匿名として扱われ、RLS によって変更の通知が届かないため、購読の前に明示的に渡す。
 */
export function subscribeAsUser(
  supabase: SupabaseClient<Database>,
  channelName: string,
  configure: (channel: RealtimeChannel) => RealtimeChannel,
): () => void {
  let channel: RealtimeChannel | null = null;
  let cancelled = false;

  void (async () => {
    const { data } = await supabase.auth.getSession();
    if (cancelled) return;
    if (data.session) {
      await supabase.realtime.setAuth(data.session.access_token);
    }
    if (cancelled) return;
    channel = configure(supabase.channel(channelName)).subscribe();
  })();

  return () => {
    cancelled = true;
    if (channel) void supabase.removeChannel(channel);
  };
}
