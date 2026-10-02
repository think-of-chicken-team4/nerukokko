import { redirect } from "next/navigation";

import { BottomNav } from "@/components/BottomNav";
import { StatusBar } from "@/components/StatusBar";
import { isOnline } from "@/lib/data/devices";
import { getCurrentPhase } from "@/lib/data/phase";
import { createClient } from "@/lib/supabase/server";

// ログイン後の画面の共通の枠：時間帯に合わせた背景・上部のステータス・下部のタブ
export default async function MainLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims) {
    redirect("/login");
  }

  const [current, chickenResult] = await Promise.all([
    getCurrentPhase(supabase),
    supabase.from("devices").select("last_seen").eq("type", "chicken").maybeSingle(),
  ]);
  const chicken = chickenResult.data;

  return (
    <div className="phase-screen" data-phase={current.phase}>
      <div className="mx-auto flex min-h-dvh max-w-[430px] flex-col">
        <StatusBar phase={current.phase} chickenOnline={chicken ? isOnline(chicken.last_seen) : null} />
        <main className="flex-1 px-4 pt-4 pb-28">{children}</main>
        <BottomNav />
      </div>
    </div>
  );
}
