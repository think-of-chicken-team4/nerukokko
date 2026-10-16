import Link from "next/link";

import { ScoreBars } from "@/components/charts/ScoreBars";
import { Stat, StatGrid } from "@/components/ui/Stat";
import type { WeekRecord } from "@/lib/data/week";
import { formatDateTime } from "@/lib/format";
import { NO_DATA_LABEL, scoreState } from "@/types/score";

const STATUS_LABEL = { in_progress: "記録中", completed: "完了", aborted: "中止" } as const;

// 記録（週間）：スコアの推移・平均・日別の寝返り/いびき回数（APP-09、T-109）
export function WeekView({ week }: { week: WeekRecord }) {
  const scoredDays = week.days.filter((d) => d.score !== null).length;

  return (
    <>
      <div className="card">
        <h2 className="card-title">📈 スコアの推移</h2>
        {scoredDays === 0 ? <p className="muted">データなし</p> : <ScoreBars days={week.days} average={week.average} />}
      </div>

      <div className="card">
        <StatGrid>
          <Stat label="⭐ 平均スコア" value={week.average === null ? "—" : `${week.average}点`} />
          <Stat label="🌙 記録した夜" value={`${scoredDays} / ${week.days.length}日`} />
        </StatGrid>
      </div>

      <div className="card">
        <h2 className="card-title">🔄 夜ごとの寝返り・いびき</h2>
        {week.nights.length === 0 ? (
          <p className="muted">この7日間の記録はありません。</p>
        ) : (
          week.nights.map((night) => (
            <Link key={night.id} href={`/records/${night.id}`} className="row">
              <div>
                <div className="row-label">{formatDateTime(night.start_time)}</div>
                <div className="row-sub">
                  {night.status === "aborted"
                    ? STATUS_LABEL.aborted
                    : scoreState(night.score, night.score_details) === "no_data"
                      ? NO_DATA_LABEL
                      : `寝返り ${night.turns}回・いびき ${night.snores}回`}
                </div>
              </div>
              <div className="font-num text-lg font-bold">
                {night.score ?? (night.status === "in_progress" ? STATUS_LABEL.in_progress : "—")} ›
              </div>
            </Link>
          ))
        )}
      </div>
    </>
  );
}
