import type { MonthView } from "../types";
import { formatUsd } from "../money";

export function YtdDualStrip({ view }: { view: MonthView }) {
  return (
    <section
      className="ytd-dual ytd-single"
      aria-label="Year-to-date totals for the active month"
    >
      <div className="ytd-dual-header">
        <h2 className="ytd-dual-title">Year-to-date · {view.ytd.year}</h2>
      </div>
      <div className="ytd-dual-grid">
        <div className="ytd-dual-card">
          <div className="ytd-dual-stats">
            <div>
              <div className="ytd-label">Income</div>
              <div className="ytd-value">
                {formatUsd(view.ytd.incomeActualCents, "rounded")}
              </div>
            </div>
            <div>
              <div className="ytd-label">Expenses (net)</div>
              <div className="ytd-value">
                {formatUsd(view.ytd.expenseNetActualCents, "rounded")}
              </div>
            </div>
            <div>
              <div className="ytd-label">Net</div>
              <div
                className={`ytd-value ${
                  view.ytd.netActualCents < 0 ? "neg" : "pos"
                }`}
              >
                {formatUsd(view.ytd.netActualCents, "rounded")}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
