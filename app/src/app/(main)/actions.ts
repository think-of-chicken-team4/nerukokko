"use server";

import { revalidatePath } from "next/cache";

import { createClient, getUserId } from "@/lib/supabase/server";

const DEFAULT_SLEEP_HOURS = 8;

export type ActionResult = { error?: string };

/** 「眠りにつく」：睡眠セッションを始める。起床予定は次のアラーム（なければ8時間後） */
export async function startSleep(): Promise<ActionResult> {
  const supabase = await createClient();
  const userId = await getUserId();
  if (!userId) return { error: "ログインし直してください" };

  const now = new Date();
  const [{ data: nextAlarm }, { data: devices }] = await Promise.all([
    supabase.rpc("next_alarm_at", { p_user_id: userId, p_from: now.toISOString() }).maybeSingle(),
    supabase.from("devices").select("id, type"),
  ]);
  const plannedWake = nextAlarm?.ring_at ?? new Date(now.getTime() + DEFAULT_SLEEP_HOURS * 3600_000).toISOString();

  const { error } = await supabase.from("sleep_sessions").insert({
    user_id: userId,
    start_time: now.toISOString(),
    planned_wake_time: plannedWake,
    chicken_device_id: devices?.find((d) => d.type === "chicken")?.id ?? null,
    egg_device_id: devices?.find((d) => d.type === "egg")?.id ?? null,
  });
  if (error) {
    return { error: "記録を始められませんでした。すでに記録中かもしれません" };
  }
  revalidatePath("/", "layout");
  return {};
}

/** 記録を中止する（status = aborted） */
export async function abortSleep(sessionId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("sleep_sessions")
    .update({ status: "aborted", end_time: new Date().toISOString() })
    .eq("id", sessionId)
    .eq("status", "in_progress");
  if (error) return { error: "中止できませんでした" };
  revalidatePath("/", "layout");
  return {};
}
