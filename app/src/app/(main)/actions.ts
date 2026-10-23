"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import { PREP_COOKIE, PREP_MAX_AGE_SEC } from "@/lib/data/phase";
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
  (await cookies()).delete(PREP_COOKIE);
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

/** 夕方確認 →「就寝準備へ進む」 */
export async function enterPrep(): Promise<void> {
  (await cookies()).set(PREP_COOKIE, "1", {
    maxAge: PREP_MAX_AGE_SEC,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
  revalidatePath("/", "layout");
}

/** 就寝準備 →「← 戻る」 */
export async function leavePrep(): Promise<void> {
  (await cookies()).delete(PREP_COOKIE);
  revalidatePath("/", "layout");
}
