// 1日の流れ（5フェーズ）の定義。判定のロジックは docs/dev-plan.md §5-2（T-105 で実装）。

export const PHASES = ["dusk", "prep", "sleeping", "wake", "morning"] as const;

export type Phase = (typeof PHASES)[number];

export const PHASE_LABEL: Record<Phase, string> = {
  dusk: "夕方確認",
  prep: "就寝準備",
  sleeping: "睡眠記録",
  wake: "起床制御",
  morning: "朝の振り返り",
};
