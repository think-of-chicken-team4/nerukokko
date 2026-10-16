// グラフの軸の計算（日本時間の時刻の目盛り、縦軸のきりのよい範囲）

import { jstHour, jstMonthDay } from "./format";

const HOUR = 60 * 60 * 1000;

/** 横軸の目盛りの間隔（時間）の候補。目盛りが6本以下になる最小のものを使う */
const HOUR_STEPS = [1, 2, 3, 4, 6, 12, 24, 48, 72, 168];
const MAX_TICKS = 6;

/**
 * 横軸の目盛り：範囲内のちょうどの時刻（日本時間）。長い記録ほど間隔を広げ、1日以上の間隔なら日付（例：10/3）にする。
 * 日本時間は UTC+9 で分のずれがないので、UTC のちょうどの時刻がそのまま日本時間のちょうどの時刻になる。
 */
export function hourTicks(start: number, end: number): { t: number; label: string }[] {
  const hours = (end - start) / HOUR;
  const step = HOUR_STEPS.find((s) => hours / s <= MAX_TICKS) ?? HOUR_STEPS[HOUR_STEPS.length - 1];
  const ticks: { t: number; label: string }[] = [];
  for (let t = Math.ceil(start / HOUR) * HOUR; t <= end; t += HOUR) {
    const date = new Date(t);
    const hour = jstHour(date);
    if (step < 24) {
      if (hour % step === 0) ticks.push({ t, label: `${hour}時` });
    } else if (hour === 0) {
      // 日本時間の0時。何日おきにするかは、2000-01-01 からの日数で決める
      const day = Math.round((t + 9 * HOUR) / (24 * HOUR));
      if (day % (step / 24) === 0) ticks.push({ t, label: jstMonthDay(date) });
    }
  }
  return ticks;
}

/** 縦軸の範囲：最小〜最大に少し余白を足して、step の倍数に丸める。floor より下には広げない（明るさなど負にならない量） */
export function niceDomain(values: number[], step: number, floor = -Infinity): [number, number] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = Math.max((max - min) * 0.1, step / 2);
  const lo = Math.max(floor, Math.floor((min - pad) / step) * step);
  return [lo, Math.max(lo + step, Math.ceil((max + pad) / step) * step)];
}

/** 縦軸の目盛り：下端・上端と、そのあいだの真ん中に近い step の倍数（あれば） */
export function valueTicks([lo, hi]: [number, number], step: number): number[] {
  const mid = lo + Math.round((hi - lo) / 2 / step) * step;
  return mid > lo && mid < hi ? [lo, mid, hi] : [lo, hi];
}
