"use client";

import { useState } from "react";

import { hourTicks, niceDomain, valueTicks } from "@/lib/chart";
import type { Point } from "@/lib/data/night";
import { formatTime } from "@/lib/format";

type Props = {
  /** 画面読み上げ用の名前（例：「呼吸数」） */
  label: string;
  points: Point[];
  range: { start: number; end: number };
  unit: string;
  /** 表示する小数の桁数 */
  digits: number;
  /** 縦軸の目盛りの間隔 */
  step: number;
  /** 縦軸の下限（明るさ・呼吸数など、負にならない量は 0） */
  floor?: number;
};

const W = 326;
const H = 120;
const LEFT = 30;
const RIGHT = 8;
const TOP = 16;
const BOTTOM = 18;
// これより間があいた点どうしは線でつながない（その間はデータがない）
const GAP_MS = 10 * 60 * 1000;

// 1本の折れ線グラフ（縦軸は1つだけ）。指でなぞる・カーソルを乗せると、その時刻の値を出す
export function LineChart({ label, points, range, unit, digits, step, floor }: Props) {
  const [active, setActive] = useState<Point | null>(null);
  const values = points.map((p) => p.v);
  const [lo, hi] = niceDomain(values, step, floor);
  const x = (t: number) => LEFT + ((t - range.start) / (range.end - range.start)) * (W - LEFT - RIGHT);
  const y = (v: number) => TOP + (1 - (v - lo) / (hi - lo)) * (H - TOP - BOTTOM);
  const fmt = (v: number) => `${v.toFixed(digits)}${unit}`;

  // 間があいたところで線を切る
  const segments: Point[][] = [];
  for (const p of points) {
    const last = segments.at(-1);
    if (last && p.t - last[last.length - 1].t <= GAP_MS) last.push(p);
    else segments.push([p]);
  }
  const yTicks = valueTicks([lo, hi], step);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;

  const pick = (clientX: number, rect: DOMRect) => {
    const t = range.start + (((clientX - rect.left) / rect.width) * W - LEFT) / (W - LEFT - RIGHT) * (range.end - range.start);
    let nearest = points[0];
    for (const p of points) if (Math.abs(p.t - t) < Math.abs(nearest.t - t)) nearest = p;
    setActive(nearest);
  };

  return (
    <figure className="m-0">
      {/* ふだんは平均・最小・最大、グラフに触れている間はその時刻の値を出す */}
      <div className="mb-1 h-4 text-[11px] text-[var(--fg-dim)]" aria-live="polite">
        {active ? (
          <span className="font-num font-bold text-[var(--fg)]">
            {formatTime(new Date(active.t))}　{fmt(active.v)}
          </span>
        ) : (
          <span>
            平均 {fmt(avg)}・最小 {fmt(Math.min(...values))}・最大 {fmt(Math.max(...values))}
          </span>
        )}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full touch-pan-y"
        role="img"
        aria-label={`${label}の推移。平均 ${fmt(avg)}、最小 ${fmt(Math.min(...values))}、最大 ${fmt(Math.max(...values))}`}
        onPointerMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
        onPointerDown={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
        onPointerLeave={() => setActive(null)}
      >
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={LEFT} x2={W - RIGHT} y1={y(v)} y2={y(v)} stroke="var(--track)" />
            <text x={LEFT - 4} y={y(v) + 3} fontSize={9.5} fill="var(--fg-dim)" textAnchor="end">
              {v.toFixed(step < 1 ? 1 : 0)}
            </text>
          </g>
        ))}
        {hourTicks(range.start, range.end).map((tick) => (
          <text key={tick.t} x={x(tick.t)} y={H - 4} fontSize={10} fill="var(--fg-dim)" textAnchor="middle">
            {tick.label}
          </text>
        ))}
        {segments.map((seg, i) =>
          seg.length === 1 ? (
            <circle key={i} cx={x(seg[0].t)} cy={y(seg[0].v)} r={2.5} fill="var(--chart-1)" />
          ) : (
            <polyline
              key={i}
              points={seg.map((p) => `${x(p.t)},${y(p.v)}`).join(" ")}
              fill="none"
              stroke="var(--chart-1)"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ),
        )}
        {active && (
          <g pointerEvents="none">
            <line x1={x(active.t)} x2={x(active.t)} y1={TOP} y2={H - BOTTOM} stroke="var(--fg-dim)" strokeWidth={1} />
            <circle cx={x(active.t)} cy={y(active.v)} r={4.5} fill="var(--chart-1)" stroke="var(--chart-ring)" strokeWidth={2} />
          </g>
        )}
      </svg>
    </figure>
  );
}
