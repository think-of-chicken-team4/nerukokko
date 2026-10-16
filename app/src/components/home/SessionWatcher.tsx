"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { createClient } from "@/lib/supabase/client";
import { subscribeAsUser } from "@/lib/supabase/realtime";

type Props = {
  /** このセッションが変わったら（起床・中止・スコア確定）更新する */
  sessionId?: string;
  /** このユーザーの新しいセッションが始まったら（別の端末で「眠りにつく」など）更新する */
  userId?: string;
  /** この時刻になったら画面を更新する（例：起床予定時刻になったら「起床制御」に切り替える） */
  refreshAt?: string;
  /** Realtime が届かなかったときのための定期更新（ミリ秒） */
  pollMs?: number;
};

// 睡眠セッションが変わったら画面をサーバーから読み直す。表示はしない
export function SessionWatcher({ sessionId, userId, refreshAt, pollMs }: Props) {
  const router = useRouter();

  useEffect(() => {
    if (!sessionId) return;
    return subscribeAsUser(createClient(), `session-watch-${sessionId}`, (channel) =>
      channel.on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "sleep_sessions", filter: `id=eq.${sessionId}` },
        () => router.refresh(),
      ),
    );
  }, [sessionId, router]);

  useEffect(() => {
    if (!userId) return;
    return subscribeAsUser(createClient(), `new-session-watch-${userId}`, (channel) =>
      channel.on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "sleep_sessions", filter: `user_id=eq.${userId}` },
        () => router.refresh(),
      ),
    );
  }, [userId, router]);

  useEffect(() => {
    if (!refreshAt) return;
    const delay = new Date(refreshAt).getTime() - Date.now();
    if (delay <= 0) return;
    const timer = setTimeout(() => router.refresh(), delay + 1000);
    return () => clearTimeout(timer);
  }, [refreshAt, router]);

  useEffect(() => {
    if (!pollMs) return;
    const timer = setInterval(() => router.refresh(), pollMs);
    return () => clearInterval(timer);
  }, [pollMs, router]);

  return null;
}
