import Link from "next/link";

import { logout } from "@/app/login/actions";
import { AlarmSettings } from "@/components/settings/AlarmSettings";
import { formatDateTime } from "@/lib/format";
import { isSimulatorEnabled } from "@/lib/simulator";
import { createClient, getUserId } from "@/lib/supabase/server";

// 設定。アラーム（T-102）・アカウント。通知・キャラボイスは T-103 で作る。
export default async function SettingsPage() {
  const supabase = await createClient();
  const userId = await getUserId();
  const [profileResult, alarmsResult, nextAlarmResult, activeResult] = await Promise.all([
    supabase.from("users").select("display_name, email").maybeSingle(),
    supabase.from("alarms").select("id, time, repeat_days, enabled").order("time"),
    supabase.rpc("next_alarm_at", { p_user_id: userId! }).maybeSingle(),
    supabase.from("sleep_sessions").select("planned_wake_time").eq("status", "in_progress").maybeSingle(),
  ]);
  if (alarmsResult.error) throw new Error(`アラームを読めませんでした: ${alarmsResult.error.message}`);
  const profile = profileResult.data;
  const nextAlarm = nextAlarmResult.data;
  const active = activeResult.data;

  return (
    <>
      <div className="card">
        <h2 className="card-title">⏰ アラーム</h2>
        {active ? (
          <p className="hint">
            いま記録中です。今夜は {formatDateTime(active.planned_wake_time)} に起こします（ここで変えると、次の夜から反映されます）。
          </p>
        ) : (
          nextAlarm && <p className="hint">次に鳴るのは {formatDateTime(nextAlarm.ring_at)} です。</p>
        )}
        <AlarmSettings alarms={alarmsResult.data} />
      </div>

      <div className="card">
        <h2 className="card-title">👤 アカウント</h2>
        <div className="row">
          <span className="row-label">名前</span>
          <span className="row-sub">{profile?.display_name}</span>
        </div>
        <div className="row">
          <span className="row-label">メールアドレス</span>
          <span className="row-sub">{profile?.email}</span>
        </div>
        <form action={logout}>
          <button type="submit" className="btn btn-secondary">
            ログアウト
          </button>
        </form>
      </div>

      {isSimulatorEnabled() && (
        <div className="card">
          <h2 className="card-title">🔧 開発用</h2>
          <p className="muted">実機がなくても、鶏の代わりにデータを送って1日の流れを試せます。</p>
          <Link href="/dev/simulator" className="btn btn-secondary">
            デバイスシミュレーターを開く
          </Link>
        </div>
      )}

      <div className="card">
        <div className="eyebrow">ABOUT</div>
        <p className="muted">ねるコッコ v0.1（開発中）</p>
      </div>
    </>
  );
}
