import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  CrossYearOverview,
  YearOverview,
  YearRow,
} from "../types";
import { formatUsd } from "../money";
import { PlusIcon } from "../components/icons";
import { varianceClassExpense } from "./helpers";
import { YearEndNudge } from "./YearEndNudge";

const YEARS_PER_PAGE = 8;

export function BudgetDashboard({
  workspaceTitle,
  years,
  crossYear,
  crossYearLoading,
  snapshot,
  snapshotLoading,
  selectedYearId,
  onPickYear,
  onOpenYearOverview,
  onOpenMonth,
  onCreateYear,
  onShowCrossYear,
  yearEndNudge,
  onStartYearEndNudge,
}: {
  // Same string the sidebar shows in its workspace eyebrow. Surfacing
  // it in the dashboard header gives the user a quick reminder of
  // *which* budget this dashboard is for, parallel to the library's
  // "From <folder>" subtitle.
  workspaceTitle: string;
  years: YearRow[];
  crossYear: CrossYearOverview | null;
  crossYearLoading: boolean;
  snapshot: YearOverview | null;
  snapshotLoading: boolean;
  // The year currently displayed in the snapshot card. Drives the
  // "is-active" highlight on the year-totals strip too.
  selectedYearId: number | null;
  // Year-card click. Swaps the snapshot in-place; deliberately does
  // not navigate, so the dashboard stays the per-year report and
  // monthly navigation lives only in the sidebar.
  onPickYear: (id: number) => void;
  // Drill-down from the snapshot title to the more detailed
  // year-overview screen (planned vs. actual per bucket).
  onOpenYearOverview: (id: number) => void;
  // Quick-switch from a month cell in the snapshot strip into that
  // month's data-entry screen. The sidebar is still the canonical
  // month nav; this is a shortcut, not a replacement.
  onOpenMonth: (monthId: number) => void;
  onCreateYear: () => void;
  onShowCrossYear: () => void;
  yearEndNudge: { sourceLabel: string; nextLabel: string } | null;
  onStartYearEndNudge: () => void;
}) {
  // Strip data preference: live cross-year data when available, fall
  // back to per-year rows so the strip never blanks out while the
  // first cross-year fetch is in flight.
  type StripCard = {
    yearId: number;
    yearLabel: string;
    incomeActualCents: number;
    expenseActualCents: number;
    netActualCents: number;
    trackedMonthCount: number;
  };
  // Memoized so downstream `yearPages` / scroll effects don't see a
  // brand-new array on every render. Without this, the auto-anchor
  // effect below re-fires constantly and yanks the scroller back to
  // the selected year's page — making chevrons and manual scroll
  // both look like they snap back to page one.
  const stripCards: StripCard[] = useMemo(
    () =>
      crossYear && crossYear.columns.length > 0
        ? crossYear.columns.map((c) => ({
            yearId: c.yearId,
            yearLabel: c.yearLabel,
            incomeActualCents: c.incomeActualCents,
            expenseActualCents: c.expenseActualCents,
            netActualCents: c.netActualCents,
            trackedMonthCount: c.trackedMonthCount,
          }))
        : years.map((y) => ({
            yearId: y.id,
            yearLabel: y.yearLabel,
            incomeActualCents: y.incomeActualCents,
            expenseActualCents: y.expenseNetActualCents,
            netActualCents: y.netActualCents,
            trackedMonthCount: y.trackedMonthCount,
          })),
    [crossYear, years],
  );

  const calendarYearLabel = String(new Date().getFullYear());
  const snapshotIsCurrentCalendarYear =
    snapshot != null && snapshot.yearLabel === calendarYearLabel;

  // Year strip pagination. We keep the 4-col × 2-row layout the user
  // dialed in, so each "page" holds up to 8 year cards. "+ New year"
  // and "Compare all years" both live in the strip's actions row
  // above the grid, so the grid itself is pure year cards.
  const yearPages = useMemo(() => {
    if (stripCards.length === 0) return [[] as StripCard[]];
    const out: StripCard[][] = [];
    for (let i = 0; i < stripCards.length; i += YEARS_PER_PAGE) {
      out.push(stripCards.slice(i, i + YEARS_PER_PAGE));
    }
    return out;
  }, [stripCards]);
  const pageCount = yearPages.length;
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  // Per-page DOM refs so the scroll math reads each page's actual
  // `offsetLeft` instead of multiplying clientWidth × pageIdx.
  // clientWidth is rounded to integer pixels while flex layout
  // positions pages at fractional pixels — multiplying drifts by
  // sub-pixels per page, leaving a visible sliver of the previous
  // page on later pages.
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [currentPage, setCurrentPage] = useState(0);
  // Tracks the last selectedYearId we auto-scrolled to. We only
  // anchor the scroller when the selection actually changes — never
  // on every render — so the user's manual scroll position and
  // chevron clicks aren't reset by unrelated re-renders.
  const lastAnchoredYearRef = useRef<number | null>(null);

  // Auto-scroll to the page containing `selectedYearId` whenever the
  // selection changes (initial mount included). Instant placement —
  // animation is reserved for chevron clicks.
  useEffect(() => {
    if (selectedYearId == null) return;
    if (lastAnchoredYearRef.current === selectedYearId) return;
    const idx = yearPages.findIndex((page) =>
      page.some((c) => c.yearId === selectedYearId),
    );
    if (idx < 0) return;
    lastAnchoredYearRef.current = selectedYearId;
    setCurrentPage(idx);
    const el = scrollerRef.current;
    const pageEl = pageRefs.current[idx];
    if (!el || !pageEl) return;
    el.scrollLeft = pageEl.offsetLeft;
  }, [selectedYearId, yearPages]);

  // Track the active page from scroll position so prev/next state
  // stays accurate when the user swipes/wheels the scroller. We pick
  // the page whose offsetLeft is closest to the current scrollLeft —
  // more accurate than clientWidth-based math for the same subpixel
  // reason described above on the auto-anchor effect.
  const onStripScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const x = el.scrollLeft;
    let bestIdx = 0;
    let bestDist = Infinity;
    pageRefs.current.forEach((pageEl, i) => {
      if (!pageEl) return;
      const d = Math.abs(pageEl.offsetLeft - x);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    });
    setCurrentPage((prev) => (prev === bestIdx ? prev : bestIdx));
  }, []);

  // Chevron click handler. Instant scroll (no behavior:"smooth") —
  // scroll-snap-type:x mandatory plus smooth scrolling interact
  // unpredictably in WebKit, occasionally aborting the animation
  // mid-flight. Snap handles the visual settling cleanly on its own,
  // and the dots already animate through their is-active state.
  const goToStripPage = useCallback(
    (idx: number) => {
      const clamped = Math.max(0, Math.min(idx, yearPages.length - 1));
      const el = scrollerRef.current;
      const pageEl = pageRefs.current[clamped];
      if (!el || !pageEl) return;
      el.scrollLeft = pageEl.offsetLeft;
      setCurrentPage(clamped);
    },
    [yearPages.length],
  );

  const showPager = pageCount > 1;

  if (years.length === 0) {
    // Brand-new file with zero scaffolded years (rare). Mirror the
    // old empty-state language so users have one obvious next step.
    return (
      <div className="budget-dashboard">
        <header className="budget-dashboard-header">
          <div>
            <h1>Dashboard</h1>
            <p className="muted budget-dashboard-source">{workspaceTitle}</p>
          </div>
        </header>
        {yearEndNudge && (
          <YearEndNudge
            sourceLabel={yearEndNudge.sourceLabel}
            nextLabel={yearEndNudge.nextLabel}
            onStart={onStartYearEndNudge}
          />
        )}
        <section className="budget-dashboard-empty card">
          <h2>Create your first year</h2>
          <p className="muted">
            This budget doesn't have any years yet. Add one to start
            entering income and expenses.
          </p>
          <button
            type="button"
            className="btn primary"
            onClick={onCreateYear}
          >
            <PlusIcon /> New year
          </button>
        </section>
      </div>
    );
  }

  return (
    <div className="budget-dashboard">
      <header className="budget-dashboard-header">
        <div>
          <h1>Dashboard</h1>
          <p className="muted budget-dashboard-source">{workspaceTitle}</p>
        </div>
      </header>
      {yearEndNudge && (
        <YearEndNudge
          sourceLabel={yearEndNudge.sourceLabel}
          nextLabel={yearEndNudge.nextLabel}
          onStart={onStartYearEndNudge}
        />
      )}

      <section className="budget-dashboard-strip" aria-label="Years in this budget">
        <div className="budget-dashboard-strip-actions">
          {years.length > 1 && (
            <button
              type="button"
              className="btn secondary"
              onClick={onShowCrossYear}
            >
              Compare all years…
            </button>
          )}
          <button
            type="button"
            className="btn primary"
            onClick={onCreateYear}
          >
            New year
          </button>
        </div>
        <div className="budget-dashboard-strip-pager">
          <div
            className="budget-dashboard-strip-scroller"
            ref={scrollerRef}
            onScroll={onStripScroll}
          >
            {yearPages.map((page, pageIdx) => (
              <div
                key={pageIdx}
                ref={(el) => {
                  pageRefs.current[pageIdx] = el;
                }}
                className="budget-dashboard-strip-page"
                role="group"
                aria-label={`Years page ${pageIdx + 1} of ${pageCount}`}
              >
                {page.map((c) => {
                  const isActive = c.yearId === selectedYearId;
                  const cls = [
                    "budget-dashboard-strip-card",
                    isActive ? "is-active" : "",
                  ]
                    .filter(Boolean)
                    .join(" ");
                  return (
                    <button
                      key={c.yearId}
                      type="button"
                      className={cls}
                      onClick={() => onPickYear(c.yearId)}
                      aria-pressed={isActive}
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
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        {showPager && (
          <div className="budget-dashboard-strip-pagination">
            <button
              type="button"
              className="budget-dashboard-strip-chevron"
              onClick={() => goToStripPage(currentPage - 1)}
              disabled={currentPage === 0}
              aria-label="Previous page"
            >
              ‹
            </button>
            <div
              className="budget-dashboard-strip-dots"
              role="presentation"
              aria-hidden="true"
            >
              {yearPages.map((_, i) => (
                <span
                  key={i}
                  className={
                    i === currentPage
                      ? "budget-dashboard-strip-dot is-active"
                      : "budget-dashboard-strip-dot"
                  }
                />
              ))}
            </div>
            <button
              type="button"
              className="budget-dashboard-strip-chevron"
              onClick={() => goToStripPage(currentPage + 1)}
              disabled={currentPage === pageCount - 1}
              aria-label="Next page"
            >
              ›
            </button>
          </div>
        )}
        {crossYearLoading && stripCards.length === 0 && (
          <p className="muted">Loading year totals…</p>
        )}
      </section>

      {snapshot && selectedYearId != null ? (
        <BudgetDashboardSnapshot
          overview={snapshot}
          isCurrentCalendarYear={snapshotIsCurrentCalendarYear}
          onOpenYear={() => onOpenYearOverview(selectedYearId)}
          onOpenMonth={onOpenMonth}
        />
      ) : snapshotLoading ? (
        <section className="card budget-dashboard-snapshot is-loading">
          <p className="muted">Loading snapshot…</p>
        </section>
      ) : null}
    </div>
  );
}

// Snapshot card for the dashboard's "current" year — pulls from the
// existing YearOverview shape so we get the same income/expense/net
// numbers as the dedicated year-overview screen, plus a thin
// month-by-month strip for at-a-glance trends.
function BudgetDashboardSnapshot({
  overview,
  isCurrentCalendarYear,
  onOpenYear,
  onOpenMonth,
}: {
  overview: YearOverview;
  isCurrentCalendarYear: boolean;
  // Drill-down to the per-year overview screen. The snapshot is the
  // dashboard's quick view; the year-overview screen is the more
  // detailed planned-vs-actual report.
  onOpenYear: () => void;
  // Quick-switch into a specific month's data-entry screen. Sidebar
  // also covers this nav, but the month strip doubles as a glanceable
  // shortcut so users can jump straight from "I see April is off" to
  // editing April.
  onOpenMonth: (id: number) => void;
}) {
  const incomeActual = overview.incomeActualCents;
  const expensesActual = overview.expenseNetActualCents;
  const net = incomeActual - expensesActual;

  // Tracked months drive both the meta line and the visual emphasis
  // of the month strip — months without activity render as faint
  // outlines so the user can see where data is missing.
  const trackedMonths = overview.months.filter(
    (m) => m.incomeActualCents !== 0 || m.expenseNetActualCents !== 0,
  );
  const trackedCount = trackedMonths.length;

  // Bar height is normalized to the largest absolute monthly net so
  // both directions (surplus and deficit) get visible bars without
  // one outlier flattening everything else.
  const peakNet = overview.months.reduce(
    (max, m) => Math.max(max, Math.abs(m.netActualCents)),
    0,
  );

  return (
    <section className="card budget-dashboard-snapshot">
      <header className="budget-dashboard-snapshot-head">
        <div>
          {/* Eyebrow only renders when it's actually true; otherwise
              it would lie as soon as the user picks a non-calendar
              year from the strip above. */}
          {isCurrentCalendarYear && (
            <span className="mini-label">This year</span>
          )}
          <button
            type="button"
            className="btn-link budget-dashboard-snapshot-title"
            onClick={onOpenYear}
            title={`Open ${overview.yearLabel} overview`}
          >
            {overview.yearLabel}
          </button>
        </div>
        <span className="muted budget-dashboard-snapshot-meta">
          {trackedCount} {trackedCount === 1 ? "month" : "months"} tracked
        </span>
      </header>

      <dl className="budget-dashboard-snapshot-stats">
        <div>
          <dt>Income</dt>
          <dd className="num">{formatUsd(incomeActual, "rounded")}</dd>
        </div>
        <div>
          <dt>Expenses</dt>
          <dd className="num">{formatUsd(expensesActual, "rounded")}</dd>
        </div>
        <div>
          <dt>Net</dt>
          <dd className={`num ${varianceClassExpense(net)}`}>
            {formatUsd(net, "rounded")}
          </dd>
        </div>
      </dl>

      {overview.months.length > 0 && (
        // Quick-switch shortcut into a specific month. The sidebar is
        // still the canonical month nav; the strip doubles as an
        // at-a-glance trend that's also clickable so the user can
        // jump straight from "April looks off" to editing April.
        <div className="budget-dashboard-month-strip" role="list">
          {overview.months.map((m) => {
            const isTracked =
              m.incomeActualCents !== 0 || m.expenseNetActualCents !== 0;
            const ratio =
              peakNet === 0 ? 0 : Math.abs(m.netActualCents) / peakNet;
            // Bars max at 36px tall, min visible bar is 2px so even a
            // tracked month with $0 net still shows a faint anchor.
            const barHeight = isTracked
              ? Math.max(2, Math.round(ratio * 36))
              : 0;
            const direction = m.netActualCents >= 0 ? "up" : "down";
            const cls = [
              "budget-dashboard-month-cell",
              isTracked ? "is-tracked" : "is-empty",
              direction === "down" ? "is-deficit" : "is-surplus",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <button
                key={m.monthId}
                type="button"
                role="listitem"
                className={cls}
                onClick={() => onOpenMonth(m.monthId)}
                title={`Open ${m.label} — ${formatUsd(m.netActualCents, "rounded")} net`}
                aria-label={`Open ${m.label}`}
              >
                <span
                  className="budget-dashboard-month-bar"
                  style={{ height: `${barHeight}px` }}
                />
                <span className="budget-dashboard-month-label">{m.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
