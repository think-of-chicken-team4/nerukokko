import { hourTicks } from "@/lib/chart";
import { formatTime } from "@/lib/format";

type Props = {
  range: { start: number; end: number };
  motions: number[];
  audio: { t: number; type: "snore" | "sleep_talk" }[];
};

const W = 326;
const H = 112;
const LEFT = 76;
const RIGHT = 8;
const LANES = { turn: 30, sound: 70 } as const;
const AXIS_Y = 96;

// 寝返り・いびき/寝言のタイムライン（APP-08）。行ごとに見出しがあるので、色だけで見分けなくてよい。点に触れると時刻が出る
export function EventTimeline({ range, motions, audio }: Props) {
  const x = (t: number) => LEFT + ((t - range.start) / (range.end - range.start)) * (W - LEFT - RIGHT);
  const snores = audio.filter((a) => a.type === "snore").length;
  const talks = audio.length - snores;

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full"
        role="img"
        aria-label={`寝返り${motions.length}回、いびき${snores}回、寝言${talks}回のタイムライン`}
      >
        {Object.entries(LANES).map(([key, y]) => (
          <g key={key}>
            <text x={0} y={y + 4} fontSize={10.5} fill="var(--fg-dim)">
              {key === "turn" ? "寝返り" : "いびき・寝言"}
            </text>
            <line x1={LEFT} x2={W - RIGHT} y1={y} y2={y} stroke="var(--track)" strokeDasharray="3 4" />
          </g>
        ))}
        {hourTicks(range.start, range.end).map((tick) => (
          <text key={tick.t} x={x(tick.t)} y={AXIS_Y + 12} fontSize={10} fill="var(--fg-dim)" textAnchor="middle">
            {tick.label}
          </text>
        ))}
        {motions.map((t, i) => (
          <circle key={`m${i}`} cx={x(t)} cy={LANES.turn} r={4} fill="var(--chart-1)" stroke="var(--chart-ring)" strokeWidth={2}>
            <title>{`${formatTime(new Date(t))} 寝返り`}</title>
          </circle>
        ))}
        {audio.map((a, i) =>
          a.type === "snore" ? (
            <circle key={`a${i}`} cx={x(a.t)} cy={LANES.sound} r={4} fill="var(--chart-2)" stroke="var(--chart-ring)" strokeWidth={2}>
              <title>{`${formatTime(new Date(a.t))} いびき`}</title>
            </circle>
          ) : (
            // 寝言は白抜きの丸にして、いびきと形でも見分けられるようにする
            <circle key={`a${i}`} cx={x(a.t)} cy={LANES.sound} r={4} fill="var(--chart-ring)" stroke="var(--chart-2)" strokeWidth={2}>
              <title>{`${formatTime(new Date(a.t))} 寝言`}</title>
            </circle>
          ),
        )}
      </svg>
      <figcaption className="muted mt-1 flex flex-wrap gap-x-3">
        <span>
          <span className="legend-dot" style={{ background: "var(--chart-1)" }} aria-hidden /> 寝返り {motions.length}回
        </span>
        <span>
          <span className="legend-dot" style={{ background: "var(--chart-2)" }} aria-hidden /> いびき {snores}回
        </span>
        <span>
          <span className="legend-dot legend-dot-hollow" style={{ borderColor: "var(--chart-2)" }} aria-hidden /> 寝言 {talks}回
        </span>
      </figcaption>
    </figure>
  );
}
