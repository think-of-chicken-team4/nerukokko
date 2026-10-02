import Link from "next/link";

import { getCurrentPhase } from "@/lib/data/phase";
import { formatDateTime } from "@/lib/format";
import { PHASE_LABEL } from "@/lib/phase";
import { createClient, getUserId } from "@/lib/supabase/server";

const GREETING = {
  dusk: "今日も一日おつかれさまコケ！夜の準備、いっしょにやろうコケ🐔",
  sleeping: "ぐっすり眠ってねコケ。ちゃんと見守ってるコケ🌙",
  wake: "コケコッコー！朝だコケ！たまごを巣に戻してほしいコケ！",
  morning: "おはようコケ！昨夜の睡眠をふりかえろうコケ☀️",
} as const;

// ホーム。いまは「今のフェーズ」と「次のアラーム」を表示する。
// フェーズごとの画面（夕方確認・就寝準備・睡眠記録・起床制御・朝の振り返り）は T-105 で作る。
export default async function HomePage() {
  const supabase = await createClient();
  const userId = await getUserId();

  const [profileResult, nextAlarmResult, current] = await Promise.all([
    supabase.from("users").select("display_name").maybeSingle(),
    supabase.rpc("next_alarm_at", { p_user_id: userId! }).maybeSingle(),
    getCurrentPhase(supabase),
  ]);
  const displayName = profileResult.data?.display_name ?? "";
  const nextAlarm = nextAlarmResult.data;

  return (
    <>
      <div className="chat-bubble">
        <div className="text-[22px]" aria-hidden>
          🐔
        </div>
        <div>
          {displayName && <span className="font-bold">{displayName}さん、</span>}
          {GREETING[current.phase]}
        </div>
      </div>

      <div className="card">
        <div className="eyebrow">いまのフェーズ</div>
        <div className="font-maru text-lg font-bold">{PHASE_LABEL[current.phase]}</div>
      </div>

      <div className="card">
        <h2 className="card-title">⏰ 次のアラーム</h2>
        {nextAlarm ? (
          <div className="font-num text-2xl font-bold">{formatDateTime(nextAlarm.ring_at)}</div>
        ) : (
          <p className="muted">
            アラームが設定されていません。
            <Link href="/settings" className="underline">
              設定
            </Link>
            から追加してください。
          </p>
        )}
      </div>
    </>
  );
}
