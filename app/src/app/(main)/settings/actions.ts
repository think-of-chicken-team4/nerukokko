"use server";

import { revalidatePath } from "next/cache";

import type { ActionResult } from "@/app/(main)/actions";
import { MAX_ALARMS, validateAlarm, type AlarmInput } from "@/lib/alarm";
import { createClient, getUserId } from "@/lib/supabase/server";

// アラームを変えると、ホームの「起床アラーム」の表示も変わるので、全体を読み直す
function refresh() {
  revalidatePath("/", "layout");
}

/** アラームを追加する（id なし）か、書き換える（id あり） */
export async function saveAlarm(id: string | null, input: AlarmInput): Promise<ActionResult> {
  const checked = validateAlarm(input);
  if ("error" in checked) return { error: checked.error };
  const { time, days } = checked.value;

  const supabase = await createClient();
  const userId = await getUserId();
  if (!userId) return { error: "ログインし直してください" };

  if (id) {
    const { data, error } = await supabase
      .from("alarms")
      .update({ time, repeat_days: days })
      .eq("id", id)
      .select("id")
      .maybeSingle();
    if (error || !data) return { error: "保存できませんでした" };
  } else {
    const { count } = await supabase.from("alarms").select("id", { count: "exact", head: true });
    if ((count ?? 0) >= MAX_ALARMS) return { error: `アラームは${MAX_ALARMS}件までです` };
    const { error } = await supabase.from("alarms").insert({ user_id: userId, time, repeat_days: days });
    if (error) return { error: "保存できませんでした" };
  }
  refresh();
  return {};
}

/** ON/OFF を切り替える */
export async function setAlarmEnabled(id: string, enabled: boolean): Promise<ActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("alarms").update({ enabled }).eq("id", id).select("id").maybeSingle();
  if (error || !data) return { error: "切り替えられませんでした" };
  refresh();
  return {};
}

export async function deleteAlarm(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("alarms").delete().eq("id", id).select("id").maybeSingle();
  if (error || !data) return { error: "削除できませんでした" };
  refresh();
  return {};
}
