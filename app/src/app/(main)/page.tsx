import { DuskView } from "@/components/home/DuskView";
import { MorningView } from "@/components/home/MorningView";
import { PrepView } from "@/components/home/PrepView";
import { SessionWatcher } from "@/components/home/SessionWatcher";
import { SleepMonitor } from "@/components/home/SleepMonitor";
import { getDeviceReadiness } from "@/lib/data/devices";
import { getEveningData } from "@/lib/data/evening";
import { getHomePhase } from "@/lib/data/phase";
import { getMorningData, getSleepCounts } from "@/lib/data/sleep";
import { createClient, getUserId } from "@/lib/supabase/server";

// ホーム。DB の状態（と「就寝準備へ進む」の cookie）から判定したフェーズに合わせて表示を切り替える（docs/dev-plan.md §5-2）
export default async function HomePage() {
  const supabase = await createClient();
  const userId = (await getUserId())!;
  const current = await getHomePhase(supabase);
  const session = current.session;

  if (current.phase === "sleeping" && session) {
    const [counts, devices] = await Promise.all([
      getSleepCounts(supabase, session.id),
      getDeviceReadiness(supabase, true),
    ]);
    return (
      <>
        <SessionWatcher sessionId={session.id} refreshAt={session.planned_wake_time} />
        <SleepMonitor
          sessionId={session.id}
          startTime={session.start_time}
          plannedWakeTime={session.planned_wake_time}
          initial={counts}
        />
        {devices.chickenOnline === false && (
          <p className="hint mt-3">⚠️ にわとりがオフラインです。計測データが届いていません（電源と Wi-Fi を確かめてください）。</p>
        )}
        {devices.chickenOnline && devices.eggPlace === "nest" && (
          <p className="hint mt-3">⚠️ たまごが巣の中にあります。ベッドに置かないと寝返りが計測されません。</p>
        )}
      </>
    );
  }

  if (current.phase === "wake" && session) {
    return (
      <>
        <SessionWatcher sessionId={session.id} pollMs={15_000} />
        <div className="card wake-hero">
          <div className="wake-hero-eyes" aria-hidden>
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
          <SessionWatcher sessionId={session.id} userId={userId} pollMs={data.session.score === null ? 5_000 : undefined} />
          <MorningView data={data} />
        </>
      );
    }
  }

  // 夕方確認・就寝準備（ほかの端末や鶏で記録が始まったら SessionWatcher が画面を読み直す）
  const [evening, profileResult] = await Promise.all([
    getEveningData(supabase, userId),
    supabase.from("users").select("display_name").maybeSingle(),
  ]);
  return (
    <>
      <SessionWatcher userId={userId} />
      {current.phase === "prep" ? (
        <PrepView data={evening} />
      ) : (
        <DuskView name={profileResult.data?.display_name ?? ""} data={evening} />
      )}
    </>
  );
}
