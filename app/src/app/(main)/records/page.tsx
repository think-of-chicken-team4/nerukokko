import { NightRecordView } from "@/components/records/NightRecordView";
import { WeekView } from "@/components/records/WeekView";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { getNightRecord } from "@/lib/data/night";
import { getWeekRecord } from "@/lib/data/week";
import { createClient } from "@/lib/supabase/server";

const VIEWS = [
  { href: "/records", label: "今夜" },
  { href: "/records?view=week", label: "週間" },
] as const;

// 記録。「今夜」＝いちばん新しい夜（中止したものを除く）の詳しい記録（T-108）、「週間」＝直近7日の推移（T-109）
export default async function RecordsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view } = await searchParams;
  const isWeek = view === "week";

  const supabase = await createClient();
  if (!isWeek) {
    // 「今夜」は中止した記録を飛ばして、いちばん新しい夜を出す（中止した記録は「週間」の一覧には出る）
    const { data: latest, error } = await supabase
      .from("sleep_sessions")
      .select("id")
      .neq("status", "aborted")
      .order("start_time", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`睡眠記録を読めませんでした: ${error.message}`);
    const record = latest ? await getNightRecord(supabase, latest.id) : null;
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
      <WeekView week={await getWeekRecord(supabase)} />
    </>
  );
}
