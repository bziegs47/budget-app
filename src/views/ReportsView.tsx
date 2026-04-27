import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  LineRef,
  MonthRow,
  MultiLineCalendarReport,
  ReportsViewSeed,
  WorkspaceLineCatalogEntry,
} from "../types";
import { formatUsd } from "../money";
import { MonthlyBarsChart } from "./MonthlyBarsChart";

function lineRefKey(r: { lineKind: string; lineIdentity: string }) {
  return `${r.lineKind}:${r.lineIdentity}`;
}

export function ReportsView({
  initial,
  onInitialApplied,
  monthRows,
}: {
  initial: ReportsViewSeed | null;
  onInitialApplied: () => void;
  monthRows: MonthRow[];
}) {
  const defaultYear = useMemo(() => {
    const y = new Date().getFullYear();
    if (monthRows.length === 0) return y;
    const years = monthRows.map((m) => Number(m.periodStart.slice(0, 4)));
    return Math.min(y, Math.max(...years));
  }, [monthRows]);

  const [year, setYear] = useState(defaultYear);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [catalog, setCatalog] = useState<WorkspaceLineCatalogEntry[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [report, setReport] = useState<MultiLineCalendarReport | null>(null);
  const [reportErr, setReportErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(true);

  useEffect(() => {
    setYear(defaultYear);
  }, [defaultYear]);

  useEffect(() => {
    let cancelled = false;
    setCatalogLoading(true);
    void invoke<WorkspaceLineCatalogEntry[]>("list_workspace_line_catalog")
      .then((c) => {
        if (!cancelled) setCatalog(c);
      })
      .catch(() => {
        if (!cancelled) setCatalog([]);
      })
      .finally(() => {
        if (!cancelled) setCatalogLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // When the parent seeds us from the drawer, adopt year/asOf/selection AND auto-run.
  const [pendingAutoRun, setPendingAutoRun] = useState(false);
  useEffect(() => {
    if (!initial) return;
    setYear(initial.year);
    setAsOf(initial.asOf);
    setSelectedKeys(new Set(initial.selected.map((s) => lineRefKey(s))));
    setPendingAutoRun(true);
    onInitialApplied();
  }, [initial, onInitialApplied]);

  const filteredCatalog = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return catalog;
    return catalog.filter(
      (c) =>
        c.displayName.toLowerCase().includes(q) ||
        (c.bucketName?.toLowerCase().includes(q) ?? false) ||
        c.lineIdentity.toLowerCase().includes(q),
    );
  }, [catalog, filter]);

  const runReport = useCallback(async () => {
    setReportErr(null);
    const lines: LineRef[] = [];
    for (const c of catalog) {
      const k = lineRefKey(c);
      if (selectedKeys.has(k)) {
        lines.push({ lineKind: c.lineKind, lineIdentity: c.lineIdentity });
      }
    }
    if (lines.length === 0) {
      setReportErr("Select at least one line in the table below.");
      setReport(null);
      return;
    }
    setLoading(true);
    try {
      const r = await invoke<MultiLineCalendarReport>("get_multi_line_calendar_report", {
        year,
        lines,
        asOf,
      });
      setReport(r);
    } catch (e) {
      setReport(null);
      setReportErr(String(e));
    } finally {
      setLoading(false);
    }
  }, [catalog, selectedKeys, year, asOf]);

  // If we were seeded from the drawer, auto-run once the catalog has loaded.
  useEffect(() => {
    if (!pendingAutoRun) return;
    if (catalogLoading) return;
    if (selectedKeys.size === 0) return;
    setPendingAutoRun(false);
    void runReport();
  }, [pendingAutoRun, catalogLoading, selectedKeys, runReport]);

  // Income vs. expense split for results — used to guard the combined-total card.
  const resultKindBreakdown = useMemo(() => {
    if (!report) return { income: 0, expense: 0, incomeTotal: 0, expenseTotal: 0 };
    let inc = 0;
    let exp = 0;
    let incTotal = 0;
    let expTotal = 0;
    for (const r of report.rows) {
      if (r.lineKind === "income") {
        inc += 1;
        incTotal += r.totalCents;
      } else {
        exp += 1;
        expTotal += r.totalCents;
      }
    }
    return { income: inc, expense: exp, incomeTotal: incTotal, expenseTotal: expTotal };
  }, [report]);

  const toggleLine = (c: WorkspaceLineCatalogEntry) => {
    const k = lineRefKey(c);
    setSelectedKeys((prev) => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  };

  return (
    <div className="reports-view">
      <header className="reports-header">
        <h1>Reports · by transaction date</h1>
        <p className="muted">
          Calendar-year totals computed from <code>occurred_on</code> /{" "}
          <code>received_on</code> dates on individual transactions and income entries
          (not by which budget period they were entered into), rolled up by line identity
          across every month in this file.
        </p>
      </header>

      <section className="card reports-filters">
        <h2>Filters</h2>
        <div className="reports-filter-row">
          <label className="field-inline">
            <span className="label">Year</span>
            <input
              className="input mono"
              type="number"
              min={2000}
              max={2100}
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
            />
          </label>
          <label className="field-inline">
            <span className="label">Cap range end (optional)</span>
            <input
              className="input mono"
              placeholder="YYYY-MM-DD — default: today"
              value={asOf ?? ""}
              onChange={(e) => setAsOf(e.target.value.trim() || null)}
            />
          </label>
          <button type="button" className="btn primary" onClick={() => void runReport()} disabled={loading}>
            {loading ? "Running…" : "Run report"}
          </button>
        </div>
        <p className="muted small-hint">
          Leave the cap blank to use today (within the selected year). Set it to match a budget period
          end if you want totals through that date only.
        </p>
      </section>

      <section className="card reports-picker">
        <h2>Lines in this budget</h2>
        {catalogLoading ? (
          <p className="muted">Loading catalog…</p>
        ) : catalog.length === 0 ? (
          <p className="muted">Add months and budget lines to build a catalog.</p>
        ) : (
          <>
            <input
              className="input"
              placeholder="Search by name or bucket…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              style={{ marginBottom: "0.75rem", width: "100%", maxWidth: "28rem" }}
            />
            <div className="catalog-table-wrap">
              <table className="data-table catalog-table">
                <thead>
                  <tr>
                    <th className="catalog-check" />
                    <th>Kind</th>
                    <th>Name</th>
                    <th>Bucket</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCatalog.map((c) => {
                    const k = lineRefKey(c);
                    return (
                      <tr key={k}>
                        <td className="catalog-check">
                          <input
                            type="checkbox"
                            checked={selectedKeys.has(k)}
                            onChange={() => toggleLine(c)}
                            aria-label={`Select ${c.displayName}`}
                          />
                        </td>
                        <td>{c.lineKind}</td>
                        <td>{c.displayName}</td>
                        <td className="muted">{c.bucketName ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {reportErr && (
        <div className="banner error" role="alert">
          {reportErr}
        </div>
      )}

      {report && (
        <section className="card reports-results">
          <h2>
            Results · {report.year}{" "}
            <span className="muted">
              ({report.rangeStart} → {report.rangeEnd})
            </span>
          </h2>
          {resultKindBreakdown.income > 0 && resultKindBreakdown.expense > 0 ? (
            <div className="reports-combined-split">
              <div className="reports-combined-total">
                <span className="ytd-label">Combined income</span>
                <span className="ytd-value pos">
                  {formatUsd(resultKindBreakdown.incomeTotal, "rounded")}
                </span>
              </div>
              <div className="reports-combined-total">
                <span className="ytd-label">Combined expenses</span>
                <span className="ytd-value neg">
                  {formatUsd(resultKindBreakdown.expenseTotal, "rounded")}
                </span>
              </div>
              <div className="reports-combined-total">
                <span className="ytd-label">Net</span>
                <span className="ytd-value">
                  {formatUsd(
                    resultKindBreakdown.incomeTotal - resultKindBreakdown.expenseTotal,
                    "rounded",
                  )}
                </span>
              </div>
            </div>
          ) : (
            <div className="reports-combined-total">
              <span className="ytd-label">
                Combined total
                {resultKindBreakdown.income > 0 ? " (income)" : ""}
                {resultKindBreakdown.expense > 0 ? " (expenses)" : ""}
              </span>
              <span className="ytd-value">
                {formatUsd(report.combinedTotalCents, "rounded")}
              </span>
            </div>
          )}
          <MonthlyBarsChart monthly={report.combinedMonthly} className="reports-combined-chart" />
          <table className="data-table">
            <thead>
              <tr>
                <th>Kind</th>
                <th>Line</th>
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => (
                <tr key={lineRefKey(row)}>
                  <td>{row.lineKind}</td>
                  <td>{row.displayName}</td>
                  <td className="num">{formatUsd(row.totalCents, "rounded")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
