import Link from "next/link";

import { NightRecordView } from "@/components/records/NightRecordView";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { getNightRecord } from "@/lib/data/night";
import { formatDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

const STATUS_LABEL = { in_progress: "記録中", completed: "完了", aborted: "中止" } as const;

const VIEWS = [
  { href: "/records", label: "今夜" },
  { href: "/records?view=week", label: "週間" },
] as const;

// 記録。「今夜」＝いちばん新しい夜（中止したものを除く）の詳しい記録（T-108）、「週間」＝推移（T-109。いまは一覧だけ）
export default async function RecordsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view } = await searchParams;
  const isWeek = view === "week";

  const supabase = await createClient();
  // 「今夜」は中止した記録を飛ばして、いちばん新しい夜を出す（中止した記録は「週間」の一覧には出る）
  let query = supabase.from("sleep_sessions").select("id, start_time, status, score");
  if (!isWeek) query = query.neq("status", "aborted");
  const { data: sessions, error } = await query.order("start_time", { ascending: false }).limit(isWeek ? 7 : 1);
  if (error) throw new Error(`睡眠記録を読めませんでした: ${error.message}`);

  if (!isWeek) {
    const record = sessions[0] ? await getNightRecord(supabase, sessions[0].id) : null;
    return (
      <>
        <SegmentedControl items={VIEWS} current={VIEWS[0].href} />
        {record ? (
          <NightRecordView record={record} />
        ) : (
          <div className="card">
            <p className="muted">まだ記録がありません。夜に「眠りにつく」を押すと記録が始まります。</p>
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <SegmentedControl items={VIEWS} current={VIEWS[1].href} />
      <div className="card">
        <h2 className="card-title">📈 最近の睡眠</h2>
        {sessions.length === 0 ? (
          <p className="muted">まだ記録がありません。夜に「眠りにつく」を押すと記録が始まります。</p>
        ) : (
          sessions.map((session) => (
            <Link key={session.id} href={`/records/${session.id}`} className="row">
              <div>
                <div className="row-label">{formatDateTime(session.start_time)}</div>
                <div className="row-sub">{STATUS_LABEL[session.status as keyof typeof STATUS_LABEL]}</div>
              </div>
              <div className="font-num text-lg font-bold">{session.score ?? "—"} ›</div>
            </Link>
          ))
        )}
      </div>
    </>
  );
}
