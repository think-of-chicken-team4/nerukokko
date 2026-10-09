import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { formatDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

const STATUS_LABEL = { in_progress: "記録中", completed: "完了", aborted: "中止" } as const;

const VIEWS = [
  { href: "/records", label: "今夜" },
  { href: "/records?view=week", label: "週間" },
] as const;

// 記録。「今夜」（1晩の詳細、T-108）と「週間」（推移、T-109）を切り替える。
// いまはどちらも直近の睡眠セッションの一覧だけ。
export default async function RecordsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view } = await searchParams;
  const isWeek = view === "week";

  const supabase = await createClient();
  const { data: sessions } = await supabase
    .from("sleep_sessions")
    .select("id, start_time, status, score")
    .order("start_time", { ascending: false })
    .limit(isWeek ? 7 : 1);

  return (
    <>
      <SegmentedControl items={VIEWS} current={isWeek ? VIEWS[1].href : VIEWS[0].href} />
      <div className="card">
        <h2 className="card-title">{isWeek ? "📈 最近の睡眠" : "🛏 直近の睡眠"}</h2>
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
    </>
  );
}
