import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import {
  centsToInputString,
  formatUsd,
  parseMoneyToCents,
} from "./money";
import type {
  AppSettings,
  AppView,
  CrossYearOverview,
  DuplicateYearArgs,
  ExpenseBucketDto,
  ExpenseLineDto,
  IncomeLineDto,
  LibraryEntry,
  LineCalendarReport,
  LineRef,
  MonthRow,
  MonthView,
  MultiLineCalendarReport,
  RecentFile,
  ReportsViewSeed,
  WorkspaceLineCatalogEntry,
  WorkspaceMeta,
  YearOverview,
  YearRow,
} from "./types";
import {
  CalendarIcon,
  ListIcon,
  LockIcon,
  NewWindowIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
} from "./components/icons";
import {
  DateField,
  ExportPickerButton,
  IconButton,
  PlannedAmountInput,
  SaveStatusPill,
} from "./components/primitives";
import { BucketReorderModal } from "./components/modals/BucketReorderModal";
import { UnsavedChangesModal } from "./components/modals/UnsavedChangesModal";
import { ConfirmDeleteRowModal } from "./components/modals/ConfirmDeleteRowModal";
import { OpenInWindowModal } from "./components/modals/OpenInWindowModal";
import {
  ExpenseLineEditModal,
  type ExpenseLineEditConfig,
} from "./components/modals/ExpenseLineEditModal";
import { PasswordModal, type PasswordModalKind } from "./components/modals/PasswordModal";
import { PreferencesModal } from "./components/modals/PreferencesModal";
import { CreateYearModal } from "./components/modals/CreateYearModal";
import { RenameYearModal } from "./components/modals/RenameYearModal";
import { DeleteYearConfirmModal } from "./components/modals/DeleteYearConfirmModal";
import { RenameWorkspaceModal } from "./components/modals/RenameWorkspaceModal";
import { DeleteWorkspaceConfirmModal } from "./components/modals/DeleteWorkspaceConfirmModal";
import { DuplicateYearModal } from "./components/modals/DuplicateYearModal";
import { Sidebar } from "./components/sidebar/Sidebar";
import "./App.css";

function basenameNoExt(path: string): string {
  if (!path) return "";
  const lastSlash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const file = lastSlash >= 0 ? path.slice(lastSlash + 1) : path;
  const dot = file.lastIndexOf(".");
  return dot > 0 ? file.slice(0, dot) : file;
}

// Mirror a piece of state into a ref so async callbacks (menu
// listeners, IPC subscribers, autosave timers) can read the latest
// value without re-binding when the state changes. Replaces the
// useRef + useEffect boilerplate at every call site.
function useSyncedRef<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}

function varianceClassIncome(varianceCents: number): string {
  if (varianceCents > 0) return "variance-good";
  if (varianceCents < 0) return "variance-bad";
  return "";
}

function varianceClassExpense(varianceCents: number): string {
  if (varianceCents > 0) return "variance-good";
  if (varianceCents < 0) return "variance-bad";
  return "";
}

function selectAllOnFocus(e: React.FocusEvent<HTMLInputElement>) {
  e.currentTarget.select();
}

// The router state. Each kind corresponds to a single screen, with no
// hidden sub-modes. `years-landing` is the per-budget "pick a year"
// list; `year-overview` is the dashboard for one specific year. The
// previous `overview` kind multiplexed both based on whether `yearId`
// was null, and also had a third dead branch that fell back to the
// welcome screen on an empty workspace — now unreachable since the
// scratch DB is gone and bootstrap routes empties to `welcome`.
function WelcomeScreen({
  recentFiles,
  busy,
  onCreateYear,
  onOpenFile,
  onShowLibrary,
  onOpenRecent,
  onRevealFolder,
}: {
  recentFiles: RecentFile[];
  busy: boolean;
  onCreateYear: () => void;
  onOpenFile: () => void;
  onShowLibrary: () => void;
  onOpenRecent: (path: string) => void;
  onRevealFolder: () => void;
}) {
  return (
    <div className="welcome-screen">
      <div className="welcome-hero">
        <h1>Welcome to mimo</h1>
      </div>

      <div className="welcome-cards">
        <button
          type="button"
          className="welcome-card primary"
          onClick={onCreateYear}
          disabled={busy}
        >
          <span className="welcome-card-eyebrow">Create</span>
          <span className="welcome-card-title">Create a budget</span>
          <span className="welcome-card-sub">
            Names a new <code>.mimo</code> file in your default folder and
            scaffolds the current year's months for you.
          </span>
        </button>
        <button
          type="button"
          className="welcome-card"
          onClick={onShowLibrary}
          disabled={busy}
        >
          <span className="welcome-card-eyebrow">Browse</span>
          <span className="welcome-card-title">Browse the library</span>
          <span className="welcome-card-sub">
            See every budget in your default folder, with summaries.
          </span>
        </button>
        <button
          type="button"
          className="welcome-card"
          onClick={onOpenFile}
          disabled={busy}
        >
          <span className="welcome-card-eyebrow">Open</span>
          <span className="welcome-card-title">Open an existing budget…</span>
          <span className="welcome-card-sub">
            Opens any <code>.mimo</code> file from anywhere on disk.
          </span>
        </button>
      </div>

      <section className="welcome-recent">
        <header>
          <h2>Recent</h2>
          <button type="button" className="btn-link" onClick={onRevealFolder}>
            Show default folder in Finder
          </button>
        </header>
        {recentFiles.length === 0 ? (
          <p className="muted">No recent files yet.</p>
        ) : (
          <ul className="recent-list">
            {recentFiles.slice(0, 8).map((r) => (
              <li key={r.path}>
                <button
                  type="button"
                  className="recent-item"
                  onClick={() => onOpenRecent(r.path)}
                >
                  <span className="recent-name">{basename(r.path) || r.yearLabel}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// Soft banner shown in the year-landing and year-overview screens during
// November/December if the next calendar year hasn't been scaffolded yet.
// The CTA opens the duplicate-year modal pre-seeded with the latest source
// year, which already defaults its destination to currentYear+1.
function YearEndNudge({
  sourceLabel,
  nextLabel,
  onStart,
}: {
  sourceLabel: string;
  nextLabel: string;
  onStart: () => void;
}) {
  return (
    <div className="year-end-nudge" role="status">
      <div className="year-end-nudge-text">
        <strong>Plan {nextLabel} now?</strong>
        <span className="muted">
          {" "}
          Roll {sourceLabel} forward — buckets and projected amounts copy over,
          actuals stay put.
        </span>
      </div>
      <button type="button" className="btn primary" onClick={onStart}>
        Set up {nextLabel}
      </button>
    </div>
  );
}

// Budget dashboard. Replaces the old "pick a year" tile grid with a
// single screen that pulls double-duty: a year-totals strip that
// also acts as the year picker, plus a snapshot card for the current
// (or most recent) year so the user has something to look at instead
// of a wall of identical cards. Reuses existing IPC — no backend
// changes — and intentionally leaves the sidebar alone.
function BudgetDashboard({
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
  const YEARS_PER_PAGE = 8;
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

function basename(path: string): string {
  const parts = path.split(/[/\\]/);
  const last = parts[parts.length - 1] ?? path;
  return last.replace(/\.mimo$/i, "");
}

function LibraryView({
  entries,
  defaultFolder,
  busy,
  onRescan,
  onOpen,
  onOpenInNewWindow,
  onImport,
  onCreateYear,
  onRevealFolder,
  onRenameWorkspace,
  onDeleteWorkspace,
}: {
  entries: LibraryEntry[];
  defaultFolder: string | null;
  busy: boolean;
  onRescan: () => void;
  onOpen: (path: string) => void;
  onOpenInNewWindow: (path: string) => void;
  onImport: () => void;
  onCreateYear: () => void;
  onRevealFolder: () => void;
  onRenameWorkspace: (entry: LibraryEntry) => void;
  onDeleteWorkspace: (entry: LibraryEntry) => void;
}) {
  // Tiles read top-down alphabetically so users can scan a long library
  // by name. We use locale-aware comparison so accented or non-ASCII
  // workspace names land where users expect them. The backend returns
  // entries sorted by mtime, which is useful for the sidebar but not
  // for a grid that's about identification.
  const sortedEntries = useMemo(
    () =>
      [...entries].sort((a, b) =>
        basename(a.path).localeCompare(basename(b.path), undefined, {
          sensitivity: "base",
          numeric: true,
        }),
      ),
    [entries],
  );
  return (
    <div className="library-view">
      <header className="library-header">
        <div>
          <h1>Budget library</h1>
          {/* Source-folder line doubles as a quiet rescan affordance.
              The library auto-rescans on entry, so the button is only
              needed when the user adds a file via Finder while staying
              on this page — keeping it inline keeps it discoverable
              without competing with the primary actions on the right. */}
          <p className="muted library-source">
            From <code>{defaultFolder ?? "~/Documents/Budget"}</code>
            <button
              type="button"
              className="btn-link library-rescan"
              onClick={onRescan}
              disabled={busy}
              title="Re-read the default folder for changes"
            >
              {busy ? "Scanning…" : "Rescan"}
            </button>
          </p>
        </div>
        <div className="library-actions">
          <button type="button" className="btn secondary" onClick={onRevealFolder}>
            Show in Finder
          </button>
          <button type="button" className="btn secondary" onClick={onImport}>
            Import…
          </button>
          <button type="button" className="btn primary" onClick={onCreateYear}>
            <PlusIcon /> New budget
          </button>
        </div>
      </header>
      {sortedEntries.length === 0 ? (
        <div className="library-empty">
          <p>No budget files found in your default folder yet.</p>
          <p className="muted">Create one above, or open an existing file from elsewhere.</p>
        </div>
      ) : (
        <ul className="library-list">
          {sortedEntries.map((e) => {
            const lastEdited = e.lastEditedAt ?? e.lastModified;
            const name = basename(e.path);
            // Build the meta string once so the JSX reads cleanly.
            const labels = e.yearLabels ?? [];
            let yearText: string;
            if (labels.length === 0) {
              yearText = e.encrypted ? "Locked" : "No years";
            } else if (labels.length === 1) {
              yearText = labels[0];
            } else {
              const sorted = [...labels].sort();
              yearText = `${labels.length} years (${sorted[0]}–${sorted[sorted.length - 1]})`;
            }
            const tracked = e.trackedMonthCount ?? e.monthCount;
            const monthText = `${tracked} ${tracked === 1 ? "month" : "months"} tracked`;
            const rowClass = [
              "library-row",
              e.isConflictCopy ? "is-conflict" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <li key={e.path} className="library-list-item">
                <div
                  role="button"
                  tabIndex={0}
                  className={rowClass}
                  onClick={() => onOpen(e.path)}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter" || ev.key === " ") {
                      ev.preventDefault();
                      onOpen(e.path);
                    }
                  }}
                >
                  <div className="library-row-info">
                    <div className="library-row-title">
                      <span className="library-row-name">{name}</span>
                      {e.provider && (
                        <span
                          className="library-card-badge provider"
                          title={`Stored in ${e.provider}`}
                        >
                          {e.provider}
                        </span>
                      )}
                      {e.isConflictCopy && (
                        <span
                          className="library-card-badge conflict"
                          title="Cloud sync conflict copy. Compare with the canonical file before merging."
                        >
                          Conflict copy
                        </span>
                      )}
                      {e.encrypted && (
                        <span
                          className="library-card-lock"
                          title="Encrypted"
                        >
                          <LockIcon />
                        </span>
                      )}
                      <span
                        className="library-row-actions"
                        onClick={(ev) => ev.stopPropagation()}
                      >
                        <button
                          type="button"
                          className="library-card-action"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            ev.currentTarget.blur();
                            onOpenInNewWindow(e.path);
                          }}
                          title={`Open ${name} in a new window`}
                          aria-label={`Open ${name} in a new window`}
                        >
                          <NewWindowIcon size={14} />
                        </button>
                        <button
                          type="button"
                          className="library-card-action"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            ev.currentTarget.blur();
                            onRenameWorkspace(e);
                          }}
                          title={`Rename ${name}`}
                          aria-label={`Rename ${name}`}
                        >
                          <PencilIcon size={14} />
                        </button>
                        <button
                          type="button"
                          className="library-card-action danger"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            ev.currentTarget.blur();
                            onDeleteWorkspace(e);
                          }}
                          title={`Delete ${name}`}
                          aria-label={`Delete ${name}`}
                        >
                          <TrashIcon size={14} />
                        </button>
                      </span>
                    </div>
                    <div className="library-row-meta muted">
                      Edited {formatRelative(lastEdited)} · {yearText} · {monthText}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function formatRelative(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const now = Date.now();
  const diff = Math.max(0, now - t);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const days = Math.floor(hr / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.floor(days / 365);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

function YearOverviewView({
  overview,
  onActivateMonth,
  yearEndNudge,
  onStartYearEndNudge,
}: {
  overview: YearOverview;
  onActivateMonth: (id: number) => void;
  yearEndNudge: { sourceLabel: string; nextLabel: string } | null;
  onStartYearEndNudge: () => void;
}) {
  // Each card has its own three rows. Income and Expenses share the
  // Planned / Actual / Difference shape, but the Net card is a
  // different beast — it summarises the year by stacking actual
  // income against actual expenses, with the surplus/deficit as the
  // third row. We keep that intentionally inside the same totals grid
  // so the visual rhythm is consistent (three cards × three rows).
  type StatTone = "neutral" | "income-variance" | "expense-variance";
  type StatRow = { label: string; value: number; tone: StatTone };
  type TotalCard = { title: string; rows: StatRow[] };

  const incomeActual = overview.incomeActualCents;
  const expensesActual = overview.expenseNetActualCents;

  const totalCards: TotalCard[] = [
    {
      title: "Income",
      rows: [
        { label: "Planned", value: overview.incomePlannedCents, tone: "neutral" },
        { label: "Actual", value: incomeActual, tone: "neutral" },
        {
          label: "Difference",
          value: incomeActual - overview.incomePlannedCents,
          tone: "income-variance",
        },
      ],
    },
    {
      title: "Expenses",
      rows: [
        { label: "Planned", value: overview.expenseNetPlannedCents, tone: "neutral" },
        { label: "Actual", value: expensesActual, tone: "neutral" },
        {
          label: "Difference",
          // Under-spend is positive on an expense card, so we flip the
          // sign convention here: planned - actual.
          value: overview.expenseNetPlannedCents - expensesActual,
          tone: "expense-variance",
        },
      ],
    },
    {
      title: "Net",
      rows: [
        { label: "Income", value: incomeActual, tone: "neutral" },
        { label: "Expenses", value: expensesActual, tone: "neutral" },
        {
          label: "Difference",
          // Surplus (income − expenses) reads the same way as an
          // income variance: positive = good, negative = bad.
          value: incomeActual - expensesActual,
          tone: "income-variance",
        },
      ],
    },
  ];

  const toneClass = (tone: StatTone, value: number): string => {
    if (tone === "income-variance") return varianceClassIncome(value);
    if (tone === "expense-variance") return varianceClassExpense(value);
    return "";
  };

  return (
    <div className="year-overview">
      <header className="year-overview-header">
        <h1>{overview.yearLabel || "Year overview"}</h1>
        <p className="muted">
          {(() => {
            const tracked = overview.months.filter(
              (m) => m.incomeActualCents !== 0 || m.expenseNetActualCents !== 0,
            ).length;
            return `${tracked} ${tracked === 1 ? "month" : "months"} tracked`;
          })()}
        </p>
      </header>

      {yearEndNudge && (
        <YearEndNudge
          sourceLabel={yearEndNudge.sourceLabel}
          nextLabel={yearEndNudge.nextLabel}
          onStart={onStartYearEndNudge}
        />
      )}

      <section className="card">
        <h2>Year totals</h2>
        <div className="overview-totals">
          {totalCards.map((card) => (
            <div className="overview-total-card" key={card.title}>
              <div className="overview-total-label">{card.title}</div>
              <div className="overview-total-cols">
                {card.rows.map((row) => (
                  <div key={row.label}>
                    <div className="mini-label">{row.label}</div>
                    <div className={`num ${toneClass(row.tone, row.value)}`}>
                      {formatUsd(row.value, "rounded")}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>By bucket (annual)</h2>
        {overview.buckets.length === 0 ? (
          <p className="muted">No expense buckets yet.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Bucket</th>
                <th className="num">Planned</th>
                <th className="num">Actual</th>
                <th className="num">Variance</th>
              </tr>
            </thead>
            <tbody>
              {overview.buckets.map((b) => (
                <tr key={b.name}>
                  <td>{b.name}</td>
                  <td className="num">{formatUsd(b.plannedCents, "rounded")}</td>
                  <td className="num">{formatUsd(b.actualCents, "rounded")}</td>
                  <td className={`num ${varianceClassExpense(b.varianceCents)}`}>
                    {formatUsd(b.varianceCents, "rounded")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h2>By month</h2>
        {overview.months.length === 0 ? (
          <p className="muted">No months yet — add one from the sidebar.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Month</th>
                <th className="num">Income</th>
                <th className="num">Net expenses</th>
                <th className="num">Net</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {overview.months.map((m) => (
                <tr key={m.monthId}>
                  <td>{m.label}</td>
                  <td className="num">{formatUsd(m.incomeActualCents, "rounded")}</td>
                  <td className="num">{formatUsd(m.expenseNetActualCents, "rounded")}</td>
                  <td className={`num ${varianceClassExpense(m.netActualCents)}`}>
                    {formatUsd(m.netActualCents, "rounded")}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn-link"
                      onClick={() => onActivateMonth(m.monthId)}
                    >
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

// Cross-year view: a tall matrix that lets the user compare every year in
// the active workspace at a glance. Rows are buckets and lines, columns are
// years. Clicking a column header drops back into that year's overview so the
// user can drill in without losing the broader context.
// Same chunk size as the BudgetDashboard year strip — keeps the two
// surfaces visually paged identically (4 cols × 2 rows = 8 per page,
// down to 2 × 4 below the 720px breakpoint via shared CSS).
const CROSS_YEAR_TOTALS_PER_PAGE = 8;

function CrossYearView({
  data,
  loading,
  onJumpToYear,
  onBackToDashboard,
}: {
  data: CrossYearOverview | null;
  loading: boolean;
  onJumpToYear: (yearId: number) => void;
  onBackToDashboard: () => void;
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
          <button
            type="button"
            className="btn ghost cross-year-back"
            onClick={onBackToDashboard}
          >
            ← Back to dashboard
          </button>
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
        <button
          type="button"
          className="btn ghost cross-year-back"
          onClick={onBackToDashboard}
        >
          ← Back to dashboard
        </button>
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

// Aggregated row produced by collapsing one or more CrossYearLineRow
// entries that share a logical identity. We keep the original
// displayName / bucketName for labeling and add a stable groupKey
// for React keys.
type AggregatedLineRow = {
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
function aggregateLineRows(
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

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function lineRefKey(r: { lineKind: string; lineIdentity: string }) {
  return `${r.lineKind}:${r.lineIdentity}`;
}

function MonthlyBarsChart({
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

function YtdSlideOver({
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

function ReportsView({
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


function YtdDualStrip({ view }: { view: MonthView }) {
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

// Small split-button: click the main face for the default (detailed) export,
// click the caret for the picker that exposes the redacted variant. Keeps the
// happy path one click and tucks the privacy-sensitive option behind a
// disclosure so first-time users aren't paralyzed by the choice.
function MonthBudgetView({
  view,
  expandedIncome,
  expandedExpense,
  onToggleIncome,
  onToggleExpense,
  onRefresh,
  onAddRow,
  onEditRow,
  onDeleteRow,
  onOpenReorder,
  onOpenLineYtd,
  onExportCsv,
  onExportJson,
  onExportCsvRedacted,
  onExportJsonRedacted,
}: {
  view: MonthView;
  expandedIncome: Set<number>;
  expandedExpense: Set<number>;
  onToggleIncome: (id: number) => void;
  onToggleExpense: (id: number) => void;
  onRefresh: () => void;
  onAddRow: (bucketId: number) => void;
  onEditRow: (lineId: number) => void;
  onDeleteRow: (lineId: number, name: string) => void;
  onOpenReorder: () => void;
  onOpenLineYtd: (args: {
    lineKind: "income" | "expense";
    lineIdentity: string;
    year: number;
    asOf: string | null;
  }) => void;
  onExportCsv: () => void;
  onExportJson: () => void;
  onExportCsvRedacted: () => void;
  onExportJsonRedacted: () => void;
}) {
  return (
    <>
      <header className="month-view-header">
        <h1>{view.tabLabel}</h1>
        <div className="month-view-toolbar">
          <ExportPickerButton
            label="Export CSV"
            formatLabel="CSV"
            onDetailed={onExportCsv}
            onRedacted={onExportCsvRedacted}
          />
          <ExportPickerButton
            label="Export JSON"
            formatLabel="JSON"
            onDetailed={onExportJson}
            onRedacted={onExportJsonRedacted}
          />
        </div>
      </header>

      <YtdDualStrip view={view} />


      <section className="card summary-card">
        <h2>Monthly summary</h2>
        <div className="summary-grid">
          <SummaryRow
            label="Total income"
            planned={view.summary.incomePlannedCents}
            actual={view.summary.incomeActualCents}
            diff={view.summary.incomeVarianceCents}
            diffClass={varianceClassIncome(view.summary.incomeVarianceCents)}
          />
          <SummaryRow
            label="Total expenses (net)"
            planned={view.summary.expenseNetPlannedCents}
            actual={view.summary.expenseNetActualCents}
            diff={view.summary.expenseNetVarianceCents}
            diffClass={varianceClassExpense(view.summary.expenseNetVarianceCents)}
          />
          <SummaryRow
            label="Neutral transfers (tracking)"
            planned={view.summary.neutralExpensePlannedCents}
            actual={view.summary.neutralExpenseActualCents}
            diff={
              view.summary.neutralExpensePlannedCents - view.summary.neutralExpenseActualCents
            }
            diffClass=""
            note="Excluded from net spend totals"
          />
          <SummaryRow
            label="Net"
            planned={view.summary.netPlannedCents}
            actual={view.summary.netActualCents}
            diff={view.summary.netVarianceCents}
            diffClass={varianceClassExpense(view.summary.netVarianceCents)}
          />
        </div>
      </section>

      <section className="card">
        <h2>Income</h2>
        <table className="data-table budget-line-table">
          <colgroup>
            <col />
            <col className="col-money" />
            <col className="col-money" />
            <col className="col-money" />
            <col className="col-actions" />
          </colgroup>
          <thead>
            <tr>
              <th>Line</th>
              <th className="num">Planned</th>
              <th className="num">Actual</th>
              <th className="num">Difference</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {view.incomeLines.map((line) => (
              <IncomeLineBlock
                key={line.id}
                line={line}
                budgetYearMonth={view.yearMonth}
                expanded={expandedIncome.has(line.id)}
                onToggle={() => onToggleIncome(line.id)}
                onRefresh={onRefresh}
                onOpenYtd={() =>
                  onOpenLineYtd({
                    lineKind: "income",
                    lineIdentity: line.lineIdentity,
                    year: Number(view.periodEnd.slice(0, 4)),
                    asOf: view.periodEnd,
                  })
                }
              />
            ))}
          </tbody>
        </table>
      </section>

      <div className="buckets-toolbar">
        <button
          type="button"
          className="btn secondary"
          onClick={onOpenReorder}
          title="Open the bucket reorder window (⌘R)"
        >
          Reorganize
        </button>
      </div>
      {view.expenseBuckets.map((bucket) => (
        <section key={bucket.id} className="card bucket-card">
          <div className="bucket-header">
            <h2>{bucket.name}</h2>
          </div>
          <table className="data-table budget-line-table">
            <colgroup>
              <col />
              <col className="col-money" />
              <col className="col-money" />
              <col className="col-money" />
              <col className="col-actions" />
            </colgroup>
            <thead>
              <tr>
                <th>Line</th>
                <th className="num">Planned</th>
                <th className="num">Actual</th>
                <th className="num">Variance</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {bucket.lines.map((line) => (
                <ExpenseLineBlock
                  key={line.id}
                  line={line}
                  budgetYearMonth={view.yearMonth}
                  expanded={expandedExpense.has(line.id)}
                  onToggle={() => onToggleExpense(line.id)}
                  onRefresh={onRefresh}
                  onEdit={() => onEditRow(line.id)}
                  onDelete={() => onDeleteRow(line.id, line.name)}
                  onOpenYtd={() =>
                    onOpenLineYtd({
                      lineKind: "expense",
                      lineIdentity: line.lineIdentity,
                      year: Number(view.periodEnd.slice(0, 4)),
                      asOf: view.periodEnd,
                    })
                  }
                />
              ))}
            </tbody>
          </table>
          <div className="bucket-footer">
            <button
              type="button"
              className="btn-link"
              onClick={() => onAddRow(bucket.id)}
            >
              + Add row
            </button>
          </div>
        </section>
      ))}
    </>
  );
}

export default function App() {
  const [months, setMonths] = useState<MonthRow[]>([]);
  const [years, setYears] = useState<YearRow[]>([]);
  const [sidebarYearId, setSidebarYearId] = useState<number | null>(null);
  const [view, setView] = useState<AppView>({ kind: "welcome" });
  const [monthView, setMonthView] = useState<MonthView | null>(null);
  const [yearOverview, setYearOverview] = useState<YearOverview | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [libraryEntries, setLibraryEntries] = useState<LibraryEntry[]>([]);
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [createYearOpen, setCreateYearOpen] = useState(false);
  const [createYearMode, setCreateYearMode] = useState<"budget" | "year">("year");
  const [createYearBusy, setCreateYearBusy] = useState(false);
  const [renameYearTarget, setRenameYearTarget] = useState<YearRow | null>(null);
  const [renameYearBusy, setRenameYearBusy] = useState(false);
  const [deleteYearTarget, setDeleteYearTarget] = useState<YearRow | null>(null);
  const [deleteYearBusy, setDeleteYearBusy] = useState(false);
  const [duplicateYearTarget, setDuplicateYearTarget] = useState<YearRow | null>(null);
  const [duplicateYearBusy, setDuplicateYearBusy] = useState(false);
  const [duplicateYearMonths, setDuplicateYearMonths] = useState<MonthRow[]>([]);
  const [renameWorkspaceTarget, setRenameWorkspaceTarget] = useState<LibraryEntry | null>(
    null,
  );
  const [renameWorkspaceBusy, setRenameWorkspaceBusy] = useState(false);
  const [deleteWorkspaceTarget, setDeleteWorkspaceTarget] = useState<LibraryEntry | null>(
    null,
  );
  const [deleteWorkspaceBusy, setDeleteWorkspaceBusy] = useState(false);
  // When the user picks a tile in the library while a real budget is
  // already open, we ask whether to take over this window or open the
  // tile in a new one. `null` = no prompt; otherwise it carries the
  // pending file path so the choice handler knows what to launch.
  const [libraryOpenChoice, setLibraryOpenChoice] = useState<{ path: string } | null>(null);
  const [isDefaultWorkspace, setIsDefaultWorkspace] = useState(true);
  const [workspaceMeta, setWorkspaceMeta] = useState<WorkspaceMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [expandedIncome, setExpandedIncome] = useState<Set<number>>(new Set());
  const [expandedExpense, setExpandedExpense] = useState<Set<number>>(new Set());
  const [dbPath, setDbPath] = useState<string>("");
  const [reorderModalOpen, setReorderModalOpen] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [passwordModal, setPasswordModal] = useState<PasswordModalKind | null>(
    null,
  );
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [encryptionAvailable, setEncryptionAvailable] = useState(false);
  const [workspaceEncrypted, setWorkspaceEncrypted] = useState(false);
  const encryptionAvailableRef = useRef(false);
  const workspaceEncryptedRef = useRef(false);
  useEffect(() => {
    encryptionAvailableRef.current = encryptionAvailable;
  }, [encryptionAvailable]);
  useEffect(() => {
    workspaceEncryptedRef.current = workspaceEncrypted;
  }, [workspaceEncrypted]);
  const [autoSaveOn, setAutoSaveOn] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [snapshotState, setSnapshotState] = useState<{
    busy: boolean;
    lastAt: number | null;
  }>({ busy: false, lastAt: null });
  const [saveToast, setSaveToast] = useState<string | null>(null);
  const [unsavedPromptOpen, setUnsavedPromptOpen] = useState(false);
  const [unsavedBusy, setUnsavedBusy] = useState(false);
  const [lineEditConfig, setLineEditConfig] = useState<ExpenseLineEditConfig | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{
    lineId: number;
    name: string;
  } | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [ytdDrawer, setYtdDrawer] = useState<{
    lineKind: "income" | "expense";
    lineIdentity: string;
    year: number;
    asOf: string | null;
  } | null>(null);
  const [ytdReport, setYtdReport] = useState<LineCalendarReport | null>(null);
  const [ytdLoading, setYtdLoading] = useState(false);
  const [reportsInitial, setReportsInitial] = useState<ReportsViewSeed | null>(null);
  const [crossYear, setCrossYear] = useState<CrossYearOverview | null>(null);
  const [crossYearLoading, setCrossYearLoading] = useState(false);
  // Loading flag for the years-landing dashboard's snapshot card
  // (separate from yearOverview so the snapshot fetch doesn't blank
  // the year-overview screen when the user toggles between views).
  const [dashboardSnapshotLoading, setDashboardSnapshotLoading] =
    useState(false);
  // User-driven year override for the dashboard snapshot. null means
  // "follow the default" (calendar year if present, else most recent),
  // computed below as `dashboardCurrentYearId`. Clicking a year card on
  // the dashboard sets this; entering the dashboard view resets it so
  // re-entry always lands on the default year.
  const [dashboardSelectedYearId, setDashboardSelectedYearId] = useState<
    number | null
  >(null);

  // Launcher views are the home screen and the library browser. They
  // exist outside of any specific budget — no DB connection, no
  // dirty-tracking, no autosave, no save pill, no in-budget chrome.
  // Computed eagerly so effects below can depend on it without
  // forward-references.
  const isLauncherView = view.kind === "welcome" || view.kind === "library";

  const monthsRef = useSyncedRef(months);
  const viewRef = useSyncedRef(view);
  const monthViewRef = useSyncedRef(monthView);
  const sidebarYearIdRef = useSyncedRef(sidebarYearId);
  const yearsRef = useSyncedRef(years);

  useEffect(() => {
    if (!ytdDrawer) {
      setYtdReport(null);
      return;
    }
    let cancelled = false;
    setYtdLoading(true);
    void invoke<LineCalendarReport>("get_line_calendar_report", {
      year: ytdDrawer.year,
      lineKind: ytdDrawer.lineKind,
      lineIdentity: ytdDrawer.lineIdentity,
      asOf: ytdDrawer.asOf,
    })
      .then((r) => {
        if (!cancelled) setYtdReport(r);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setYtdLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ytdDrawer]);

  // Keep the OS title bar empty. The active budget is shown by the
  // in-app sidebar chip; mimicking Finder / Notes / Reminders, the
  // window chrome stays untitled. We still actively set "" here so any
  // stale title from a prior session or backend call is cleared.
  useEffect(() => {
    if (loading) return;
    void getCurrentWindow().setTitle("");
  }, [loading]);

  const toggleIncome = (id: number) => {
    setExpandedIncome((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const toggleExpense = (id: number) => {
    setExpandedExpense((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  useEffect(() => {
    setExpandedIncome(new Set());
    setExpandedExpense(new Set());
  }, [view]);

  const refreshMonthView = useCallback(async (monthId: number) => {
    setError(null);
    const v = await invoke<MonthView>("get_month_view", { monthId });
    setMonthView(v);
  }, []);

  const refreshOverview = useCallback(async (yearId?: number | null) => {
    setError(null);
    const target = yearId === undefined ? sidebarYearIdRef.current : yearId;
    const o = await invoke<YearOverview>("get_year_overview", { yearId: target ?? null });
    setYearOverview(o);
  }, []);

  const refreshMonths = useCallback(async (yearId?: number | null) => {
    const target = yearId === undefined ? sidebarYearIdRef.current : yearId;
    let list: MonthRow[];
    if (target != null) {
      list = await invoke<MonthRow[]>("list_months_for_year", { yearId: target });
    } else {
      list = await invoke<MonthRow[]>("list_months");
    }
    setMonths(list);
    return list;
  }, []);

  const refreshYears = useCallback(async () => {
    const list = await invoke<YearRow[]>("list_years");
    setYears(list);
    return list;
  }, []);

  const refreshSettings = useCallback(async () => {
    const s = await invoke<AppSettings>("get_settings");
    setSettings(s);
    setSidebarCollapsed(Boolean(s.sidebarCollapsed));
    setRecentFiles(s.recentFiles ?? []);
    return s;
  }, []);

  const refreshWorkspaceMeta = useCallback(async () => {
    try {
      const meta = await invoke<WorkspaceMeta>("get_workspace_meta");
      setWorkspaceMeta(meta);
      return meta;
    } catch (e) {
      // Best effort: leave the previous value in place so the UI never blanks
      // out the workspace title just because of a transient connection issue.
      // Surface the error so the user knows something is off.
      setError(String(e));
      return null;
    }
  }, []);

  const refreshLibrary = useCallback(async () => {
    try {
      const idx = await invoke<LibraryEntry[]>("get_library_index");
      setLibraryEntries(idx);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const rescanLibrary = useCallback(async () => {
    setBusy(true);
    try {
      const idx = await invoke<LibraryEntry[]>("scan_library");
      setLibraryEntries(idx);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  // Library tile actions: keep the modal targets and the actual file IO
  // separate so the tile click handler stays cheap and the workspace
  // mutation only fires when the user confirms.
  const onRequestRenameWorkspace = useCallback((entry: LibraryEntry) => {
    setRenameWorkspaceTarget(entry);
  }, []);

  const onRequestDeleteWorkspace = useCallback((entry: LibraryEntry) => {
    setDeleteWorkspaceTarget(entry);
  }, []);

  const onConfirmRenameWorkspace = useCallback(
    async (newName: string) => {
      if (!renameWorkspaceTarget) return;
      setRenameWorkspaceBusy(true);
      try {
        await invoke<string>("rename_workspace_file", {
          path: renameWorkspaceTarget.path,
          newName,
        });
        setRenameWorkspaceTarget(null);
        await rescanLibrary();
      } catch (e) {
        setError(String(e));
      } finally {
        setRenameWorkspaceBusy(false);
      }
    },
    [renameWorkspaceTarget, rescanLibrary],
  );

  const onConfirmDeleteWorkspace = useCallback(async () => {
    if (!deleteWorkspaceTarget) return;
    setDeleteWorkspaceBusy(true);
    try {
      await invoke("delete_workspace_file", { path: deleteWorkspaceTarget.path });
      setDeleteWorkspaceTarget(null);
      await rescanLibrary();
    } catch (e) {
      setError(String(e));
    } finally {
      setDeleteWorkspaceBusy(false);
    }
  }, [deleteWorkspaceTarget, rescanLibrary]);

  const bootstrap = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // After the scratch elimination, the window starts with NO budget
      // open. `get_database_path` returns "" and `has_open_budget`
      // returns false in that state. We treat both as "show home, run
      // no data fetches".
      const path = await invoke<string>("get_database_path");
      setDbPath(path);
      const hasBudget = await invoke<boolean>("has_open_budget");
      setIsDefaultWorkspace(!hasBudget);

      try {
        const supported = await invoke<boolean>("encryption_supported");
        setEncryptionAvailable(supported);
      } catch {
        // best effort
      }

      // Always refresh the global settings + library so the home tiles
      // (recent files, library card, default folder) are accurate.
      void refreshSettings();
      void refreshLibrary();

      if (!hasBudget) {
        // Fresh launcher state — no DB connection, no year list, no
        // workspace meta, no autosave. The user gets the welcome
        // screen and picks where to go from there.
        setWorkspaceEncrypted(false);
        setSidebarYearId(null);
        setMonths([]);
        setYears([]);
        setYearOverview(null);
        setWorkspaceMeta(null);
        setAutoSaveOn(false);
        setView({ kind: "welcome" });
        return;
      }

      // Detect whether the active file is encrypted before issuing any
      // schema queries. The backend opens lazily, so this avoids the
      // first command throwing an "ENCRYPTED:" error mid-bootstrap.
      try {
        const enc = await invoke<boolean>("workspace_is_encrypted", { path });
        setWorkspaceEncrypted(enc);
        if (enc) {
          setPasswordError(null);
          setPasswordModal("unlock");
          setLoading(false);
          return;
        }
      } catch {
        // best effort - if the probe fails we'll fall back to the
        // ENCRYPTED-error branch below on the first real command.
      }

      const initialYears = await refreshYears();
      void refreshWorkspaceMeta();
      const autoSave = await invoke<boolean>("get_auto_save");
      setAutoSaveOn(autoSave);

      // Backfill: ensure every existing year has all 12 calendar months. This is
      // a one-shot reconcile that legacy files (pre-v3) will benefit from.
      // We still re-pull the years list afterward so any state derived
      // from per-year metadata reflects the post-backfill shape.
      let yearList = initialYears;
      if (initialYears.length > 0) {
        for (const y of initialYears) {
          try {
            await invoke<number[]>("ensure_year_months", { yearId: y.id });
          } catch {
            // ignore — best effort
          }
        }
        yearList = await refreshYears();
      }

      // Dashboard is the canonical per-budget landing page. Even when
      // years exist we drop the user there first so they see the
      // overview snapshot and can pick which year to enter from the
      // sidebar's "Go to year" list. This also means a freshly
      // opened budget never auto-loads a year's months — the user
      // chooses their entry point explicitly. Year-scoped state is
      // cleared so a stale year/month doesn't bleed across budgets.
      setSidebarYearId(null);
      sidebarYearIdRef.current = null;
      setMonths([]);

      // Pre-populate the dashboard snapshot for the default year so
      // the page never lands blank. The default mirrors
      // `dashboardCurrentYearId`: prefer the calendar year if it's in
      // this budget, otherwise the most recent. The dashboard's own
      // refresh effect will still re-fetch on view re-entry.
      if (yearList.length > 0) {
        const calLabel = String(new Date().getFullYear());
        const target =
          yearList.find((y) => y.yearLabel === calLabel) ?? yearList[0];
        try {
          await refreshOverview(target.id);
        } catch {
          // Snapshot is non-critical for landing; the dashboard's own
          // effect will retry on mount and surface real errors there.
          setYearOverview(null);
        }
      } else {
        setYearOverview(null);
      }

      setView({ kind: "years-landing" });
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [
    refreshYears,
    refreshOverview,
    refreshSettings,
    refreshLibrary,
    refreshWorkspaceMeta,
  ]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  // Keep macOS's single global menu bar in sync with the focused
  // window's context. In-budget items (Save As, Reports, Reorganize,
  // Year Overview, etc.) get greyed when this window is on a launcher
  // view so the user can't trigger commands against a budget that
  // doesn't exist. We re-push on view changes AND on focus so a
  // multi-window setup always reflects the foreground window.
  useEffect(() => {
    const sync = () => {
      void invoke("set_menu_context", {
        hasBudget: !isDefaultWorkspace,
        onLibrary: view.kind === "library",
      });
    };
    sync();
    let unlisten: UnlistenFn | undefined;
    void getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (focused) sync();
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => {
      unlisten?.();
    };
  }, [isDefaultWorkspace, view.kind]);

  const activateMonth = useCallback(
    async (monthId: number) => {
      const current = viewRef.current;
      if (current.kind === "month" && current.monthId === monthId) return;
      setBusy(true);
      setError(null);
      try {
        flushSync(() => {
          setYtdDrawer(null);
          setView({ kind: "month", monthId });
        });
        await refreshMonthView(monthId);
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
    },
    [refreshMonthView],
  );

  const cycleMonth = useCallback(
    (direction: 1 | -1) => {
      const list = monthsRef.current;
      if (list.length === 0) return;
      const current = viewRef.current;
      const sorted = [...list].sort((a, b) => a.periodStart.localeCompare(b.periodStart));
      const ids = sorted.map((m) => m.id);
      let idx = -1;
      if (current.kind === "month") {
        idx = ids.indexOf(current.monthId);
      }
      if (idx === -1) {
        void activateMonth(ids[direction === 1 ? 0 : ids.length - 1]);
        return;
      }
      const next = (idx + direction + ids.length) % ids.length;
      void activateMonth(ids[next]);
    },
    [activateMonth],
  );

  const showOverview = useCallback(async () => {
    setYtdDrawer(null);
    setBusy(true);
    try {
      const yid = sidebarYearIdRef.current;
      await refreshOverview(yid);
      // No active year ⇒ show the years-landing for this budget.
      setView(yid != null ? { kind: "year-overview", yearId: yid } : { kind: "years-landing" });
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [refreshOverview]);

  // Returns the user to the welcome screen (the "tiles" landing page they
  // see on first launch). The sidebar is hidden while this view is active
  // since none of its navigation applies until a workspace is opened.
  const showHome = useCallback(() => {
    setError(null);
    setYtdDrawer(null);
    setView({ kind: "welcome" });
  }, []);

  const showLibrary = useCallback(async () => {
    setYtdDrawer(null);
    // Show cached entries instantly so navigation feels snappy, then kick off a
    // fresh disk scan in the background so the list reflects any files the user
    // added/removed/renamed outside the app since last visit.
    try {
      await refreshLibrary();
      setView({ kind: "library" });
    } catch (e) {
      setError(String(e));
    }
    void rescanLibrary();
  }, [refreshLibrary, rescanLibrary]);

  const onReportsInitialApplied = useCallback(() => setReportsInitial(null), []);

  const showReports = useCallback((seed?: ReportsViewSeed) => {
    setError(null);
    setYtdDrawer(null);
    setReportsInitial(seed ?? null);
    setView({ kind: "reports" });
  }, []);

  const refreshCrossYear = useCallback(async () => {
    setCrossYearLoading(true);
    try {
      const data = await invoke<CrossYearOverview>("get_cross_year_overview");
      setCrossYear(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setCrossYearLoading(false);
    }
  }, []);

  // Default year for the dashboard snapshot. Prefers the calendar
  // year if it exists in this budget, otherwise falls back to the
  // most-recent year (list_years sorts year_label DESC).
  const dashboardCurrentYearId = useMemo<number | null>(() => {
    if (years.length === 0) return null;
    const cal = String(new Date().getFullYear());
    const match = years.find((y) => y.yearLabel === cal);
    return (match ?? years[0]).id;
  }, [years]);

  // Effective year shown in the snapshot card. Honours the user's
  // last click on a year card if that year still exists; otherwise
  // falls back to the default. This keeps the dashboard usable when
  // a year is renamed/deleted out from under the selection.
  const effectiveDashboardYearId = useMemo<number | null>(() => {
    if (
      dashboardSelectedYearId != null &&
      years.some((y) => y.id === dashboardSelectedYearId)
    ) {
      return dashboardSelectedYearId;
    }
    return dashboardCurrentYearId;
  }, [dashboardSelectedYearId, dashboardCurrentYearId, years]);

  // Mirror into a ref so quick-switch handlers (e.g. opening a month
  // from the dashboard's snapshot strip) can read the current value
  // without forcing a callback rebuild every time the selection
  // changes.
  const effectiveDashboardYearIdRef = useRef<number | null>(
    effectiveDashboardYearId,
  );
  useEffect(() => {
    effectiveDashboardYearIdRef.current = effectiveDashboardYearId;
  }, [effectiveDashboardYearId]);

  // Reset the user override every time we enter the dashboard so a
  // fresh visit always shows the default year. Without this, picking
  // 2025 then leaving via the sidebar and coming back would still
  // show 2025 even though the dashboard's "default focus" is the
  // calendar year.
  useEffect(() => {
    if (view.kind !== "years-landing") return;
    setDashboardSelectedYearId(null);
  }, [view.kind]);

  // When the user lands on / re-enters the dashboard, refresh both
  // the cross-year totals (powers the year-picker strip) and the
  // selected-year snapshot (powers the lower card). We refetch on
  // every entry and on every year-card click so the dashboard
  // reflects edits made in any year the user has been bouncing
  // through.
  useEffect(() => {
    if (view.kind !== "years-landing") return;
    void refreshCrossYear();
    if (effectiveDashboardYearId == null) {
      setYearOverview(null);
      return;
    }
    let cancelled = false;
    setDashboardSnapshotLoading(true);
    invoke<YearOverview>("get_year_overview", {
      yearId: effectiveDashboardYearId,
    })
      .then((o) => {
        if (!cancelled) setYearOverview(o);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setDashboardSnapshotLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [view.kind, effectiveDashboardYearId, refreshCrossYear]);

  const showCrossYear = useCallback(async () => {
    setError(null);
    setYtdDrawer(null);
    setSidebarYearId(null);
    sidebarYearIdRef.current = null;
    setView({ kind: "cross-year" });
    await refreshCrossYear();
  }, [refreshCrossYear]);

  // Launcher views (home + library) exist outside of any specific
  // budget — picking a tile from there is "decide what to work on",
  // not "spawn a second workspace". So opening from a launcher view
  // always reuses the current window. From inside a real budget,
  // opening another file always spawns a new window so the in-flight
  // one isn't silently blown away. The unsaved-changes prompt fires
  // automatically when reuse closes a dirty budget.
  const shouldReuseCurrentWindow = useCallback(
    () => viewRef.current.kind === "welcome" || viewRef.current.kind === "library",
    [],
  );

  const openWorkspaceFromHome = useCallback(
    async (filePath: string, opts?: { forceNewWindow?: boolean }) => {
      const reuse = !opts?.forceNewWindow && shouldReuseCurrentWindow();
      if (reuse) {
        await invoke("open_budget_in_current_window", { filePath });
        await bootstrap();
      } else {
        await invoke("open_budget_in_new_window", { filePath });
      }
      void refreshSettings();
    },
    [shouldReuseCurrentWindow, bootstrap, refreshSettings],
  );

  const onOpenFile = useCallback(async () => {
    try {
      const defaultDir = settings?.defaultFolder ?? undefined;
      const picked = await openDialog({
        multiple: false,
        directory: false,
        defaultPath: defaultDir,
        filters: [
          { name: "mimo file", extensions: ["mimo"] },
        ],
      });
      const filePath = typeof picked === "string" ? picked : null;
      if (!filePath) return;
      await openWorkspaceFromHome(filePath);
    } catch (e) {
      setError(String(e));
    }
  }, [settings, openWorkspaceFromHome]);

  const onSaveAs = useCallback(async (): Promise<boolean> => {
    try {
      const defaultDir = settings?.defaultFolder ?? undefined;
      const currentBase = basenameNoExt(dbPath);
      const suggested = currentBase || "mimo";
      const target = await saveDialog({
        title: "Save as",
        defaultPath: defaultDir
          ? `${defaultDir}/${suggested}.mimo`
          : `${suggested}.mimo`,
        filters: [{ name: "mimo file", extensions: ["mimo"] }],
      });
      if (!target) return false;
      await invoke("save_budget_as", { targetPath: target });
      const newPath = await invoke<string>("get_database_path");
      setDbPath(newPath);
      const hasBudget = await invoke<boolean>("has_open_budget");
      setIsDefaultWorkspace(!hasBudget);
      void refreshSettings();
      void refreshWorkspaceMeta();
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    }
  }, [settings, dbPath, refreshSettings, refreshWorkspaceMeta]);

  const showSaveToast = useCallback((msg: string) => {
    setSaveToast(msg);
    window.setTimeout(() => {
      setSaveToast((cur) => (cur === msg ? null : cur));
    }, 1800);
  }, []);

  const onPasswordSubmit = useCallback(
    async (password: string) => {
      if (!passwordModal) return;
      setPasswordBusy(true);
      setPasswordError(null);
      try {
        if (passwordModal === "unlock") {
          const ok = await invoke<boolean>("unlock_workspace", { password });
          if (!ok) {
            setPasswordError("Wrong password — try again.");
            return;
          }
          setWorkspaceEncrypted(true);
          setPasswordModal(null);
          await bootstrap();
        } else if (passwordModal === "set") {
          await invoke("encrypt_workspace", { password });
          setWorkspaceEncrypted(true);
          setPasswordModal(null);
          showSaveToast("Budget encrypted");
        } else if (passwordModal === "change") {
          await invoke("change_workspace_password", { newPassword: password });
          setPasswordModal(null);
          showSaveToast("Password changed");
        }
      } catch (e) {
        setPasswordError(String(e));
      } finally {
        setPasswordBusy(false);
      }
    },
    [passwordModal, bootstrap, showSaveToast],
  );

  const onCmdS = useCallback(async () => {
    // Cmd+S used to spring a Save As sheet whenever the active window
    // had no real `.mimo` file behind it — but on the launcher screens
    // that's confusing: there's nothing to save. After the scratch
    // elimination, "no file" means "user is on home/library", so we
    // short-circuit silently. For real budgets the file is always
    // up-to-date because edits write through, so Cmd+S just confirms.
    if (isLauncherView) return;
    try {
      const hasBudget = await invoke<boolean>("has_open_budget");
      if (!hasBudget) return;
      showSaveToast("Already saved");
    } catch (e) {
      setError(String(e));
    }
  }, [isLauncherView, showSaveToast]);

  // Two flavors of "create": from the home/library screens we open a New
  // Budget wizard that produces a brand-new `.mimo` file; from inside an
  // existing budget the same modal becomes a plain "+ New year" prompt
  // that adds another calendar year. Mode is decided by the caller so each
  // entry point reflects the user's actual intent.
  const onCreateBudget = useCallback(() => {
    setCreateYearMode("budget");
    setCreateYearOpen(true);
  }, []);
  const onCreateYear = useCallback(() => {
    setCreateYearMode("year");
    setCreateYearOpen(true);
  }, []);

  const enterYear = useCallback(
    async (yearId: number) => {
      setBusy(true);
      try {
        setSidebarYearId(yearId);
        sidebarYearIdRef.current = yearId;
        await refreshMonths(yearId);
        await refreshOverview(yearId);
        flushSync(() => {
          setView({ kind: "year-overview", yearId });
        });
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
    },
    [refreshMonths, refreshOverview],
  );

  const exitYear = useCallback(() => {
    setSidebarYearId(null);
    sidebarYearIdRef.current = null;
    setMonths([]);
    setYearOverview(null);
    setView({ kind: "years-landing" });
  }, []);

  // Quick-switch from the dashboard's snapshot month strip into the
  // month's data-entry screen. The strip is always rendered for the
  // dashboard's selected year, which may differ from whichever year
  // is currently "entered" in the sidebar — so we enter that year
  // first (no-op if already entered), then activate the month.
  const openMonthFromDashboard = useCallback(
    async (monthId: number) => {
      const yearId = effectiveDashboardYearIdRef.current;
      if (yearId == null) return;
      if (sidebarYearIdRef.current !== yearId) {
        await enterYear(yearId);
      }
      await activateMonth(monthId);
    },
    [enterYear, activateMonth],
  );

  const onCreateYearSubmit = useCallback(
    async (label: string) => {
      setCreateYearBusy(true);
      try {
        if (createYearMode === "budget") {
          // Spawn a brand-new `.mimo` file in the default folder. Always
          // scaffold the current calendar year so the new budget opens
          // ready to enter data; users can add more years later via the
          // sidebar's "+ New year" button.
          const reuse = shouldReuseCurrentWindow();
          const currentYear = new Date().getFullYear();
          await invoke<string>("create_year_workspace", {
            yearLabel: label,
            scaffoldYearValue: currentYear,
            reuseCurrentWindow: reuse,
          });
          setCreateYearOpen(false);
          if (reuse) {
            // Backend already swapped this window's connection over to
            // the new file; rerun the bootstrap so all in-memory state
            // (years, sidebar, view) reflects it.
            await bootstrap();
          }
          void refreshSettings();
        } else {
          const newId = await invoke<number>("create_year", { yearLabel: label });
          await refreshYears();
          setCreateYearOpen(false);
          await enterYear(newId);
        }
      } catch (e) {
        setError(String(e));
      } finally {
        setCreateYearBusy(false);
      }
    },
    [
      createYearMode,
      refreshYears,
      enterYear,
      shouldReuseCurrentWindow,
      bootstrap,
      refreshSettings,
    ],
  );

  const onRenameYearSubmit = useCallback(
    async (label: string) => {
      const target = renameYearTarget;
      if (!target) return;
      setRenameYearBusy(true);
      try {
        await invoke<string>("rename_year", { yearId: target.id, yearLabel: label });
        setRenameYearTarget(null);
        await refreshYears();
        const yid = sidebarYearIdRef.current;
        if (yid != null) {
          await refreshMonths(yid);
          await refreshOverview(yid);
        }
      } catch (e) {
        setError(String(e));
      } finally {
        setRenameYearBusy(false);
      }
    },
    [renameYearTarget, refreshYears, refreshMonths, refreshOverview],
  );

  const onDeleteYearConfirm = useCallback(async () => {
    const target = deleteYearTarget;
    if (!target) return;
    setDeleteYearBusy(true);
    try {
      await invoke("delete_year", { yearId: target.id });
      setDeleteYearTarget(null);
      const list = await refreshYears();
      const stillSelected = list.find((y) => y.id === sidebarYearIdRef.current);
      if (!stillSelected) {
        if (list.length === 0) {
          setSidebarYearId(null);
          sidebarYearIdRef.current = null;
          setMonths([]);
          setView({ kind: "welcome" });
        } else {
          await enterYear(list[0].id);
        }
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setDeleteYearBusy(false);
    }
  }, [deleteYearTarget, refreshYears, enterYear]);

  const openDuplicateYearModal = useCallback(
    async (yearId?: number) => {
      const id = yearId ?? sidebarYearIdRef.current;
      if (id == null) return;
      const target = yearsRef.current.find((y) => y.id === id) ?? null;
      if (!target) return;
      try {
        const sourceMonths = await invoke<MonthRow[]>("list_months_for_year", {
          yearId: target.id,
        });
        setDuplicateYearMonths(sourceMonths);
        setDuplicateYearTarget(target);
      } catch (e) {
        setError(String(e));
      }
    },
    [],
  );

  // Year-end nudge: in November/December, if the next calendar year hasn't
  // been added to this workspace yet, surface a soft banner inviting the
  // user to roll the current year forward. We pick the best source year
  // (the existing row matching the current calendar year, falling back to
  // the most recent numeric year) so the duplicate-year modal opens with a
  // sensible default rather than asking the user to pick.
  const yearEndNudge = useMemo(() => {
    const now = new Date();
    const month = now.getMonth();
    if (month !== 10 && month !== 11) return null;
    const currentYearLabel = String(now.getFullYear());
    const nextYearLabel = String(now.getFullYear() + 1);
    if (years.some((y) => y.yearLabel === nextYearLabel)) return null;
    if (years.length === 0) return null;
    const exact = years.find((y) => y.yearLabel === currentYearLabel);
    let source = exact ?? null;
    if (!source) {
      const numeric = [...years]
        .map((y) => ({ y, n: Number(y.yearLabel) }))
        .filter((x) => Number.isFinite(x.n))
        .sort((a, b) => b.n - a.n)[0];
      source = numeric?.y ?? null;
    }
    if (!source) return null;
    return {
      sourceYearId: source.id,
      sourceLabel: source.yearLabel,
      nextLabel: nextYearLabel,
    };
  }, [years]);

  const onStartYearEndNudge = useCallback(() => {
    if (!yearEndNudge) return;
    void openDuplicateYearModal(yearEndNudge.sourceYearId);
  }, [yearEndNudge, openDuplicateYearModal]);

  const openRenameYearModal = useCallback((yearId?: number) => {
    const id = yearId ?? sidebarYearIdRef.current;
    if (id == null) return;
    const target = yearsRef.current.find((y) => y.id === id) ?? null;
    if (target) setRenameYearTarget(target);
  }, []);

  const openDeleteYearModal = useCallback((yearId?: number) => {
    const id = yearId ?? sidebarYearIdRef.current;
    if (id == null) return;
    const target = yearsRef.current.find((y) => y.id === id) ?? null;
    if (target) setDeleteYearTarget(target);
  }, []);

  const onDuplicateYearSubmit = useCallback(
    async (args: DuplicateYearArgs) => {
      const target = duplicateYearTarget;
      if (!target) return;
      setDuplicateYearBusy(true);
      try {
        const newId = await invoke<number>("duplicate_year", {
          sourceYearId: target.id,
          destYearLabel: args.destYearLabel,
          mode: args.mode,
          sourceMonthId: args.sourceMonthId ?? null,
        });
        setDuplicateYearTarget(null);
        await refreshYears();
        await enterYear(newId);
      } catch (e) {
        setError(String(e));
      } finally {
        setDuplicateYearBusy(false);
      }
    },
    [duplicateYearTarget, refreshYears, enterYear],
  );

  const onToggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      void invoke("set_sidebar_collapsed", { collapsed: next }).catch(() => {});
      return next;
    });
  }, []);

  const onRevealFolder = useCallback(async () => {
    try {
      await invoke<string>("reveal_default_folder");
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const onOpenRecent = useCallback(
    async (path: string) => {
      try {
        await openWorkspaceFromHome(path);
      } catch (e) {
        setError(String(e));
      }
    },
    [openWorkspaceFromHome],
  );

  // When a library tile is picked from inside an active budget the
  // user almost always wants the new file in a fresh window — the
  // open one usually has work in progress. But sometimes they want to
  // *replace* what they're looking at. Rather than guess, we ask. On
  // the launcher view itself (no budget behind us) there's nothing to
  // protect, so we skip the prompt and reuse silently.
  // Bring an external `.mimo` file into the user's library: copy it
  // into the default folder (with " (1)", " (2)", … name de-duping if
  // a file by that name is already there), then open the new copy in
  // the current window. The original file is left untouched, so the
  // source can stay in Google Drive / Downloads / wherever without
  // being double-managed by the app.
  const onImportToLibrary = useCallback(async () => {
    try {
      const picked = await openDialog({
        multiple: false,
        directory: false,
        filters: [{ name: "mimo file", extensions: ["mimo"] }],
      });
      const sourcePath = typeof picked === "string" ? picked : null;
      if (!sourcePath) return;
      const importedPath = await invoke<string>("import_workspace", {
        sourcePath,
      });
      await rescanLibrary();
      await openWorkspaceFromHome(importedPath);
    } catch (e) {
      setError(String(e));
    }
  }, [openWorkspaceFromHome, rescanLibrary]);

  const onLibraryOpen = useCallback(
    async (path: string) => {
      try {
        if (shouldReuseCurrentWindow()) {
          await openWorkspaceFromHome(path);
        } else {
          setLibraryOpenChoice({ path });
        }
      } catch (e) {
        setError(String(e));
      }
    },
    [openWorkspaceFromHome, shouldReuseCurrentWindow],
  );

  const onLibraryOpenChoiceConfirm = useCallback(
    async (mode: "current" | "new") => {
      const target = libraryOpenChoice;
      if (!target) return;
      setLibraryOpenChoice(null);
      try {
        await openWorkspaceFromHome(target.path, {
          forceNewWindow: mode === "new",
        });
      } catch (e) {
        setError(String(e));
      }
    },
    [libraryOpenChoice, openWorkspaceFromHome],
  );

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    const win = getCurrentWindow();
    win
      .onCloseRequested((event) => {
        // We must call preventDefault SYNCHRONOUSLY — once the handler yields
        // to an `await`, Tauri may have already resolved the close. We block
        // the default close every time, then either destroy the window
        // ourselves (clean state) or surface the unsaved-changes prompt.
        event.preventDefault();
        void (async () => {
          try {
            const hasBudget = await invoke<boolean>("has_open_budget");
            const dirty = await invoke<boolean>("is_dirty");
            if (!hasBudget || !dirty) {
              await win.destroy();
              return;
            }
            setUnsavedPromptOpen(true);
          } catch (err) {
            setError(String(err));
            // Don't trap the user inside a window we can't reason about.
            try {
              await win.destroy();
            } catch {
              /* swallow — window may already be gone */
            }
          }
        })();
      })
      .then((u) => {
        unlisten = u;
      });
    return () => {
      unlisten?.();
    };
  }, []);

  const closeAfterPrompt = useCallback(async () => {
    setUnsavedPromptOpen(false);
    try {
      await getCurrentWindow().destroy();
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const onUnsavedSave = useCallback(async () => {
    setUnsavedBusy(true);
    try {
      const wrote = await onSaveAs();
      if (wrote) {
        await closeAfterPrompt();
      }
    } finally {
      setUnsavedBusy(false);
    }
  }, [onSaveAs, closeAfterPrompt]);

  const onUnsavedDiscard = useCallback(async () => {
    await closeAfterPrompt();
  }, [closeAfterPrompt]);

  const onUnsavedCancel = useCallback(() => {
    setUnsavedPromptOpen(false);
  }, []);

  const onToggleAutoSave = useCallback(async () => {
    try {
      const next = !autoSaveOn;
      await invoke("set_auto_save", { enabled: next });
      setAutoSaveOn(next);
      if (next) {
        await invoke("save_snapshot");
      }
    } catch (e) {
      setError(String(e));
    }
  }, [autoSaveOn]);

  const openReorderModal = useCallback(() => {
    setReorderModalOpen(true);
  }, []);

  // Menu listeners need to bind exactly once for the lifetime of the
  // window — Tauri rebinds aren't free, and the previous deps array
  // didn't list every handler the bodies actually called (which is what
  // the old eslint-disable was hiding). Route everything through a ref
  // that's refreshed on every render so the listeners always reach the
  // freshest closure without re-subscribing.
  //
  // The ref is initialized lazily because some of the callbacks it
  // closes over are declared further down in this component body —
  // populating it here would hit the temporal-dead-zone. We assign
  // `.current` in a single statement after every callback is defined
  // (search for `menuHandlersRef.current = {...}` below).
  type MenuHandlers = {
    cycleMonth: typeof cycleMonth;
    onOpenFile: typeof onOpenFile;
    onCreateBudget: typeof onCreateBudget;
    onSaveAs: typeof onSaveAs;
    onToggleAutoSave: typeof onToggleAutoSave;
    openReorderModal: typeof openReorderModal;
    onRevealFolder: typeof onRevealFolder;
    onExportCsv: () => Promise<void>;
    onExportJson: () => Promise<void>;
    onExportCsvRedacted: () => Promise<void>;
    onExportJsonRedacted: () => Promise<void>;
    onToggleSidebar: typeof onToggleSidebar;
    showOverview: typeof showOverview;
    showReports: typeof showReports;
    showLibrary: typeof showLibrary;
    openDuplicateYearModal: typeof openDuplicateYearModal;
    openRenameYearModal: typeof openRenameYearModal;
    openDeleteYearModal: typeof openDeleteYearModal;
    showSaveToast: typeof showSaveToast;
  };
  const menuHandlersRef = useRef<MenuHandlers | null>(null);

  useEffect(() => {
    const unlisteners: UnlistenFn[] = [];
    const listenSafe = (name: string, fn: () => void) =>
      listen(name, fn).then((u) => unlisteners.push(u));
    const h = () => menuHandlersRef.current!;
    void listenSafe("menu:next-month", () => h().cycleMonth(1));
    void listenSafe("menu:prev-month", () => h().cycleMonth(-1));
    void listenSafe("menu:open-file", () => void h().onOpenFile());
    void listenSafe("menu:new-year", () => h().onCreateBudget());
    void listenSafe("menu:save-as", () => void h().onSaveAs());
    void listenSafe("menu:toggle-autosave", () => void h().onToggleAutoSave());
    void listenSafe("menu:reorganize", () => h().openReorderModal());
    void listenSafe("menu:show-default-folder", () => void h().onRevealFolder());
    void listenSafe("menu:export-csv", () => void h().onExportCsv());
    void listenSafe("menu:export-json", () => void h().onExportJson());
    void listenSafe("menu:export-csv-redacted", () => void h().onExportCsvRedacted());
    void listenSafe("menu:export-json-redacted", () => void h().onExportJsonRedacted());
    void listenSafe("menu:toggle-sidebar", () => h().onToggleSidebar());
    void listenSafe("menu:show-overview", () => void h().showOverview());
    void listenSafe("menu:show-reports", () => void h().showReports());
    void listenSafe("menu:show-library", () => void h().showLibrary());
    void listenSafe("menu:duplicate-year", () => void h().openDuplicateYearModal());
    void listenSafe("menu:rename-year", () => h().openRenameYearModal());
    void listenSafe("menu:delete-year", () => h().openDeleteYearModal());
    void listenSafe("menu:open-preferences", () => setPrefsOpen(true));
    void listenSafe("menu:set-password", () => {
      if (!encryptionAvailableRef.current) {
        setError(
          "This build of mimo doesn't include encryption support. Rebuild with --features encryption.",
        );
        return;
      }
      if (workspaceEncryptedRef.current) {
        setError(
          "This budget is already encrypted. Use Change Password to update it.",
        );
        return;
      }
      setPasswordError(null);
      setPasswordModal("set");
    });
    void listenSafe("menu:change-password", () => {
      if (!encryptionAvailableRef.current) {
        setError("This build of mimo doesn't include encryption support.");
        return;
      }
      if (!workspaceEncryptedRef.current) {
        setError(
          "This budget isn't encrypted yet. Use Set Password to add a password.",
        );
        return;
      }
      setPasswordError(null);
      setPasswordModal("change");
    });
    void listenSafe("menu:remove-password", () => {
      if (!encryptionAvailableRef.current || !workspaceEncryptedRef.current) {
        setError(
          encryptionAvailableRef.current
            ? "This budget isn't encrypted."
            : "This build of mimo doesn't include encryption support.",
        );
        return;
      }
      const ok = window.confirm(
        "Remove encryption from this budget? The file will be readable without a password after this.",
      );
      if (!ok) return;
      void (async () => {
        try {
          await invoke("decrypt_workspace");
          setWorkspaceEncrypted(false);
          h().showSaveToast("Encryption removed");
        } catch (e) {
          setError(String(e));
        }
      })();
    });
    return () => {
      unlisteners.forEach((u) => u());
    };
  }, []);

  // Window-level Cmd+S handler (the menu Save item was removed in favor of a status pill).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      if (e.key.toLowerCase() === "s" && !e.shiftKey) {
        e.preventDefault();
        void onCmdS();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCmdS]);

  useEffect(() => {
    // Autosave snapshots only make sense for a real `.mimo` file.
    // Skip entirely when the user is on home/library or has no
    // budget open — otherwise we'd snapshot nothing into the
    // backups folder every five minutes.
    if (!autoSaveOn || isDefaultWorkspace) return;
    const intervalMs = 5 * 60 * 1000;
    const id = window.setInterval(() => {
      setSnapshotState((s) => ({ ...s, busy: true }));
      void invoke("save_snapshot")
        .then(() => {
          setSnapshotState({ busy: false, lastAt: Date.now() });
        })
        .catch(() => {
          setSnapshotState((s) => ({ ...s, busy: false }));
        });
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [autoSaveOn, isDefaultWorkspace]);

  // Lightweight dirty poller for the status pill. Only runs when a
  // real budget is open AND the active view actually shows the pill —
  // launcher views suppress it, so polling twice a second there is
  // wasted IPC + wasted main-thread time.
  useEffect(() => {
    if (isDefaultWorkspace || isLauncherView) {
      setDirty(false);
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const d = await invoke<boolean>("is_dirty");
        if (!cancelled) setDirty(d);
      } catch {
        // ignore — pill just shows last known state
      }
    };
    void tick();
    const id = window.setInterval(() => {
      void tick();
    }, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [dbPath, isDefaultWorkspace, isLauncherView]);

  const activeMonthId = useCallback((): number | null => {
    const v = viewRef.current;
    return v.kind === "month" ? v.monthId : null;
  }, []);

  const reorderBuckets = useCallback(
    async (orderedIds: number[]) => {
      const mv = monthViewRef.current;
      const monthId = activeMonthId();
      if (!mv || monthId == null) return;
      const orderedBuckets = orderedIds
        .map((id) => mv.expenseBuckets.find((b) => b.id === id))
        .filter((b): b is ExpenseBucketDto => Boolean(b));
      flushSync(() => {
        setMonthView({ ...mv, expenseBuckets: orderedBuckets });
      });
      try {
        await invoke("reorder_buckets", { monthId, orderedIds });
      } catch (e) {
        setError(String(e));
        await refreshMonthView(monthId);
      }
    },
    [refreshMonthView, activeMonthId],
  );

  const onAddRow = useCallback(
    (bucketId: number) => {
      const mv = monthViewRef.current;
      const bucket = mv?.expenseBuckets.find((b) => b.id === bucketId);
      setLineEditConfig({
        mode: "add",
        bucketId,
        bucketName: bucket?.name ?? "this bucket",
      });
    },
    [],
  );

  const onEditRow = useCallback(
    (lineId: number) => {
      const mv = monthViewRef.current;
      if (!mv) return;
      let foundLine: ExpenseLineDto | undefined;
      let foundBucket: string | undefined;
      for (const b of mv.expenseBuckets) {
        const l = b.lines.find((x) => x.id === lineId);
        if (l) {
          foundLine = l;
          foundBucket = b.name;
          break;
        }
      }
      if (!foundLine) return;
      setLineEditConfig({
        mode: "edit",
        lineId,
        bucketName: foundBucket,
        initialName: foundLine.name,
        initialNeutral: foundLine.isNeutralTransfer,
        initialSinking: foundLine.isSinkingFund,
      });
    },
    [],
  );

  const onDeleteRow = useCallback((lineId: number, currentName: string) => {
    setPendingDelete({ lineId, name: currentName });
  }, []);

  const submitLineEdit = useCallback(
    async (payload: {
      name: string;
      isNeutralTransfer: boolean;
      isSinkingFund: boolean;
    }) => {
      const cfg = lineEditConfig;
      if (!cfg) return;
      const monthId = activeMonthId();
      if (monthId == null) return;
      try {
        if (cfg.mode === "add") {
          await invoke("add_expense_line", {
            bucketId: cfg.bucketId,
            name: payload.name,
            isNeutralTransfer: payload.isNeutralTransfer,
            isSinkingFund: payload.isSinkingFund,
          });
        } else {
          if (payload.name !== cfg.initialName) {
            await invoke("rename_expense_line", {
              id: cfg.lineId,
              name: payload.name,
            });
          }
          if (
            payload.isNeutralTransfer !== cfg.initialNeutral ||
            payload.isSinkingFund !== cfg.initialSinking
          ) {
            await invoke("update_expense_line_flags", {
              lineId: cfg.lineId,
              isNeutralTransfer: payload.isNeutralTransfer,
              isSinkingFund: payload.isSinkingFund,
            });
          }
        }
        setLineEditConfig(null);
        await refreshMonthView(monthId);
      } catch (e) {
        setError(String(e));
      }
    },
    [lineEditConfig, refreshMonthView, activeMonthId],
  );

  const confirmDelete = useCallback(async () => {
    const target = pendingDelete;
    if (!target) return;
    const monthId = activeMonthId();
    if (monthId == null) return;
    setDeleteBusy(true);
    try {
      await invoke("delete_expense_line", { id: target.lineId });
      setPendingDelete(null);
      await refreshMonthView(monthId);
    } catch (e) {
      setError(String(e));
    } finally {
      setDeleteBusy(false);
    }
  }, [pendingDelete, refreshMonthView, activeMonthId]);

  // Common downloader used by every export flow. Centralising the Blob/URL
  // dance avoids subtle leaks (forgetting revokeObjectURL) and makes the
  // call sites read like declarative recipes — name in, file out.
  const downloadFile = useCallback(
    (content: string, filename: string, mime: string) => {
      const blob = new Blob([content], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    },
    [],
  );

  const workspaceFilenameStem = useCallback(
    () => (basenameNoExt(dbPath) || "mimo").replace(/\s+/g, "_"),
    [dbPath],
  );

  const monthFilenameStem = useCallback(
    (monthId: number): string => {
      const wsLabel = workspaceFilenameStem();
      const m = months.find((row) => row.id === monthId);
      const monthSlug =
        (m?.yearMonth || m?.tabLabel || `month-${monthId}`).replace(/\s+/g, "_");
      return `${wsLabel}-${monthSlug}`;
    },
    [workspaceFilenameStem, months],
  );

  const runExport = useCallback(
    async (
      command: string,
      args: Record<string, unknown> | undefined,
      filename: string,
      mime: string,
    ) => {
      try {
        const out = await invoke<string>(command, args);
        downloadFile(out, filename, mime);
      } catch (e) {
        setError(String(e));
      }
    },
    [downloadFile],
  );

  const onExportCsv = useCallback(
    () =>
      runExport(
        "export_csv_data",
        undefined,
        `${workspaceFilenameStem()}.csv`,
        "text/csv;charset=utf-8",
      ),
    [runExport, workspaceFilenameStem],
  );

  const onExportJson = useCallback(
    () =>
      runExport(
        "export_workspace_json",
        undefined,
        `${workspaceFilenameStem()}.json`,
        "application/json;charset=utf-8",
      ),
    [runExport, workspaceFilenameStem],
  );

  // Redacted variants share the file naming scheme but get a `-redacted`
  // suffix so a sender can tell at a glance which version they attached.
  const onExportCsvRedacted = useCallback(
    () =>
      runExport(
        "export_workspace_csv_redacted",
        undefined,
        `${workspaceFilenameStem()}-redacted.csv`,
        "text/csv;charset=utf-8",
      ),
    [runExport, workspaceFilenameStem],
  );

  const onExportJsonRedacted = useCallback(
    () =>
      runExport(
        "export_workspace_json_redacted",
        undefined,
        `${workspaceFilenameStem()}-redacted.json`,
        "application/json;charset=utf-8",
      ),
    [runExport, workspaceFilenameStem],
  );

  const onExportYearCsvRedacted = useCallback(
    (yearId: number, yearLabel: string) =>
      runExport(
        "export_year_csv_redacted",
        { yearId },
        `${workspaceFilenameStem()}-${yearLabel || "year"}-redacted.csv`,
        "text/csv;charset=utf-8",
      ),
    [runExport, workspaceFilenameStem],
  );

  const onExportYearJsonRedacted = useCallback(
    (yearId: number, yearLabel: string) =>
      runExport(
        "export_year_json_redacted",
        { yearId },
        `${workspaceFilenameStem()}-${yearLabel || "year"}-redacted.json`,
        "application/json;charset=utf-8",
      ),
    [runExport, workspaceFilenameStem],
  );

  const onExportYearCsv = useCallback(
    async (yearId: number, yearLabel: string) => {
      // No backend "year detailed" export today, so fall back to the
      // workspace-wide detailed CSV with a year-tagged filename. This keeps
      // the picker UX consistent without requiring a new backend command yet.
      try {
        const csv = await invoke<string>("export_csv_data");
        downloadFile(
          csv,
          `${workspaceFilenameStem()}-${yearLabel || "year"}.csv`,
          "text/csv;charset=utf-8",
        );
        void yearId;
      } catch (e) {
        setError(String(e));
      }
    },
    [downloadFile, workspaceFilenameStem],
  );

  const onExportYearJson = useCallback(
    async (yearId: number, yearLabel: string) => {
      try {
        const json = await invoke<string>("export_workspace_json");
        downloadFile(
          json,
          `${workspaceFilenameStem()}-${yearLabel || "year"}.json`,
          "application/json;charset=utf-8",
        );
        void yearId;
      } catch (e) {
        setError(String(e));
      }
    },
    [downloadFile, workspaceFilenameStem],
  );

  const onExportMonthCsv = useCallback(
    (monthId: number) =>
      runExport(
        "export_month_csv",
        { monthId },
        `${monthFilenameStem(monthId)}.csv`,
        "text/csv;charset=utf-8",
      ),
    [runExport, monthFilenameStem],
  );

  const onExportMonthJson = useCallback(
    (monthId: number) =>
      runExport(
        "export_month_json",
        { monthId },
        `${monthFilenameStem(monthId)}.json`,
        "application/json;charset=utf-8",
      ),
    [runExport, monthFilenameStem],
  );

  const onExportMonthCsvRedacted = useCallback(
    (monthId: number) =>
      runExport(
        "export_month_csv_redacted",
        { monthId },
        `${monthFilenameStem(monthId)}-redacted.csv`,
        "text/csv;charset=utf-8",
      ),
    [runExport, monthFilenameStem],
  );

  const onExportMonthJsonRedacted = useCallback(
    (monthId: number) =>
      runExport(
        "export_month_json_redacted",
        { monthId },
        `${monthFilenameStem(monthId)}-redacted.json`,
        "application/json;charset=utf-8",
      ),
    [runExport, monthFilenameStem],
  );

  // Refresh the menu-handler bag every render. Lazy assignment side-steps
  // the temporal-dead-zone for callbacks declared later in this body, and
  // the listener effect (mounted once) reads through this ref so the
  // freshest closures fire without re-subscribing on every render.
  menuHandlersRef.current = {
    cycleMonth,
    onOpenFile,
    onCreateBudget,
    onSaveAs,
    onToggleAutoSave,
    openReorderModal,
    onRevealFolder,
    onExportCsv,
    onExportJson,
    onExportCsvRedacted,
    onExportJsonRedacted,
    onToggleSidebar,
    showOverview,
    showReports,
    showLibrary,
    openDuplicateYearModal,
    openRenameYearModal,
    openDeleteYearModal,
    showSaveToast,
  };

  if (loading) {
    return (
      <div className="app-shell">
        <p className="muted">Loading…</p>
      </div>
    );
  }

  const fileBasename = basenameNoExt(dbPath) || "mimo";
  // Prefer the user-set display name from workspace_meta over the raw file
  // basename. This lets the user give a workspace a friendlier label (e.g.
  // "Family budget") without renaming the underlying file. If display_name is
  // unset OR we're on the default scratch workspace, fall back to the
  // basename so the UI stays accurate.
  const displayNameOverride =
    !isDefaultWorkspace && workspaceMeta?.displayName
      ? workspaceMeta.displayName
      : null;
  const workspaceBasename = displayNameOverride ?? fileBasename;
  const yearLabels = years.map((y) => y.yearLabel);

  // Hide the sidebar whenever the active view doesn't belong to a single
  // budget. Welcome and Library are launcher screens that live "outside"
  // any one budget, so sidebar navigation (year list, months, etc.) has
  // nothing meaningful to point at and only adds visual noise. Once the
  // user opens a budget — by picking a tile in Library, a recent file,
  // creating a new one, etc. — the view transitions to a per-budget
  // kind (years-landing / year-overview / month) and the sidebar
  // reappears with that budget's context.
  const sidebarHidden = isLauncherView;
  const layoutClassName = `app-layout${
    sidebarHidden ? " sidebar-hidden" : sidebarCollapsed ? " sidebar-collapsed" : ""
  }`;

  return (
    <div className={layoutClassName}>
      <BucketReorderModal
        open={reorderModalOpen}
        buckets={monthView?.expenseBuckets ?? []}
        onClose={() => setReorderModalOpen(false)}
        onCommit={(ids) => void reorderBuckets(ids)}
      />
      <PreferencesModal
        open={prefsOpen}
        settings={settings}
        workspaceMeta={workspaceMeta}
        workspaceFileBasename={fileBasename}
        isDefaultWorkspace={isDefaultWorkspace}
        onClose={() => setPrefsOpen(false)}
        onSaved={() => void refreshSettings()}
        onWorkspaceMetaSaved={() => void refreshWorkspaceMeta()}
        onError={(msg) => setError(msg)}
      />
      <PasswordModal
        kind={passwordModal ?? "unlock"}
        open={passwordModal !== null}
        busy={passwordBusy}
        error={passwordError}
        onCancel={() => {
          if (passwordBusy) return;
          setPasswordModal(null);
          setPasswordError(null);
        }}
        onSubmit={(pw) => void onPasswordSubmit(pw)}
      />
      <UnsavedChangesModal
        open={unsavedPromptOpen}
        busy={unsavedBusy}
        mode="close"
        onSave={() => void onUnsavedSave()}
        onDiscard={() => void onUnsavedDiscard()}
        onCancel={onUnsavedCancel}
      />
      <CreateYearModal
        open={createYearOpen}
        mode={createYearMode}
        busy={createYearBusy}
        existingLabels={yearLabels}
        onCancel={() => {
          if (!createYearBusy) setCreateYearOpen(false);
        }}
        onCreate={(label) => void onCreateYearSubmit(label)}
      />
      <RenameYearModal
        open={renameYearTarget !== null}
        initial={renameYearTarget?.yearLabel ?? ""}
        busy={renameYearBusy}
        existingLabels={yearLabels}
        onCancel={() => {
          if (!renameYearBusy) setRenameYearTarget(null);
        }}
        onSubmit={(label) => void onRenameYearSubmit(label)}
      />
      <DeleteYearConfirmModal
        open={deleteYearTarget !== null}
        yearLabel={deleteYearTarget?.yearLabel ?? ""}
        busy={deleteYearBusy}
        onCancel={() => {
          if (!deleteYearBusy) setDeleteYearTarget(null);
        }}
        onConfirm={() => void onDeleteYearConfirm()}
      />
      <DuplicateYearModal
        open={duplicateYearTarget !== null}
        sourceYear={duplicateYearTarget}
        sourceMonths={duplicateYearMonths}
        busy={duplicateYearBusy}
        existingLabels={yearLabels}
        onCancel={() => {
          if (!duplicateYearBusy) setDuplicateYearTarget(null);
        }}
        onSubmit={(args) => void onDuplicateYearSubmit(args)}
      />
      <RenameWorkspaceModal
        open={renameWorkspaceTarget !== null}
        initial={renameWorkspaceTarget ? basename(renameWorkspaceTarget.path) : ""}
        busy={renameWorkspaceBusy}
        onCancel={() => {
          if (!renameWorkspaceBusy) setRenameWorkspaceTarget(null);
        }}
        onSubmit={(name) => void onConfirmRenameWorkspace(name)}
      />
      <DeleteWorkspaceConfirmModal
        open={deleteWorkspaceTarget !== null}
        workspaceName={
          deleteWorkspaceTarget ? basename(deleteWorkspaceTarget.path) : ""
        }
        busy={deleteWorkspaceBusy}
        onCancel={() => {
          if (!deleteWorkspaceBusy) setDeleteWorkspaceTarget(null);
        }}
        onConfirm={() => void onConfirmDeleteWorkspace()}
      />
      <OpenInWindowModal
        open={libraryOpenChoice !== null}
        fileName={libraryOpenChoice ? basenameNoExt(libraryOpenChoice.path) : ""}
        onCancel={() => setLibraryOpenChoice(null)}
        onPick={(where) => void onLibraryOpenChoiceConfirm(where)}
      />
      <ExpenseLineEditModal
        config={lineEditConfig}
        onCancel={() => setLineEditConfig(null)}
        onSubmit={submitLineEdit}
      />
      <ConfirmDeleteRowModal
        open={pendingDelete !== null}
        rowName={pendingDelete?.name ?? ""}
        busy={deleteBusy}
        onCancel={() => {
          if (!deleteBusy) setPendingDelete(null);
        }}
        onConfirm={() => void confirmDelete()}
      />

      {!sidebarHidden && (
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggleCollapsed={onToggleSidebar}
          workspaceTitle={isDefaultWorkspace ? "Untitled budget" : workspaceBasename}
          workspaceTitleIsPlaceholder={isDefaultWorkspace}
          workspacePathTooltip={(() => {
            const parts: string[] = [];
            if (workspaceMeta?.updatedAt) {
              parts.push(`Last edited ${formatRelative(workspaceMeta.updatedAt)}`);
            }
            if (dbPath) parts.push(dbPath);
            const joined = parts.join("\n");
            return joined.length > 0 ? joined : undefined;
          })()}
          years={years}
          months={months}
          view={view}
          sidebarYearId={sidebarYearId}
          onSelectYear={(id) => void enterYear(id)}
          onBackToYears={exitYear}
          onShowYearOverview={(id) => {
            void enterYear(id);
          }}
          onActivateMonth={(id) => void activateMonth(id)}
        />
      )}

      <div className="app-main">
        <header className="top-bar">
          <button
            type="button"
            className="brand brand-button"
            onClick={showHome}
            title="Go to home"
            aria-label="mimo — go to home"
          >
            <span className="brand-mark" aria-hidden="true">◆</span>
            <span className="brand-name">mimo</span>
            <span className="brand-tagline">Money In, Money Out | Mind the Flow</span>
          </button>
          <div className="top-bar-spacer" />
          {/* Top-bar nav stays put across every view so users always
              have the same orientation. Dashboard + Reports require an
              open budget, so they're disabled (rather than hidden) on
              launcher views — the slot stays put and the affordance
              communicates "this exists, just not here yet". */}
          <button
            type="button"
            className="btn ghost"
            onClick={showHome}
            aria-pressed={view.kind === "welcome"}
          >
            Home
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={exitYear}
            title={
              isLauncherView
                ? "Open a budget to see its dashboard"
                : "Open this budget's dashboard"
            }
            aria-pressed={view.kind === "years-landing"}
            disabled={isLauncherView}
          >
            Dashboard
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={() => void showReports()}
            title={
              isLauncherView
                ? "Open a budget to see its reports"
                : "Calendar reports (⌘⇧R)"
            }
            aria-pressed={view.kind === "reports"}
            disabled={isLauncherView}
          >
            Reports
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={() => void showLibrary()}
            title="Browse all budgets"
            aria-pressed={view.kind === "library"}
          >
            Library
          </button>
          {/* Save / autosave status only makes sense inside an open
              budget. On launcher views there's nothing to save (the
              scratch backend isn't user-visible there), so we suppress
              the pill entirely instead of showing a confusing
              "Unsaved · Save As…" affordance. */}
          {!isLauncherView && (
            <SaveStatusPill
              isDefaultWorkspace={isDefaultWorkspace}
              dirty={dirty}
              autoSaveOn={autoSaveOn}
              snapshotBusy={snapshotState.busy}
              lastSnapshotAt={snapshotState.lastAt}
              onSaveAs={() => void onSaveAs()}
            />
          )}
          {saveToast && !isLauncherView && (
            <span className="saved-flash" role="status" aria-live="polite">
              {saveToast}
            </span>
          )}
        </header>

        {error && (
          <div className="banner error" role="alert">
            {error}
          </div>
        )}

        {busy && <div className="busy-strip muted">Working…</div>}

        <main className="app-content">
          {view.kind === "welcome" && (
            <WelcomeScreen
              recentFiles={recentFiles}
              busy={busy}
              onCreateYear={onCreateBudget}
              onOpenFile={() => void onOpenFile()}
              onOpenRecent={(p) => void onOpenRecent(p)}
              onShowLibrary={() => void showLibrary()}
              onRevealFolder={() => void onRevealFolder()}
            />
          )}

          {view.kind === "library" && (
            <LibraryView
              entries={libraryEntries}
              busy={busy}
              onOpen={(p) => void onLibraryOpen(p)}
              onOpenInNewWindow={(p) =>
                void openWorkspaceFromHome(p, { forceNewWindow: true })
              }
              onImport={() => void onImportToLibrary()}
              onRescan={() => void rescanLibrary()}
              onRevealFolder={() => void onRevealFolder()}
              onCreateYear={onCreateBudget}
              defaultFolder={settings?.defaultFolder ?? null}
              onRenameWorkspace={onRequestRenameWorkspace}
              onDeleteWorkspace={onRequestDeleteWorkspace}
            />
          )}

          {view.kind === "years-landing" && (
            <BudgetDashboard
              workspaceTitle={
                isDefaultWorkspace ? "Untitled budget" : workspaceBasename
              }
              years={years}
              crossYear={crossYear}
              crossYearLoading={crossYearLoading}
              snapshot={yearOverview}
              snapshotLoading={dashboardSnapshotLoading}
              selectedYearId={effectiveDashboardYearId}
              onPickYear={setDashboardSelectedYearId}
              onOpenYearOverview={(id) => void enterYear(id)}
              onOpenMonth={(id) => void openMonthFromDashboard(id)}
              onCreateYear={onCreateYear}
              onShowCrossYear={() => void showCrossYear()}
              yearEndNudge={
                yearEndNudge
                  ? {
                      sourceLabel: yearEndNudge.sourceLabel,
                      nextLabel: yearEndNudge.nextLabel,
                    }
                  : null
              }
              onStartYearEndNudge={onStartYearEndNudge}
            />
          )}

          {view.kind === "year-overview" && yearOverview && sidebarYearId != null && (
            <>
              <div className="overview-toolbar">
                <ExportPickerButton
                  label="Export CSV"
                  formatLabel="CSV"
                  onDetailed={() =>
                    void onExportYearCsv(sidebarYearId, yearOverview.yearLabel)
                  }
                  onRedacted={() =>
                    void onExportYearCsvRedacted(
                      sidebarYearId,
                      yearOverview.yearLabel,
                    )
                  }
                />
                <ExportPickerButton
                  label="Export JSON"
                  formatLabel="JSON"
                  onDetailed={() =>
                    void onExportYearJson(sidebarYearId, yearOverview.yearLabel)
                  }
                  onRedacted={() =>
                    void onExportYearJsonRedacted(
                      sidebarYearId,
                      yearOverview.yearLabel,
                    )
                  }
                />
                {sidebarYearId != null && (
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={() => void openDuplicateYearModal()}
                    title="Duplicate this year (custom destination)"
                  >
                    Duplicate year…
                  </button>
                )}
              </div>
              <YearOverviewView
                overview={yearOverview}
                onActivateMonth={(id) => void activateMonth(id)}
                yearEndNudge={
                  yearEndNudge
                    ? {
                        sourceLabel: yearEndNudge.sourceLabel,
                        nextLabel: yearEndNudge.nextLabel,
                      }
                    : null
                }
                onStartYearEndNudge={onStartYearEndNudge}
              />
            </>
          )}

          {/* The pre-split `overview` kind also had a third branch that
              rendered <WelcomeScreen /> on an empty workspace. With the
              scratch DB gone, bootstrap routes empties to `welcome`
              directly, so that fallback is unreachable and was removed. */}

          {view.kind === "year-overview" && !yearOverview && (
            <p className="muted month-loading-banner">Loading overview…</p>
          )}

          {view.kind === "reports" && (
            <ReportsView
              initial={reportsInitial}
              onInitialApplied={onReportsInitialApplied}
              monthRows={months}
            />
          )}

          {view.kind === "cross-year" && (
            <CrossYearView
              data={crossYear}
              loading={crossYearLoading}
              onJumpToYear={(id) => void enterYear(id)}
              onBackToDashboard={exitYear}
            />
          )}

          {view.kind === "month" && monthView && monthView.monthId === view.monthId && (
            <MonthBudgetView
              view={monthView}
              expandedIncome={expandedIncome}
              expandedExpense={expandedExpense}
              onToggleIncome={toggleIncome}
              onToggleExpense={toggleExpense}
              onRefresh={() => {
                if (view.kind === "month") void refreshMonthView(view.monthId);
              }}
              onAddRow={onAddRow}
              onEditRow={onEditRow}
              onDeleteRow={onDeleteRow}
              onOpenReorder={openReorderModal}
              onOpenLineYtd={(args) => {
                setYtdDrawer(args);
              }}
              onExportCsv={() => void onExportMonthCsv(monthView.monthId)}
              onExportJson={() => void onExportMonthJson(monthView.monthId)}
              onExportCsvRedacted={() =>
                void onExportMonthCsvRedacted(monthView.monthId)
              }
              onExportJsonRedacted={() =>
                void onExportMonthJsonRedacted(monthView.monthId)
              }
            />
          )}

          {view.kind === "month" && (!monthView || monthView.monthId !== view.monthId) && (
            <p className="muted month-loading-banner">Loading month…</p>
          )}
    </main>
      </div>

      <YtdSlideOver
        open={ytdDrawer !== null}
        lineKind={ytdDrawer?.lineKind ?? "expense"}
        year={ytdDrawer?.year ?? new Date().getFullYear()}
        report={ytdReport}
        loading={ytdLoading}
        onClose={() => setYtdDrawer(null)}
        onYearChange={(y) =>
          setYtdDrawer((d) => (d ? { ...d, year: y } : null))
        }
        onOpenFullReports={() => {
          if (!ytdDrawer) return;
          setReportsInitial({
            year: ytdDrawer.year,
            asOf: ytdDrawer.asOf,
            selected: [
              { lineKind: ytdDrawer.lineKind, lineIdentity: ytdDrawer.lineIdentity },
            ],
          });
          setYtdDrawer(null);
          setView({ kind: "reports" });
        }}
      />
    </div>
  );
}

function SummaryRow({
  label,
  planned,
  actual,
  diff,
  diffClass,
  note,
}: {
  label: string;
  planned: number;
  actual: number;
  diff: number;
  diffClass: string;
  note?: string;
}) {
  return (
    <div className="summary-row">
      <div>
        <div className="summary-label">{label}</div>
        {note && <div className="summary-note">{note}</div>}
      </div>
      <div className="summary-cols">
        <div>
          <div className="mini-label">Projected</div>
          <div className="num">{formatUsd(planned, "rounded")}</div>
        </div>
        <div>
          <div className="mini-label">Actual</div>
          <div className="num">{formatUsd(actual, "rounded")}</div>
        </div>
        <div>
          <div className="mini-label">Difference</div>
          <div className={`num ${diffClass}`}>{formatUsd(diff, "rounded")}</div>
        </div>
      </div>
    </div>
  );
}

function IncomeLineBlock({
  line,
  budgetYearMonth,
  expanded,
  onToggle,
  onRefresh,
  onOpenYtd,
}: {
  line: IncomeLineDto;
  budgetYearMonth: string;
  expanded: boolean;
  onToggle: () => void;
  onRefresh: () => void;
  onOpenYtd: () => void;
}) {
  const [planned, setPlanned] = useState(centsToInputString(line.plannedCents));
  const [parseError, setParseError] = useState(false);
  useEffect(() => {
    setPlanned(centsToInputString(line.plannedCents));
    setParseError(false);
  }, [line.plannedCents]);

  const savePlanned = async () => {
    const c = parseMoneyToCents(planned);
    if (c === null) {
      setParseError(true);
      return;
    }
    setParseError(false);
    await invoke("set_income_line_planned", { id: line.id, plannedCents: c });
    await onRefresh();
  };

  return (
    <>
      <tr className={line.entries.length ? "has-detail" : ""}>
        <td>{line.name}</td>
        <td className="num">
          <PlannedAmountInput
            value={planned}
            onChange={(v) => {
              setPlanned(v);
              if (parseError) setParseError(false);
            }}
            onBlur={() => void savePlanned()}
            invalid={parseError}
          />
        </td>
        <td className="num clickable-cell" onClick={onToggle} title="Show entries">
          {formatUsd(line.actualCents, "rounded")}
        </td>
        <td className={`num ${varianceClassIncome(line.varianceCents)}`}>
          {formatUsd(line.varianceCents, "rounded")}
        </td>
        <td className="actions">
          <div className="row-icon-actions">
            <IconButton
              label="Calendar year totals (this line)"
              onClick={onOpenYtd}
            >
              <CalendarIcon />
            </IconButton>
            <IconButton
              label={expanded ? "Hide entries" : "Show entries"}
              onClick={onToggle}
              active={expanded}
            >
              <ListIcon />
            </IconButton>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="detail-row">
          <td colSpan={5}>
            <IncomeEntriesPanel lineId={line.id} entries={line.entries} budgetYearMonth={budgetYearMonth} onDone={onRefresh} />
          </td>
        </tr>
      )}
    </>
  );
}

function IncomeEntriesPanel({
  lineId,
  entries,
  budgetYearMonth,
  onDone,
}: {
  lineId: number;
  entries: IncomeLineDto["entries"];
  budgetYearMonth: string;
  onDone: () => void;
}) {
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [justAdded, setJustAdded] = useState(false);

  const add = async () => {
    const c = parseMoneyToCents(amount);
    if (c === null || c === 0) return;
    await invoke("add_income_entry", {
      incomeLineId: lineId,
      label: label || "Income",
      amountCents: c,
      receivedOn: date || null,
    });
    setLabel("");
    setAmount("");
    setDate("");
    setJustAdded(true);
    setTimeout(() => setJustAdded(false), 700);
    await onDone();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void add();
    }
  };

  return (
    <div className="detail-panel">
      <div className={`detail-toolbar${justAdded ? " just-added" : ""}`} onKeyDown={onKeyDown}>
        <input
          className="input"
          placeholder="Label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onFocus={selectAllOnFocus}
        />
        <input
          className="input"
          placeholder="Amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onFocus={selectAllOnFocus}
        />
        <DateField value={date} onChange={setDate} ariaLabel="Received on" fixedMonthYear={{ mm: budgetYearMonth.slice(5, 7), yyyy: budgetYearMonth.slice(0, 4) }} />
        <button type="button" className={`btn ${justAdded ? "primary" : "secondary"}`} onClick={() => void add()}>
          {justAdded ? "Added ✓" : "Add entry"}
        </button>
      </div>
      <ul className="entry-list">
        {entries.map((e) => (
          <li key={e.id} className="entry-row">
            <span>{e.label}</span>
            <span className="muted mono">{e.receivedOn ?? ""}</span>
            <span className="num">{formatUsd(e.amountCents, "exact")}</span>
            <button
              type="button"
              className="btn-link danger"
              onClick={() => void invoke("delete_income_entry", { id: e.id }).then(onDone)}
            >
              Remove
            </button>
          </li>
        ))}
        {entries.length === 0 && <li className="muted">No entries yet.</li>}
      </ul>
    </div>
  );
}

function ExpenseLineBlock({
  line,
  budgetYearMonth,
  expanded,
  onToggle,
  onRefresh,
  onEdit,
  onDelete,
  onOpenYtd,
}: {
  line: ExpenseLineDto;
  budgetYearMonth: string;
  expanded: boolean;
  onToggle: () => void;
  onRefresh: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onOpenYtd: () => void;
}) {
  const [planned, setPlanned] = useState(centsToInputString(line.plannedCents));
  const [parseError, setParseError] = useState(false);
  useEffect(() => {
    setPlanned(centsToInputString(line.plannedCents));
    setParseError(false);
  }, [line.plannedCents]);

  const savePlanned = async () => {
    const c = parseMoneyToCents(planned);
    if (c === null) {
      setParseError(true);
      return;
    }
    setParseError(false);
    await invoke("set_expense_line_planned", { id: line.id, plannedCents: c });
    await onRefresh();
  };

  const rowClass = [
    line.isNeutralTransfer ? "neutral-line" : "",
    line.transactions.length ? "has-detail" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <tr className={rowClass}>
        <td>
          {line.name}
          {line.isNeutralTransfer && (
            <span className="pill" title="Excluded from net spend">
              tracking
            </span>
          )}
          {line.isSinkingFund && (
            <span
              className="pill soft"
              title="Sinking fund — recurring savings toward a planned future expense"
            >
              sinking
            </span>
          )}
        </td>
        <td className="num">
          <PlannedAmountInput
            value={planned}
            onChange={(v) => {
              setPlanned(v);
              if (parseError) setParseError(false);
            }}
            onBlur={() => void savePlanned()}
            invalid={parseError}
          />
        </td>
        <td className="num clickable-cell" onClick={onToggle} title="Show transactions">
          {formatUsd(line.actualCents, "rounded")}
        </td>
        <td className={`num ${varianceClassExpense(line.varianceCents)}`}>
          {formatUsd(line.varianceCents, "rounded")}
        </td>
        <td className="actions">
          <div className="row-icon-actions">
            <IconButton
              label="Calendar year totals (this line)"
              onClick={onOpenYtd}
            >
              <CalendarIcon />
            </IconButton>
            <IconButton
              label={expanded ? "Hide transactions" : "Show transactions"}
              onClick={onToggle}
              active={expanded}
            >
              <ListIcon />
            </IconButton>
            {onEdit && (
              <IconButton
                label="Edit row (name, neutral, sinking)"
                onClick={onEdit}
              >
                <PencilIcon />
              </IconButton>
            )}
            {onDelete && (
              <IconButton label="Delete row" onClick={onDelete} variant="danger">
                <TrashIcon />
              </IconButton>
            )}
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="detail-row">
          <td colSpan={5}>
            <TransactionsPanel lineId={line.id} txs={line.transactions} budgetYearMonth={budgetYearMonth} onDone={onRefresh} />
          </td>
        </tr>
      )}
    </>
  );
}

function TransactionsPanel({
  lineId,
  txs,
  budgetYearMonth,
  onDone,
}: {
  lineId: number;
  txs: ExpenseLineDto["transactions"];
  budgetYearMonth: string;
  onDone: () => void;
}) {
  const [payee, setPayee] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [justAdded, setJustAdded] = useState(false);

  const add = async () => {
    const c = parseMoneyToCents(amount);
    if (c === null || c === 0) return;
    await invoke("add_transaction", {
      expenseLineId: lineId,
      payee: payee || "Purchase",
      amountCents: c,
      occurredOn: date || null,
    });
    setPayee("");
    setAmount("");
    setDate("");
    setJustAdded(true);
    setTimeout(() => setJustAdded(false), 700);
    await onDone();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void add();
    }
  };

  return (
    <div className="detail-panel">
      <div className={`detail-toolbar${justAdded ? " just-added" : ""}`} onKeyDown={onKeyDown}>
        <input
          className="input"
          placeholder="Payee"
          value={payee}
          onChange={(e) => setPayee(e.target.value)}
          onFocus={selectAllOnFocus}
        />
        <input
          className="input"
          placeholder="Amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onFocus={selectAllOnFocus}
        />
        <DateField value={date} onChange={setDate} ariaLabel="Occurred on" fixedMonthYear={{ mm: budgetYearMonth.slice(5, 7), yyyy: budgetYearMonth.slice(0, 4) }} />
        <button type="button" className={`btn ${justAdded ? "primary" : "secondary"}`} onClick={() => void add()}>
          {justAdded ? "Added ✓" : "Add transaction"}
        </button>
      </div>
      <ul className="entry-list">
        {txs.map((t) => (
          <li key={t.id} className="entry-row">
            <span>{t.payee}</span>
            <span className="muted mono">{t.occurredOn ?? ""}</span>
            <span className="num">{formatUsd(t.amountCents, "exact")}</span>
            <button
              type="button"
              className="btn-link danger"
              onClick={() => void invoke("delete_transaction", { id: t.id }).then(onDone)}
            >
              Remove
            </button>
          </li>
        ))}
        {txs.length === 0 && <li className="muted">No transactions yet.</li>}
      </ul>
    </div>
  );
}
