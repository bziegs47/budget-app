import type { AppView, MonthRow, YearRow } from "../../types";
import { YearListRow } from "./YearListRow";
import { MonthRowItem } from "./MonthRowItem";
import "./Sidebar.css";

export type SidebarSection = { id: string; label: string };

export function Sidebar({
  collapsed,
  onToggleCollapsed,
  workspaceTitle,
  workspaceTitleIsPlaceholder,
  workspacePathTooltip,
  years,
  months,
  view,
  sidebarYearId,
  monthSections,
  onSelectYear,
  onBackToYears,
  onShowYearOverview,
  onActivateMonth,
  onScrollToSection,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  workspaceTitle: string;
  workspaceTitleIsPlaceholder: boolean;
  workspacePathTooltip?: string;
  years: YearRow[];
  months: MonthRow[];
  view: AppView;
  sidebarYearId: number | null;
  monthSections?: SidebarSection[];
  onSelectYear: (id: number) => void;
  onBackToYears: () => void;
  onShowYearOverview: (id: number) => void;
  onActivateMonth: (id: number) => void;
  onScrollToSection?: (elementId: string) => void;
}) {
  if (collapsed) {
    return (
      <aside className="sidebar collapsed" aria-label="Budget sidebar">
        <button
          type="button"
          className="sidebar-collapse-tab"
          onClick={onToggleCollapsed}
          title="Expand sidebar (⌘\\)"
          aria-label="Expand sidebar"
        >
          ›
        </button>
      </aside>
    );
  }

  const activeYear = years.find((y) => y.id === sidebarYearId) ?? null;
  const overviewActive =
    view.kind === "year-overview" && activeYear != null && view.yearId === activeYear.id;
  const crossYearActive = view.kind === "cross-year";

  return (
    <aside className="sidebar" aria-label="Budget sidebar">
      <div className="sidebar-header">
        <div
          className={`sidebar-workspace${
            workspaceTitleIsPlaceholder ? " is-placeholder" : ""
          }`}
          title={workspacePathTooltip}
        >
          <span className="sidebar-workspace-eyebrow">Budget</span>
          <span className="sidebar-workspace-title">{workspaceTitle}</span>
        </div>
        {activeYear || crossYearActive ? (
          <button
            type="button"
            className="sidebar-back"
            onClick={onBackToYears}
            title="Back to dashboard"
            aria-label="Back to dashboard"
          >
            ‹ Dashboard
          </button>
        ) : (
          <h3 className="sidebar-section-title sidebar-eyebrow-title">Go to year</h3>
        )}
      </div>

      <div className="sidebar-scroll">
      {!activeYear && !crossYearActive && (
        <div className="sidebar-section">
          <ul className="sidebar-year-list">
            {years.length === 0 && (
              <li className="sidebar-empty muted">
                No years yet — add one from the dashboard.
              </li>
            )}
            {years.map((y) => (
              <YearListRow
                key={y.id}
                year={y}
                active={false}
                onSelect={() => onSelectYear(y.id)}
              />
            ))}
          </ul>
        </div>
      )}

      {crossYearActive && !activeYear && (
        <div className="sidebar-section">
          <h3 className="sidebar-section-title">All years</h3>
          <p className="sidebar-empty muted">
            Comparing all years in this budget.
          </p>
        </div>
      )}

      {activeYear && (
        <>
          <div className={`sidebar-year-header ${overviewActive ? "active" : ""}`}>
            <button
              type="button"
              className="sidebar-year-main"
              onClick={() => onShowYearOverview(activeYear.id)}
              title="Show year overview"
            >
              <span className="sidebar-year-eyebrow">Year</span>
              <span className="sidebar-year-label">{activeYear.yearLabel}</span>
            </button>
          </div>

          <hr className="sidebar-divider" aria-hidden="true" />

          <div className="sidebar-section">
            <ul className="sidebar-month-list">
              <li className={`sidebar-month-row ${overviewActive ? "active" : ""}`}>
                <button
                  type="button"
                  className="sidebar-month-main"
                  onClick={() => onShowYearOverview(activeYear.id)}
                >
                  <span className="sidebar-month-label">Year overview</span>
                </button>
              </li>
            </ul>
            <h3 className="sidebar-section-title">Months</h3>
            <ul className="sidebar-month-list nested">
              {[...months]
                .sort(
                  (a, b) => (a.calendarMonth ?? 99) - (b.calendarMonth ?? 99),
                )
                .map((m) => {
                  const isActive = view.kind === "month" && view.monthId === m.id;
                  return (
                    <li key={m.id}>
                      <MonthRowItem
                        row={m}
                        active={isActive}
                        onActivate={() => onActivateMonth(m.id)}
                      />
                      {isActive && monthSections && monthSections.length > 0 && (
                        <ul className="sidebar-section-list">
                          {monthSections.map((s) => (
                            <li key={s.id} className="sidebar-section-row">
                              <button
                                type="button"
                                className="sidebar-section-btn"
                                onClick={() => onScrollToSection?.(s.id)}
                              >
                                {s.label}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
            </ul>
          </div>
        </>
      )}
      </div>

      <button
        type="button"
        className="sidebar-collapse-tab"
        onClick={onToggleCollapsed}
        title="Collapse sidebar (⌘\\)"
        aria-label="Collapse sidebar"
      >
        ‹
      </button>
    </aside>
  );
}
