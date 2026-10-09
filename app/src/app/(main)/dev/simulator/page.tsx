import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { isSimulatorEnabled } from "@/lib/simulator";
import { createClient, getUserId } from "@/lib/supabase/server";

import { SimulatorPanel } from "./SimulatorPanel";

export const metadata: Metadata = {
  title: "デバイスシミュレーター | ねるコッコ",
};

// 実機（鶏・たまご）の代わりに API へデータを送る開発・デモ用の画面（docs/dev-plan.md T-111）
export default async function SimulatorPage() {
  if (!isSimulatorEnabled()) notFound();
  const supabase = await createClient();
  const [userId, { data: session }] = await Promise.all([
    getUserId(),
    supabase.from("sleep_sessions").select("id, start_time, planned_wake_time").eq("status", "in_progress").maybeSingle(),
  ]);
  return <SimulatorPanel userId={userId!} initialSession={session} />;
}
