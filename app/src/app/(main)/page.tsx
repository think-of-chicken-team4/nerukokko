import Link from "next/link";

import { MorningView } from "@/components/home/MorningView";
import { SessionWatcher } from "@/components/home/SessionWatcher";
import { SleepMonitor } from "@/components/home/SleepMonitor";
import { StartSleepButton } from "@/components/home/StartSleepButton";
import { getCurrentPhase } from "@/lib/data/phase";
import { getMorningData, getSleepCounts } from "@/lib/data/sleep";
import { formatDateTime } from "@/lib/format";
import { createClient, getUserId } from "@/lib/supabase/server";

// ホーム。DB の状態から判定したフェーズに合わせて表示を切り替える（docs/dev-plan.md §5-2）。
// 就寝準備（prep）の画面と夕方の就寝提案は、ステップ3・4で作る。
export default async function HomePage() {
  const supabase = await createClient();
  const userId = await getUserId();
  const [current, profileResult] = await Promise.all([
    getCurrentPhase(supabase),
    supabase.from("users").select("display_name").maybeSingle(),
  ]);
  const name = profileResult.data?.display_name ?? "";
  const session = current.session;

  if (current.phase === "sleeping" && session) {
    const counts = await getSleepCounts(supabase, session.id);
    return (
      <>
        <SessionWatcher sessionId={session.id} refreshAt={session.planned_wake_time} />
        <SleepMonitor
          sessionId={session.id}
          startTime={session.start_time}
          plannedWakeTime={session.planned_wake_time}
          initial={counts}
        />
      </>
    );
  }

  if (current.phase === "wake" && session) {
    return (
      <>
        <SessionWatcher sessionId={session.id} pollMs={15_000} />
        <div className="card py-5 text-center">
          <div className="animate-pulse text-5xl" aria-hidden>
            🐔💡
          </div>
          <div className="mt-2 font-maru text-xl font-black">コケコッコー！起床時刻です！</div>
          <p className="muted mt-1.5">にわとりの目が光って、アラームが鳴っています</p>
        </div>
        <div className="card">
          <h2 className="card-title">🥚 二度寝防止のしくみ</h2>
          <p className="muted">たまごを「巣」に戻す（＝充電が始まる）と、アラームが止まるコケ。ベッドから出るまで鳴り続けます。</p>
        </div>
      </>
    );
  }

  if (current.phase === "morning" && session) {
    const data = await getMorningData(supabase, session.id);
    if (data) {
      return (
        <>
          <SessionWatcher sessionId={session.id} userId={userId!} pollMs={data.session.score === null ? 5_000 : undefined} />
          <MorningView data={data} />
        </>
      );
    }
  }

  // 夕方確認（就寝前）
  const { data: nextAlarm } = await supabase.rpc("next_alarm_at", { p_user_id: userId! }).maybeSingle();
  return (
    <>
      <SessionWatcher userId={userId!} />
      <div className="chat-bubble">
        <div className="text-[22px]" aria-hidden>
          🐔
        </div>
        <div>
          {name && <span className="font-bold">{name}さん、</span>}
          今日も一日おつかれさまコケ！夜の準備ができたら「眠りにつく」を押してほしいコケ🌙
        </div>
      </div>

      <div className="card">
        <h2 className="card-title">🌙 今夜の設定</h2>
        <div className="row">
          <div>
            <div className="row-label">起床アラーム</div>
            <div className="row-sub">
              <Link href="/settings" className="underline">
                設定
              </Link>
              で変更できます
            </div>
          </div>
          <span className="pill pill-blue">{nextAlarm ? formatDateTime(nextAlarm.ring_at) : "未設定（8時間後）"}</span>
        </div>
      </div>

      <StartSleepButton />
    </>
  );
}
