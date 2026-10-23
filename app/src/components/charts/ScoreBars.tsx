"use client";

import { useState } from "react";

import type { WeekDay } from "@/lib/data/week";
import { formatMonthDayWeekday } from "@/lib/format";

const W = 326;
const H = 150;
const LEFT = 24;
const RIGHT = 4;
const TOP = 10;
const BOTTOM = 30;
const GAP = 10;

// 直近7日のスコア（0〜100）の棒グラフ（APP-09）。棒に触れるとその日の点数が出る。平均は点線
export function ScoreBars({ days, average }: { days: WeekDay[]; average: number | null }) {
  const [active, setActive] = useState<number | null>(null);
  const slot = (W - LEFT - RIGHT) / days.length;
  const barW = slot - GAP;
  const y = (v: number) => TOP + (1 - v / 100) * (H - TOP - BOTTOM);
  const base = y(0);
  const activeDay = active === null ? null : days[active];

  return (
    <figure className="m-0">
      <div className="mb-1 h-4 text-[11px] text-[var(--fg-dim)]" aria-live="polite">
        {activeDay ? (
          <span className="font-num font-bold text-[var(--fg)]">
            {formatMonthDayWeekday(activeDay.date)}　{activeDay.score === null ? "記録なし" : `${activeDay.score}点`}
          </span>
        ) : (
          <span>棒に触れると、その日の点数が出ます</span>
        )}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full touch-pan-y"
        role="img"
        aria-label={`直近${days.length}日のスコア。${days
          .map((d) => `${formatMonthDayWeekday(d.date)} ${d.score === null ? "記録なし" : `${d.score}点`}`)
          .join("、")}`}
        onPointerLeave={() => setActive(null)}
      >
        {[0, 50, 100].map((v) => (
          <g key={v}>
            <line x1={LEFT} x2={W - RIGHT} y1={y(v)} y2={y(v)} stroke="var(--track)" />
            <text x={LEFT - 4} y={y(v) + 3} fontSize={9.5} fill="var(--fg-dim)" textAnchor="end">
              {v}
            </text>
          </g>
        ))}
        {days.map((d, i) => {
          const x = LEFT + i * slot + GAP / 2;
          const [md, wd] = formatMonthDayWeekday(d.date).split("(");
          return (
            <g
              key={d.dateKey}
              onPointerEnter={() => setActive(i)}
              onPointerDown={() => setActive(i)}
              opacity={active === null || active === i ? 1 : 0.55}
            >
              {/* 触れやすいように、棒より広い透明の当たり判定を置く */}
              <rect x={LEFT + i * slot} y={TOP} width={slot} height={H - TOP} fill="transparent" />
              {d.score === null ? (
                <text x={x + barW / 2} y={base - 4} fontSize={10} fill="var(--fg-dim)" textAnchor="middle">
                  —
                </text>
              ) : (
                // 上の角だけ丸め、下は基準線にそろえる
                <path
                  d={`M${x},${base} V${y(d.score) + 4} Q${x},${y(d.score)} ${x + 4},${y(d.score)} H${x + barW - 4} Q${x + barW},${y(d.score)} ${x + barW},${y(d.score) + 4} V${base} Z`}
                  fill="var(--chart-1)"
                />
              )}
              <text x={x + barW / 2} y={H - 16} fontSize={9.5} fill="var(--fg-dim)" textAnchor="middle">
                {md}
              </text>
              <text x={x + barW / 2} y={H - 4} fontSize={9.5} fill="var(--fg-dim)" textAnchor="middle">
                ({wd}
              </text>
            </g>
          );
        })}
        {average !== null && (
          <line
            x1={LEFT}
            x2={W - RIGHT}
            y1={y(average)}
            y2={y(average)}
            stroke="var(--fg-dim)"
            strokeDasharray="4 3"
            pointerEvents="none"
          />
        )}
      </svg>
      {/* 平均の文字を線の上に置くと棒と重なるので、説明はグラフの下に書く */}
      {average !== null && (
        <figcaption className="muted mt-1">
          <span className="legend-dash" aria-hidden /> 点線は平均（{average}点）
        </figcaption>
      )}
    </figure>
  );
}
