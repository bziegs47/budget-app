import { useEffect, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useModalFocusTrap, preventFocusSteal } from "./useModalFocusTrap";

export function RenameYearModal({
  open,
  initial,
  busy,
  existingLabels,
  onCancel,
  onSubmit,
}: {
  open: boolean;
  initial: string;
  busy: boolean;
  existingLabels: string[];
  onCancel: () => void;
  onSubmit: (label: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (open) {
      setValue(initial);
      setTouched(false);
    }
  }, [open, initial]);
  const trapRef = useModalFocusTrap<HTMLFormElement>(open && !busy, onCancel);
  if (!open) return null;
  const trimmed = value.trim();
  const validShape = /^\d{4}$/.test(trimmed);
  const dup = trimmed !== initial && existingLabels.includes(trimmed);
  const error = !trimmed
    ? "Enter a 4-digit year"
    : !validShape
    ? "Use a 4-digit year (e.g. 2026)"
    : dup
    ? "That year already exists in this file"
    : null;
  const submit = () => {
    if (error) {
      setTouched(true);
      return;
    }
    if (trimmed === initial) {
      onCancel();
      return;
    }
    onSubmit(trimmed);
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
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rename-year-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        noValidate
      >
        <h2 id="rename-year-title" className="modal-title">
          Rename year
        </h2>
        <p className="modal-hint">
          Months keep their data; only the year label and slug change.
        </p>
        <div className="modal-fields">
          <label className="modal-field">
            <span className="label">Year</span>
            <input
              className="input"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onBlur={() => setTouched(true)}
              autoFocus
              maxLength={4}
              inputMode="numeric"
            />
          </label>
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
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
