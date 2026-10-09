import Link from "next/link";

import { ChickenBubble } from "@/components/ui/ChickenBubble";
import { ScoreRing } from "@/components/ui/ScoreRing";
import { Stat, StatGrid } from "@/components/ui/Stat";
import type { MorningData } from "@/lib/data/sleep";
import { scoreLabel } from "@/types/score";

function durationText(startTime: string, endTime: string | null): string {
  if (!endTime) return "—";
  const hours = (new Date(endTime).getTime() - new Date(startTime).getTime()) / 3600_000;
  return `${hours.toFixed(1)}h`;
}

function wakeDelayText(planned: string, actual: string | null): string {
  if (!actual) return "—";
  const seconds = Math.round((new Date(actual).getTime() - new Date(planned).getTime()) / 1000);
  if (seconds <= 0) return "アラーム前";
  return seconds < 120 ? `${seconds}秒` : `${Math.round(seconds / 60)}分`;
}

// 朝の振り返り：スコアの円グラフ・ラベル・にわとりのコメント・昨夜のサマリー
export function MorningView({ data }: { data: MorningData }) {
  const { session, comment, counts } = data;
  const score = session.score;

  return (
    <>
      <div className="card text-center">
        <div className="eyebrow">睡眠スコア</div>
        {score === null ? (
          <p className="muted py-6">スコアを計算しています…</p>
        ) : (
          <>
            <ScoreRing score={score} />
            <span className="pill pill-gold">{scoreLabel(score)}</span>
          </>
        )}
      </div>

      {comment && (
        <ChickenBubble>{comment}</ChickenBubble>
      )}

      <div className="card">
        <h2 className="card-title">🌙 昨夜のサマリー</h2>
        <StatGrid>
          <Stat label="🔄 寝返り" value={`${counts.turns}回`} />
          <Stat label="😮 いびき・寝言" value={`${counts.snores}回`} />
          <Stat label="🛏 寝ていた時間" value={durationText(session.start_time, session.actual_wake_time)} />
          <Stat label="⏰ 起きるまで" value={wakeDelayText(session.planned_wake_time, session.actual_wake_time)} />
        </StatGrid>
      </div>

      <Link href="/records" className="btn btn-secondary">
        📊 記録をもっと見る
      </Link>
    </>
  );
}
