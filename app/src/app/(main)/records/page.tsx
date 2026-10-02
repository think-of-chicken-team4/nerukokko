import { formatDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

const STATUS_LABEL = { in_progress: "記録中", completed: "完了", aborted: "中止" } as const;

// 記録。いまは直近の睡眠セッションの一覧だけ。グラフなどは T-108（1晩）・T-109（週間）で作る。
export default async function RecordsPage() {
  const supabase = await createClient();
  const { data: sessions } = await supabase
    .from("sleep_sessions")
    .select("id, start_time, status, score")
    .order("start_time", { ascending: false })
    .limit(7);

  return (
    <div className="card">
      <h2 className="card-title">📈 最近の睡眠</h2>
      {!sessions || sessions.length === 0 ? (
        <p className="muted">まだ記録がありません。夜に「眠りにつく」を押すと記録が始まります。</p>
      ) : (
        sessions.map((session) => (
          <div key={session.id} className="row">
            <div>
              <div className="row-label">{formatDateTime(session.start_time)}</div>
              <div className="row-sub">{STATUS_LABEL[session.status as keyof typeof STATUS_LABEL]}</div>
            </div>
            <div className="font-num text-lg font-bold">{session.score ?? "—"}</div>
          </div>
        ))
      )}
    </div>
  );
}
