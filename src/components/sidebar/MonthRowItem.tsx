import type { MonthRow } from "../../types";

const MONTH_NAMES_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

export function MonthRowItem({
  row,
  active,
  onActivate,
}: {
  row: MonthRow;
  active: boolean;
  onActivate: () => void;
}) {
  const monthLabel =
    row.calendarMonth != null
      ? MONTH_NAMES_FULL[row.calendarMonth - 1]
      : row.tabLabel;
  return (
    <div className={`sidebar-month-row ${active ? "active" : ""}`}>
      <button type="button" className="sidebar-month-main" onClick={onActivate}>
        <span className="sidebar-month-label">{monthLabel}</span>
      </button>
    </div>
  );
}
