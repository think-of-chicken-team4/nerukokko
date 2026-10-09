// タブを移動したときなど、画面のデータを読み込んでいる間の表示
export default function Loading() {
  return (
    <div className="flex flex-col items-center gap-2 py-16" role="status">
      <div className="animate-bounce text-4xl motion-reduce:animate-none" aria-hidden>
        🥚
      </div>
      <p className="muted">読み込み中コケ…</p>
    </div>
  );
}
