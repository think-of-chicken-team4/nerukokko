// 睡眠スコア（0〜100）の円グラフ
export function ScoreRing({ score }: { score: number }) {
  return (
    <div
      role="img"
      aria-label={`睡眠スコア ${score}点`}
      className="mx-auto mt-1.5 mb-2.5 flex size-32 items-center justify-center rounded-full"
      style={{ background: `conic-gradient(var(--color-gold) ${score * 3.6}deg, var(--track) 0deg)` }}
    >
      <div className="flex size-24 flex-col items-center justify-center rounded-full bg-[#fffaf2]" aria-hidden>
        <div className="font-num text-[34px] font-bold">{score}</div>
        <div className="text-[10px] text-[var(--fg-dim)]">/ 100</div>
      </div>
    </div>
  );
}
