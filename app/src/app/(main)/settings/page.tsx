import Link from "next/link";

import { logout } from "@/app/login/actions";
import { isSimulatorEnabled } from "@/lib/simulator";
import { createClient } from "@/lib/supabase/server";

// 設定。いまはアカウント情報とログアウトだけ。アラーム・通知・キャラボイスは T-102・T-103 で作る。
export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: profile } = await supabase.from("users").select("display_name, email").maybeSingle();

  return (
    <>
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
