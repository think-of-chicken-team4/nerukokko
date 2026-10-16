import { PHASES, type Phase } from "@/lib/phase";

// 1日の5フェーズを円を5分割したダイヤルで表し、今のフェーズを光らせる（プロトタイプの cycle-dial）
const SIZE = 54;
const CENTER = SIZE / 2;
const RADIUS = 21;
const STROKE = 6;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const SEGMENT = CIRCUMFERENCE / PHASES.length;

export function PhaseDial({ phase }: { phase: Phase }) {
  const current = PHASES.indexOf(phase);
  const markerAngle = ((current * 360) / PHASES.length + 36 - 90) * (Math.PI / 180);

  return (
    <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden>
      {PHASES.map((p, i) => (
        <circle
          key={p}
          cx={CENTER}
          cy={CENTER}
          r={RADIUS}
          fill="none"
          stroke={i < current ? "var(--color-gold)" : i === current ? "#FF9F5A" : "rgba(255,255,255,.22)"}
          strokeWidth={STROKE}
          strokeDasharray={`${SEGMENT - 3} ${CIRCUMFERENCE - (SEGMENT - 3)}`}
          strokeDashoffset={-i * SEGMENT}
          strokeLinecap="round"
          transform={`rotate(-90 ${CENTER} ${CENTER})`}
        />
      ))}
      <circle cx={CENTER} cy={CENTER} r={14} fill="rgba(0,0,0,.25)" />
      <text x={CENTER} y={CENTER + 6} fontSize={16} textAnchor="middle">
        🐔
      </text>
      <circle
        cx={CENTER + RADIUS * Math.cos(markerAngle)}
        cy={CENTER + RADIUS * Math.sin(markerAngle)}
        r={3.5}
        fill="#fff"
      />
    </svg>
  );
}
