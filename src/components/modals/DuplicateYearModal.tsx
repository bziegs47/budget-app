import { useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";
import type { DuplicateYearArgs, MonthRow, YearRow } from "../../types";
import { useModalFocusTrap, preventFocusSteal } from "./useModalFocusTrap";

const MONTH_NAMES_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

export function DuplicateYearModal({
  open,
  sourceYear,
  sourceMonths,
  busy,
  existingLabels,
  onCancel,
  onSubmit,
}: {
  open: boolean;
  sourceYear: YearRow | null;
  sourceMonths: MonthRow[];
  busy: boolean;
  existingLabels: string[];
  onCancel: () => void;
  onSubmit: (args: DuplicateYearArgs) => void;
}) {
  const initialDest = useMemo(() => {
    if (!sourceYear) return "";
    const n = Number(sourceYear.yearLabel);
    return Number.isFinite(n) ? String(n + 1) : "";
  }, [sourceYear]);
  const [destLabel, setDestLabel] = useState(initialDest);
  const [mode, setMode] = useState<"perMonth" | "singleSource">("perMonth");
  const calendarMonths = useMemo(
    () =>
      [...sourceMonths]
        .filter((m) => m.calendarMonth != null)
        .sort((a, b) => (a.calendarMonth ?? 99) - (b.calendarMonth ?? 99)),
    [sourceMonths],
  );
  const [sourceMonthId, setSourceMonthId] = useState<number | null>(
    calendarMonths[0]?.id ?? null,
  );
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (open) {
      setDestLabel(initialDest);
      setMode("perMonth");
      setSourceMonthId(calendarMonths[0]?.id ?? null);
      setTouched(false);
    }
  }, [open, initialDest, calendarMonths]);
  const trapRef = useModalFocusTrap<HTMLFormElement>(open && !busy, onCancel);
  if (!open || !sourceYear) return null;
  const trimmed = destLabel.trim();
  const validShape = /^\d{4}$/.test(trimmed);
  const dup = existingLabels.includes(trimmed);
  const sameAsSource = trimmed === sourceYear.yearLabel;
  const needsMonth = mode === "singleSource" && sourceMonthId == null;
  const error = !trimmed
    ? "Enter a destination year"
    : !validShape
    ? "Use a 4-digit year (e.g. 2027)"
    : dup
    ? "That year already exists in this file"
    : sameAsSource
    ? "Pick a different year than the source"
    : needsMonth
    ? "Choose a source month"
    : null;
  const submit = () => {
    if (error) {
      setTouched(true);
      return;
    }
    onSubmit({
      destYearLabel: trimmed,
      mode,
      sourceMonthId: mode === "singleSource" ? sourceMonthId ?? undefined : undefined,
    });
  };
  const handleCancel = (e: ReactMouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!busy) onCancel();
  };
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={busy ? undefined : onCancel}
    >
      <form
        ref={trapRef}
        className="modal-card line-edit-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dup-year-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        noValidate
      >
        <h2 id="dup-year-title" className="modal-title">
          Duplicate year {sourceYear.yearLabel}
        </h2>
        <p className="modal-hint">
          Copies the bucket structure and projected amounts into a brand-new year.
          Actuals (transactions and income entries) are not copied.
        </p>
        <div className="modal-fields">
          <label className="modal-field">
            <span className="label">Destination year</span>
            <input
              className="input"
              value={destLabel}
              onChange={(e) => setDestLabel(e.target.value)}
              onBlur={() => setTouched(true)}
              maxLength={4}
              inputMode="numeric"
              autoFocus
            />
          </label>

          <label className="line-edit-toggle">
            <input
              type="radio"
              name="dup-year-mode"
              checked={mode === "perMonth"}
              onChange={() => setMode("perMonth")}
            />
            <span>
              <span className="line-edit-toggle-label">Copy each month one-to-one</span>
              <span className="line-edit-toggle-hint">
                January's projections fill the new January, February → February, and so on.
              </span>
            </span>
          </label>
          <label className="line-edit-toggle">
            <input
              type="radio"
              name="dup-year-mode"
              checked={mode === "singleSource"}
              onChange={() => setMode("singleSource")}
            />
            <span>
              <span className="line-edit-toggle-label">
                Use a single source month for all 12 months
              </span>
              <span className="line-edit-toggle-hint">
                Pick one month below; its projections are copied into every month of the new year.
              </span>
            </span>
          </label>

          {mode === "singleSource" && (
            <label className="modal-field">
              <span className="label">Source month</span>
              <select
                className="input"
                value={sourceMonthId ?? ""}
                onChange={(e) => setSourceMonthId(Number(e.target.value) || null)}
              >
                {calendarMonths.length === 0 && (
                  <option value="">(no calendar months in source year)</option>
                )}
                {calendarMonths.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.calendarMonth != null ? MONTH_NAMES_FULL[m.calendarMonth - 1] : m.tabLabel}
                  </option>
                ))}
              </select>
            </label>
          )}

          {touched && error && <p className="modal-error">{error}</p>}
        </div>
        <div className="modal-actions">
          <button
            type="button"
            className="btn secondary"
            onMouseDown={preventFocusSteal}
            onClick={handleCancel}
            disabled={busy}
          >
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy || !!error}>
            {busy ? "Duplicating…" : "Duplicate"}
          </button>
        </div>
      </form>
    </div>
  );
}
