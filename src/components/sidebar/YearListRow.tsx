import type { YearRow } from "../../types";

export function YearListRow({
  year,
  active,
  onSelect,
}: {
  year: YearRow;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <li className={`sidebar-year-row ${active ? "active" : ""}`}>
      <button type="button" className="sidebar-year-main" onClick={onSelect}>
        <span className="sidebar-year-label-big">{year.yearLabel}</span>
        <span className="sidebar-year-meta muted">
          {year.trackedMonthCount === 0
            ? "No months tracked"
            : `${year.trackedMonthCount} ${
                year.trackedMonthCount === 1 ? "month" : "months"
              } tracked`}
        </span>
      </button>
    </li>
  );
}
