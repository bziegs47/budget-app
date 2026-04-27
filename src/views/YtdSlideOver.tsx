import { useEffect } from "react";
import type { LineCalendarReport } from "../types";
import { formatUsd } from "../money";
import { MonthlyBarsChart } from "./MonthlyBarsChart";

export function YtdSlideOver({
  open,
  lineKind,
  year,
  report,
  loading,
  onClose,
  onYearChange,
  onOpenFullReports,
}: {
  open: boolean;
  lineKind: "income" | "expense";
  year: number;
  report: LineCalendarReport | null;
  loading: boolean;
  onClose: () => void;
  onYearChange: (y: number) => void;
  onOpenFullReports: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const title = report?.displayName ?? "Line";

  return (
    <div className="drawer-backdrop" role="presentation" onClick={onClose}>
      <aside
        className="ytd-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ytd-drawer-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ytd-drawer-head">
          <div>
            <h2 id="ytd-drawer-title" className="ytd-drawer-title">
              {title}
            </h2>
            <p className="muted ytd-drawer-sub">
              {lineKind === "income" ? "Income" : "Expense"} · calendar year totals by transaction
              date
            </p>
          </div>
          <button type="button" className="btn ghost drawer-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="ytd-drawer-controls">
          <label className="field-inline">
            <span className="label">Year</span>
            <input
              className="input mono"
              type="number"
              min={2000}
              max={2100}
              value={year}
              onChange={(e) => onYearChange(Number(e.target.value))}
            />
          </label>
          <p className="muted small-hint">
            Range {report ? `${report.rangeStart} → ${report.rangeEnd}` : "—"}
          </p>
        </div>

        {loading && <p className="muted">Loading…</p>}

        {!loading && report && (
          <>
            <div className="ytd-drawer-total">
              <div className="ytd-label">Total ({report.year})</div>
              <div className="ytd-value">{formatUsd(report.totalCents, "rounded")}</div>
            </div>
            <MonthlyBarsChart monthly={report.monthly} />
            <div className="ytd-drawer-actions">
              <button type="button" className="btn secondary" onClick={onOpenFullReports}>
                Open in Reports
              </button>
            </div>
            <h3 className="ytd-entries-title">Entries (up to 500)</h3>
            <ul className="ytd-entry-list">
              {report.entries.length === 0 ? (
                <li className="muted">No dated entries in this range (add dates to transactions).</li>
              ) : (
                report.entries.map((e) => (
                  <li key={`${lineKind}-${e.id}`} className="entry-row">
                    <span>{e.label}</span>
                    <span className="muted mono">{e.occurredOn ?? ""}</span>
                    <span className="num">{formatUsd(e.amountCents, "exact")}</span>
                  </li>
                ))
              )}
            </ul>
          </>
        )}
      </aside>
    </div>
  );
}
