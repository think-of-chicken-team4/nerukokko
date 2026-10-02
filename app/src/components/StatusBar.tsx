import { formatTime } from "@/lib/format";
import { PHASE_LABEL, type Phase } from "@/lib/phase";

import { PhaseDial } from "./PhaseDial";

type Props = {
  phase: Phase;
  /** 鶏がオンラインか。鶏が未登録なら null */
  chickenOnline: boolean | null;
};

// 画面上部：フェーズのダイヤル・フェーズ名・時刻・鶏の接続状態
export function StatusBar({ phase, chickenOnline }: Props) {
  const badge =
    chickenOnline === null
      ? { text: "鶏が未登録", className: "bg-white/15" }
      : chickenOnline
        ? { text: "● 接続中", className: "bg-white/15" }
        : { text: "○ オフライン", className: "bg-[rgba(255,90,90,.35)]" };

  return (
    <header className="status-bar sticky top-0 z-10 flex items-center gap-2.5 bg-black/15 px-4 pt-4 pb-2.5 text-white backdrop-blur-md">
      <PhaseDial phase={phase} />
      <div className="min-w-0 flex-1">
        <div className="font-maru text-sm font-bold">{PHASE_LABEL[phase]}</div>
        <div className="font-num text-[19px] tracking-wide">{formatTime(new Date())}</div>
      </div>
      <div className={`rounded-full px-2.5 py-1 text-[10px] whitespace-nowrap ${badge.className}`}>{badge.text}</div>
    </header>
  );
}
