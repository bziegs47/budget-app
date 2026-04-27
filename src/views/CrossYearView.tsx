import {
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CrossYearOverview } from "../types";
import { formatUsd } from "../money";
import { varianceClassExpense } from "./helpers";

const CROSS_YEAR_TOTALS_PER_PAGE = 8;

// Aggregated row produced by collapsing one or more CrossYearLineRow
// entries that share a logical identity. We keep the original
// displayName / bucketName for labeling and add a stable groupKey
// for React keys.
export type AggregatedLineRow = {
  groupKey: string;
  displayName: string;
  bucketName: string | null;
  cells: { plannedCents: number; actualCents: number }[];
  totalPlannedCents: number;
  totalActualCents: number;
};

// Group rows by a kind-appropriate key:
// - income: by case-insensitive display name (no bucket dimension)
// - expense: by display name + bucket name (so identical line names
//   in different buckets stay separate)
// Cells are summed positionally. Sorted by display name (case-insensitive)
// so the visible ordering matches the backend's sort within a kind.
export function aggregateLineRows(
  rows: { displayName: string; bucketName: string | null;
    cells: { plannedCents: number; actualCents: number }[];
    totalPlannedCents: number; totalActualCents: number }[],
  columnCount: number,
  kind: "income" | "expense",
): AggregatedLineRow[] {
  const groups = new Map<string, AggregatedLineRow>();
  for (const r of rows) {
    const nameKey = r.displayName.trim().toLowerCase();
    const groupKey =
      kind === "expense"
        ? `expense::${nameKey}::${(r.bucketName ?? "").trim().toLowerCase()}`
        : `income::${nameKey}`;
    let agg = groups.get(groupKey);
    if (!agg) {
      agg = {
        groupKey,
        displayName: r.displayName,
        bucketName: r.bucketName,
        cells: Array.from({ length: columnCount }, () => ({
          plannedCents: 0,
          actualCents: 0,
        })),
        totalPlannedCents: 0,
        totalActualCents: 0,
      };
      groups.set(groupKey, agg);
    }
    for (let i = 0; i < columnCount; i++) {
      const cell = r.cells[i];
      if (!cell) continue;
      agg.cells[i].plannedCents += cell.plannedCents;
      agg.cells[i].actualCents += cell.actualCents;
    }
    agg.totalPlannedCents += r.totalPlannedCents;
    agg.totalActualCents += r.totalActualCents;
  }
  return Array.from(groups.values()).sort((a, b) =>
    a.displayName.toLowerCase().localeCompare(b.displayName.toLowerCase()),
  );
}

type CrossYearMatrixRow = {
  key: string;
  label: string;
  sublabel?: string;
  cells: { plannedCents: number; actualCents: number }[];
  totalPlanned: number;
  totalActual: number;
  isIncome?: boolean;
};

function CrossYearMatrix({
  columns,
  rows,
  onJumpToYear,
}: {
  columns: CrossYearOverview["columns"];
  rows: CrossYearMatrixRow[];
  onJumpToYear: (yearId: number) => void;
}) {
  return (
    <div className="cross-year-matrix-wrap">
      <table className="data-table cross-year-matrix">
        <thead>
          <tr>
            {/* Row-label column intentionally has no header — the
                "Row" label was visual fluff that didn't add meaning. */}
            <th className="cross-year-row-head" aria-hidden="true" />
            {columns.map((c) => (
              <th key={c.yearId} className="num">
                <button
                  type="button"
                  className="btn-link cross-year-col-link"
                  onClick={() => onJumpToYear(c.yearId)}
                >
                  {c.yearLabel}
                </button>
              </th>
            ))}
            <th className="num">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td className="cross-year-row-head">
                <div className="cross-year-row-label">{row.label}</div>
                {row.sublabel && (
                  <div className="cross-year-row-sub muted">{row.sublabel}</div>
                )}
              </td>
              {row.cells.map((cell, i) => {
                const empty = cell.plannedCents === 0 && cell.actualCents === 0;
                return (
                  <td key={i} className="num">
                    {empty ? (
                      <span className="muted">—</span>
                    ) : (
                      <>
                        <div>{formatUsd(cell.actualCents, "rounded")}</div>
                        <div className="cross-year-cell-meta muted">
                          plan {formatUsd(cell.plannedCents, "rounded")}
                        </div>
                      </>
                    )}
                  </td>
                );
              })}
              <td className="num cross-year-row-total">
                <div>{formatUsd(row.totalActual, "rounded")}</div>
                <div className="cross-year-cell-meta muted">
                  plan {formatUsd(row.totalPlanned, "rounded")}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CrossYearView({
  data,
  loading,
  onJumpToYear,
}: {
  data: CrossYearOverview | null;
  loading: boolean;
  onJumpToYear: (yearId: number) => void;
}) {
  // Page tracking state mirrors BudgetDashboard's strip — no
  // selectedYear concept here so we don't need the auto-anchor
  // effect; mouse/wheel scroll drives the dots, dots are read-only.
  const totalsScrollerRef = useRef<HTMLDivElement | null>(null);
  const totalsPageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [currentTotalsPage, setCurrentTotalsPage] = useState(0);

  const onTotalsScroll = useCallback(() => {
    const el = totalsScrollerRef.current;
    if (!el) return;
    const x = el.scrollLeft;
    let bestIdx = 0;
    let bestDist = Infinity;
    totalsPageRefs.current.forEach((pageEl, i) => {
      if (!pageEl) return;
      const d = Math.abs(pageEl.offsetLeft - x);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    });
    setCurrentTotalsPage((prev) => (prev === bestIdx ? prev : bestIdx));
  }, []);

  // Chunk columns into pages of 8 — same math as BudgetDashboard.
  // Falls back to a single empty page so the JSX below can map
  // unconditionally without an extra null check.
  const totalsPages = useMemo(() => {
    const cols = data?.columns ?? [];
    if (cols.length === 0) return [[] as CrossYearOverview["columns"]];
    const out: CrossYearOverview["columns"][] = [];
    for (let i = 0; i < cols.length; i += CROSS_YEAR_TOTALS_PER_PAGE) {
      out.push(cols.slice(i, i + CROSS_YEAR_TOTALS_PER_PAGE));
    }
    return out;
  }, [data?.columns]);
  const showTotalsPager = totalsPages.length > 1;

  // Same instant-scroll strategy as BudgetDashboard.goToStripPage —
  // see notes there on why we deliberately avoid behavior:"smooth"
  // alongside scroll-snap-type:mandatory.
  const goToTotalsPage = useCallback(
    (idx: number) => {
      const clamped = Math.max(0, Math.min(idx, totalsPages.length - 1));
      const el = totalsScrollerRef.current;
      const pageEl = totalsPageRefs.current[clamped];
      if (!el || !pageEl) return;
      el.scrollLeft = pageEl.offsetLeft;
      setCurrentTotalsPage(clamped);
    },
    [totalsPages.length],
  );

  if (loading && !data) {
    return <p className="muted month-loading-banner">Crunching cross-year totals…</p>;
  }
  if (!data || data.columns.length === 0) {
    return (
      <div className="year-overview">
        <header className="year-overview-header cross-year-header">
          <div className="cross-year-header-titles">
            <h1>All years</h1>
            <p className="muted">
              This budget doesn't have any years yet. Create one from the
              sidebar to start a multi-year comparison.
            </p>
          </div>
        </header>
      </div>
    );
  }

  const columns = data.columns;
  // Hide rows that are zero across every column. Carrying empty
  // expense lines / unused buckets year-over-year was useful when a
  // budget had only a year or two — it served as a "did you forget
  // this?" reminder. With many years in one file the comparison
  // becomes a wall of zeroes. A row earns its place only if at least
  // one year has either a plan or actuals against it.
  const hasAnyValue = (r: { totalPlannedCents: number; totalActualCents: number }) =>
    r.totalPlannedCents !== 0 || r.totalActualCents !== 0;
  const bucketRows = data.bucketRows.filter(hasAnyValue);
  // Collapse logical lines that surface as multiple rows. The backend
  // keys line_rows by line_identity, but several distinct identities
  // commonly share a single display name (a per-month or per-year
  // duplication of the same logical line). For the cross-year table
  // those identities should read as one row — sum cells positionally
  // and sum the totals. Income groups by display name only (no bucket
  // dimension); expense groups by display name + bucket so two
  // different buckets that happen to share a line name stay separate.
  const incomeRows = aggregateLineRows(
    data.lineRows.filter((r) => r.lineKind === "income"),
    columns.length,
    "income",
  ).filter(hasAnyValue);
  const expenseRows = aggregateLineRows(
    data.lineRows.filter((r) => r.lineKind === "expense"),
    columns.length,
    "expense",
  ).filter(hasAnyValue);

  return (
    <div className="year-overview cross-year-view">
      <header className="year-overview-header cross-year-header">
        <div className="cross-year-header-titles">
          <h1>All years in this budget</h1>
          <p className="muted">
            Comparing {columns.length} {columns.length === 1 ? "year" : "years"}.
            Click a column header to open that year's overview.
          </p>
        </div>
      </header>

      <section className="card cross-year-totals-card">
        <h2>Year totals</h2>
        {/* Reuses the dashboard's year-strip pager structure so this
            view and the dashboard read as one vocabulary. Same chunk
            of 8 (4×2 / 2×4 below 720px), same snap-scroll behavior,
            same page dots indicator. No selectedYear concept here —
            clicking a card jumps directly to that year's overview. */}
        <div className="budget-dashboard-strip-pager cross-year-totals-pager">
          <div
            className="budget-dashboard-strip-scroller"
            ref={totalsScrollerRef}
            onScroll={onTotalsScroll}
          >
            {totalsPages.map((page, pageIdx) => (
              <div
                key={pageIdx}
                ref={(el) => {
                  totalsPageRefs.current[pageIdx] = el;
                }}
                className="budget-dashboard-strip-page"
                role="group"
                aria-label={`Year totals page ${pageIdx + 1} of ${totalsPages.length}`}
              >
                {page.map((c) => (
                  <button
                    type="button"
                    key={c.yearId}
                    className="budget-dashboard-strip-card"
                    onClick={() => onJumpToYear(c.yearId)}
                  >
                    <div className="budget-dashboard-strip-head">
                      <span className="budget-dashboard-strip-label">
                        {c.yearLabel}
                      </span>
                      <span className="budget-dashboard-strip-meta">
                        {c.trackedMonthCount}{" "}
                        {c.trackedMonthCount === 1 ? "month" : "months"}
                      </span>
                    </div>
                    <dl className="budget-dashboard-strip-stats">
                      <dt>Income</dt>
                      <dd className="num">
                        {formatUsd(c.incomeActualCents, "rounded")}
                      </dd>
                      <dt>Expenses</dt>
                      <dd className="num">
                        {formatUsd(c.expenseActualCents, "rounded")}
                      </dd>
                      <dt>Net</dt>
                      <dd
                        className={`num ${varianceClassExpense(c.netActualCents)}`}
                      >
                        {formatUsd(c.netActualCents, "rounded")}
                      </dd>
                    </dl>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
        {showTotalsPager && (
          <div className="budget-dashboard-strip-pagination">
            <button
              type="button"
              className="budget-dashboard-strip-chevron"
              onClick={() => goToTotalsPage(currentTotalsPage - 1)}
              disabled={currentTotalsPage === 0}
              aria-label="Previous page"
            >
              ‹
            </button>
            <div
              className="budget-dashboard-strip-dots"
              role="presentation"
              aria-hidden="true"
            >
              {totalsPages.map((_, i) => (
                <span
                  key={i}
                  className={
                    i === currentTotalsPage
                      ? "budget-dashboard-strip-dot is-active"
                      : "budget-dashboard-strip-dot"
                  }
                />
              ))}
            </div>
            <button
              type="button"
              className="budget-dashboard-strip-chevron"
              onClick={() => goToTotalsPage(currentTotalsPage + 1)}
              disabled={currentTotalsPage === totalsPages.length - 1}
              aria-label="Next page"
            >
              ›
            </button>
          </div>
        )}
      </section>

      {bucketRows.length > 0 && (
        <section className="card">
          <h2>By bucket</h2>
          <CrossYearMatrix
            columns={columns}
            rows={bucketRows.map((r) => ({
              key: r.bucketName,
              label: r.bucketName,
              cells: r.cells,
              totalActual: r.totalActualCents,
              totalPlanned: r.totalPlannedCents,
            }))}
            onJumpToYear={onJumpToYear}
          />
        </section>
      )}

      {incomeRows.length > 0 && (
        <section className="card">
          <h2>By income line</h2>
          <CrossYearMatrix
            columns={columns}
            rows={incomeRows.map((r) => ({
              key: r.groupKey,
              label: r.displayName,
              sublabel: undefined,
              cells: r.cells,
              totalActual: r.totalActualCents,
              totalPlanned: r.totalPlannedCents,
              isIncome: true,
            }))}
            onJumpToYear={onJumpToYear}
          />
        </section>
      )}

      {expenseRows.length > 0 && (
        <section className="card">
          <h2>By expense line</h2>
          <CrossYearMatrix
            columns={columns}
            rows={expenseRows.map((r) => ({
              key: r.groupKey,
              label: r.displayName,
              sublabel: r.bucketName ?? undefined,
              cells: r.cells,
              totalActual: r.totalActualCents,
              totalPlanned: r.totalPlannedCents,
            }))}
            onJumpToYear={onJumpToYear}
          />
        </section>
      )}
    </div>
  );
}
