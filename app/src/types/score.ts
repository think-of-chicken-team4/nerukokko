// sleep_sessions.score_details の形。サーバーの server/supabase/functions/_shared/score.ts の ScoreDetails と同じ。
// どちらかを変えたら、もう片方も合わせること。

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
  weights_used: Partial<Record<"efficiency" | "turn_balance" | "quietness" | "breathing" | "environment", number>>;
};

export function scoreLabel(score: number): string {
  if (score >= 85) return "ぐっすり眠れました";
  if (score >= 65) return "まずまずの睡眠でした";
  return "やや浅い睡眠でした";
}
