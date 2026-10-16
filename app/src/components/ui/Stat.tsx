// 数値のタイル（「🔄 寝返り 12回」など）。StatGrid の中に並べると2列になる
export function StatGrid({ children }: { children: React.ReactNode }) {
  return <div className="stat-grid">{children}</div>;
}

export function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}
