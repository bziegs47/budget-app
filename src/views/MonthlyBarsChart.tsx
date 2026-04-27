const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export function MonthlyBarsChart({
  monthly,
  className,
}: {
  monthly: { month: number; totalCents: number }[];
  className?: string;
}) {
  const max = Math.max(...monthly.map((m) => Math.abs(m.totalCents)), 1);
  return (
    <div className={`monthly-bars-chart ${className ?? ""}`} aria-hidden="true">
      {MONTH_ABBR.map((label, i) => {
        const monthNum = i + 1;
        const bucket = monthly.find((m) => m.month === monthNum);
        const v = bucket?.totalCents ?? 0;
        const h = Math.round((Math.abs(v) / max) * 100);
        return (
          <div key={label} className="monthly-bar-col">
            <div className="monthly-bar-track">
              <div className="monthly-bar-fill" style={{ height: `${h}%` }} />
            </div>
            <span className="monthly-bar-label">{label}</span>
          </div>
        );
      })}
    </div>
  );
}
