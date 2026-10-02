import Link from "next/link";

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
            <div
              className="mx-auto mt-1.5 mb-2.5 flex size-32 items-center justify-center rounded-full"
              style={{ background: `conic-gradient(var(--color-gold) ${score * 3.6}deg, var(--track) 0deg)` }}
            >
              <div className="flex size-24 flex-col items-center justify-center rounded-full bg-[#fffaf2]">
                <div className="font-num text-[34px] font-bold">{score}</div>
                <div className="text-[10px] text-[var(--fg-dim)]">/ 100</div>
              </div>
            </div>
            <span className="pill pill-gold">{scoreLabel(score)}</span>
          </>
        )}
      </div>

      {comment && (
        <div className="chat-bubble">
          <div className="text-[22px]" aria-hidden>
            🐔
          </div>
          <div>{comment}</div>
        </div>
      )}

      <div className="card">
        <h2 className="card-title">🌙 昨夜のサマリー</h2>
        <div className="stat-grid">
          <div className="stat">
            <div className="stat-label">🔄 寝返り</div>
            <div className="stat-value">{counts.turns}回</div>
          </div>
          <div className="stat">
            <div className="stat-label">😮 いびき・寝言</div>
            <div className="stat-value">{counts.snores}回</div>
          </div>
          <div className="stat">
            <div className="stat-label">🛏 寝ていた時間</div>
            <div className="stat-value">{durationText(session.start_time, session.actual_wake_time)}</div>
          </div>
          <div className="stat">
            <div className="stat-label">⏰ 起きるまで</div>
            <div className="stat-value">{wakeDelayText(session.planned_wake_time, session.actual_wake_time)}</div>
          </div>
        </div>
      </div>

      <Link href="/records" className="btn btn-secondary">
        📊 記録をもっと見る
      </Link>
    </>
  );
}
