// 履歴の1行（イベントログ・会話ログ）。点の色は pink（いびき・会話）か gold（寝返り）
export function LogItem({ children, tone = "pink" }: { children: React.ReactNode; tone?: "pink" | "gold" }) {
  return (
    <div className="log-item">
      <span className={tone === "gold" ? "log-dot log-dot-gold" : "log-dot"} aria-hidden />
      <span>{children}</span>
    </div>
  );
}
