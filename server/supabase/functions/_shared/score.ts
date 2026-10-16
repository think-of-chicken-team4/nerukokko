// 睡眠スコアの計算（docs/dev-plan.md §6）。
// DB に依存しない純粋な関数なので、Node のテスト（server/tests/functions/）からも直接呼べる。
// 係数（SCORE_PARAMS）は実機データを見て調整する。

export type ScoreInput = {
  startTime: Date;
  /** 起床（たまごを巣に戻した）時刻 */
  endTime: Date;
  /** 寝返りの時刻 */
  motionTimes: Date[];
  /** いびき・寝言の回数 */
  audioEventCount: number;
  breathsPerMin: number[];
  environment: { temperatureC: number | null; humidityPct: number | null }[];
  presence: { time: Date; state: "in_bed" | "out_of_bed" }[];
};

export type ComponentKey = "efficiency" | "turn_balance" | "quietness" | "breathing" | "environment";

export const WEIGHTS: Record<ComponentKey, number> = {
  efficiency: 0.4,
  turn_balance: 0.15,
  quietness: 0.15,
  breathing: 0.15,
  environment: 0.15,
};

export const SCORE_PARAMS = {
  /** 睡眠効率がこの値（%）なら満点 */
  efficiencyGoodPct: 85,
  /** 寝返りのない状態がこの時間（分）続いたら、その始まりを入眠とみなす */
  onsetQuietMinutes: 15,
  /** 一晩の寝返りの目安（回） */
  idealTurns: 15,
  turnPenaltyPerTurn: 2,
  audioPenaltyPerHour: 10,
  breathingPenaltyPerStd: 10,
  /** 呼吸安定性を計算するのに必要な計測数 */
  minBreathingReadings: 5,
  temperatureRange: [16, 29],
  humidityRange: [40, 60],
} as const;

export type ScoreDetails = {
  efficiency: {
    score: number;
    efficiency_pct: number;
    time_in_bed_min: number;
    total_sleep_min: number;
    onset_latency_min: number;
    out_of_bed_min: number;
  } | null;
  turn_balance: { score: number; count: number } | null;
  quietness: { score: number; count: number; per_hour: number };
  breathing: { score: number; std: number; readings: number } | null;
  environment: { score: number; in_range_ratio: number; readings: number } | null;
  /** 実際に使った重み（データがない要素は除き、残りで割り直す前の値） */
  weights_used: Partial<Record<ComponentKey, number>>;
};

export type ScoreResult = {
  score: number;
  label: string;
  details: ScoreDetails;
};

const MINUTE_MS = 60 * 1000;

const clamp100 = (value: number) => Math.min(100, Math.max(0, value));
const round1 = (value: number) => Math.round(value * 10) / 10;

export function scoreLabel(score: number): string {
  if (score >= 85) return "ぐっすり眠れました";
  if (score >= 65) return "まずまずの睡眠でした";
  return "やや浅い睡眠でした";
}

/**
 * 入眠時刻：開始後に「寝返りのない状態が15分続いた」最初の区間の始まり。
 * そのような区間がなければ終了時刻（眠れなかった）とする。
 */
export function findSleepOnset(start: Date, end: Date, motionTimes: Date[]): Date {
  const quietMs = SCORE_PARAMS.onsetQuietMinutes * MINUTE_MS;
  const motions = motionTimes
    .map((t) => t.getTime())
    .filter((t) => t >= start.getTime() && t <= end.getTime())
    .sort((a, b) => a - b);
  const candidates = [start.getTime(), ...motions];

  for (const candidate of candidates) {
    if (candidate + quietMs > end.getTime()) {
      break;
    }
    const nextMotion = motions.find((t) => t > candidate);
    if (nextMotion === undefined || nextMotion - candidate >= quietMs) {
      return new Date(candidate);
    }
  }
  return end;
}

/** 入眠後にベッドを離れていた時間（分） */
export function outOfBedMinutes(onset: Date, end: Date, presence: ScoreInput["presence"]): number {
  const events = [...presence].sort((a, b) => a.time.getTime() - b.time.getTime());
  let total = 0;
  let outSince: number | null = null;
  for (const event of events) {
    const t = event.time.getTime();
    if (event.state === "out_of_bed" && outSince === null) {
      outSince = t;
    } else if (event.state === "in_bed" && outSince !== null) {
      total += overlapMs(outSince, t, onset.getTime(), end.getTime());
      outSince = null;
    }
  }
  if (outSince !== null) {
    total += overlapMs(outSince, end.getTime(), onset.getTime(), end.getTime());
  }
  return total / MINUTE_MS;
}

function overlapMs(a1: number, a2: number, b1: number, b2: number): number {
  return Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
}

function standardDeviation(values: number[]): number {
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export function computeSleepScore(input: ScoreInput): ScoreResult {
  const timeInBedMin = Math.max(0, (input.endTime.getTime() - input.startTime.getTime()) / MINUTE_MS);
  const motionCount = input.motionTimes.length;
  // 寝返りも在床の記録もないときは、センサーが動いていなかったとみなして睡眠効率・寝返りを計算しない
  const hasMotionSensor = motionCount > 0;
  const hasEfficiencyData = (hasMotionSensor || input.presence.length > 0) && timeInBedMin > 0;

  let efficiency: ScoreDetails["efficiency"] = null;
  if (hasEfficiencyData) {
    const onset = findSleepOnset(input.startTime, input.endTime, input.motionTimes);
    const latencyMin = (onset.getTime() - input.startTime.getTime()) / MINUTE_MS;
    const outMin = outOfBedMinutes(onset, input.endTime, input.presence);
    const totalSleepMin = Math.max(0, timeInBedMin - latencyMin - outMin);
    const pct = (totalSleepMin / timeInBedMin) * 100;
    efficiency = {
      score: Math.round(clamp100((pct / SCORE_PARAMS.efficiencyGoodPct) * 100)),
      efficiency_pct: round1(pct),
      time_in_bed_min: Math.round(timeInBedMin),
      total_sleep_min: Math.round(totalSleepMin),
      onset_latency_min: Math.round(latencyMin),
      out_of_bed_min: Math.round(outMin),
    };
  }

  const turnBalance: ScoreDetails["turn_balance"] = hasMotionSensor
    ? {
        score: Math.round(
          clamp100(100 - Math.abs(motionCount - SCORE_PARAMS.idealTurns) * SCORE_PARAMS.turnPenaltyPerTurn),
        ),
        count: motionCount,
      }
    : null;

  const hours = Math.max(timeInBedMin, 1) / 60;
  const perHour = input.audioEventCount / hours;
  const quietness: ScoreDetails["quietness"] = {
    score: Math.round(clamp100(100 - perHour * SCORE_PARAMS.audioPenaltyPerHour)),
    count: input.audioEventCount,
    per_hour: round1(perHour),
  };

  let breathing: ScoreDetails["breathing"] = null;
  if (input.breathsPerMin.length >= SCORE_PARAMS.minBreathingReadings) {
    const std = standardDeviation(input.breathsPerMin);
    breathing = {
      score: Math.round(clamp100(100 - std * SCORE_PARAMS.breathingPenaltyPerStd)),
      std: round1(std),
      readings: input.breathsPerMin.length,
    };
  }

  const envReadings = input.environment.filter((r) => r.temperatureC !== null && r.humidityPct !== null);
  let environment: ScoreDetails["environment"] = null;
  if (envReadings.length > 0) {
    const [tMin, tMax] = SCORE_PARAMS.temperatureRange;
    const [hMin, hMax] = SCORE_PARAMS.humidityRange;
    const inRange = envReadings.filter(
      (r) => r.temperatureC! >= tMin && r.temperatureC! <= tMax && r.humidityPct! >= hMin && r.humidityPct! <= hMax,
    ).length;
    const ratio = inRange / envReadings.length;
    environment = { score: Math.round(ratio * 100), in_range_ratio: round1(ratio), readings: envReadings.length };
  }

  const components: [ComponentKey, number | null][] = [
    ["efficiency", efficiency?.score ?? null],
    ["turn_balance", turnBalance?.score ?? null],
    ["quietness", quietness.score],
    ["breathing", breathing?.score ?? null],
    ["environment", environment?.score ?? null],
  ];
  const weightsUsed: Partial<Record<ComponentKey, number>> = {};
  let weightedSum = 0;
  let weightTotal = 0;
  for (const [key, value] of components) {
    if (value === null) continue;
    weightsUsed[key] = WEIGHTS[key];
    weightedSum += WEIGHTS[key] * value;
    weightTotal += WEIGHTS[key];
  }
  const score = Math.round(clamp100(weightTotal > 0 ? weightedSum / weightTotal : 0));

  return {
    score,
    label: scoreLabel(score),
    details: {
      efficiency,
      turn_balance: turnBalance,
      quietness,
      breathing,
      environment,
      weights_used: weightsUsed,
    },
  };
}
