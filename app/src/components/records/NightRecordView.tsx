import { EventTimeline } from "@/components/charts/EventTimeline";
import { LineChart } from "@/components/charts/LineChart";
import { LogItem } from "@/components/ui/LogItem";
import type { NightRecord, Point } from "@/lib/data/night";
import { formatDateTime, formatTime } from "@/lib/format";
import { scoreLabel } from "@/types/score";

const STATUS = {
  in_progress: { label: "記録中", pill: "pill-blue" },
  completed: { label: "完了", pill: "pill-gold" },
  aborted: { label: "中止", pill: "pill-pink" },
} as const;

function NoData() {
  return <p className="muted">データなし</p>;
}

function durationText(start: number, end: number): string {
  const minutes = Math.round((end - start) / 60_000);
  return `${Math.floor(minutes / 60)}時間${minutes % 60}分`;
}

function Chart(props: {
  title: string;
  points: Point[];
  range: NightRecord["range"];
  unit: string;
  digits: number;
  step: number;
  floor?: number;
}) {
  const { title, ...chart } = props;
  return (
    <div className="mt-3 first:mt-0">
      <div className="row-label mb-1">{title}</div>
      {chart.points.length === 0 ? <NoData /> : <LineChart label={title} {...chart} />}
    </div>
  );
}

// 記録（1晩）：タイムライン・呼吸数・温湿度・照度のグラフ・会話ログ（APP-08、T-108）
export function NightRecordView({ record }: { record: NightRecord }) {
  const { session, range } = record;
  const status = STATUS[session.status as keyof typeof STATUS] ?? STATUS.completed;
  // 完了しているのに起床時刻がない＝巣に戻らないまま自動で締めた夜（T-209）
  const autoClosed = session.status === "completed" && session.actual_wake_time === null;
  const hasEvents = record.motions.length > 0 || record.audio.length > 0;

  return (
    <>
      <div className="card">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="eyebrow">{formatDateTime(session.start_time)} の夜</div>
            <div className="text-sm">
              就寝 {formatTime(session.start_time)} 〜 {session.end_time ? `終了 ${formatTime(session.end_time)}` : "記録中"}
              <span className="muted ml-1">（{durationText(range.start, range.end)}）</span>
            </div>
          </div>
          <span className={`pill ${status.pill}`}>{status.label}</span>
        </div>
        {autoClosed && <p className="hint mt-2 mb-0">⚠️ 起床を検知できなかったので、起床予定の3時間後で記録を締めました。</p>}
        {session.score !== null && (
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-num text-[28px] font-bold">{session.score}</span>
            <span className="muted">点・{scoreLabel(session.score)}</span>
          </div>
        )}
      </div>

      <div className="card">
        <h2 className="card-title">🛏 寝返り・いびきのタイムライン</h2>
        {hasEvents ? <EventTimeline range={range} motions={record.motions} audio={record.audio} /> : <NoData />}
      </div>

      <div className="card">
        <h2 className="card-title">🫁 呼吸数</h2>
        {record.breathing.length === 0 ? (
          <NoData />
        ) : (
          <LineChart label="呼吸数" points={record.breathing} range={range} unit="回/分" digits={1} step={2} floor={0} />
        )}
      </div>

      <div className="card">
        <h2 className="card-title">🌡 部屋の環境</h2>
        <Chart title="室温" points={record.temperature} range={range} unit="℃" digits={1} step={1} />
        <Chart title="湿度" points={record.humidity} range={range} unit="%" digits={0} step={5} floor={0} />
        <Chart title="明るさ" points={record.illuminance} range={range} unit="lx" digits={0} step={5} floor={0} />
      </div>

      <div className="card">
        <h2 className="card-title">💬 会話ログ</h2>
        {record.messages.length === 0 ? (
          <NoData />
        ) : (
          record.messages.map((m, i) => (
            <LogItem key={i} tone={m.role === "assistant" ? "gold" : "pink"}>
              <span className="font-num">{formatTime(m.created_at)}</span> {m.role === "assistant" ? "🐔" : "🧑"} {m.content}
            </LogItem>
          ))
        )}
      </div>
    </>
  );
}
