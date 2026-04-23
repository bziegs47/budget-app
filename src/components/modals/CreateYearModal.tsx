import { useEffect, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useModalFocusTrap, preventFocusSteal } from "./useModalFocusTrap";

export function CreateYearModal({
  open,
  mode,
  busy,
  existingLabels,
  onCancel,
  onCreate,
}: {
  open: boolean;
  mode: "budget" | "year";
  busy: boolean;
  existingLabels: string[];
  onCancel: () => void;
  onCreate: (label: string) => void;
}) {
  const isBudgetMode = mode === "budget";
  const [label, setLabel] = useState("");
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (open) {
      setLabel("");
      setTouched(false);
    }
  }, [open, mode, isBudgetMode]);
  const trapRef = useModalFocusTrap<HTMLFormElement>(open && !busy, onCancel);
  if (!open) return null;
  const trimmed = label.trim();
  let error: string | null = null;
  if (isBudgetMode) {
    const HOSTILE = /[\/\\:*?"<>|\x00]/;
    if (!trimmed) {
      error = "Enter a budget name.";
    } else if (HOSTILE.test(trimmed)) {
      error = "Avoid / \\ : * ? \" < > | in the name.";
    } else if (trimmed.length > 64) {
      error = "Name is too long (max 64 characters).";
    }
  } else {
    const validShape = /^\d{4}$/.test(trimmed);
    const dup = existingLabels.includes(trimmed);
    if (!trimmed) {
      error = "Enter a 4-digit year.";
    } else if (!validShape) {
      error = "Use a 4-digit year (e.g. 2026).";
    } else if (dup) {
      error = "That year already exists in this budget.";
    }
  }
  const submit = () => {
    if (error) {
      setTouched(true);
      return;
    }
    onCreate(trimmed);
  };
  const handleCancel = (e: ReactMouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!busy) onCancel();
  };
  const title = isBudgetMode ? "New budget" : "New year";
  const hint = isBudgetMode
    ? "A new file in your default folder, scaffolded with January through December."
    : "January through December are added automatically.";
  const fieldLabel = isBudgetMode ? "Budget name" : "Year";
  const placeholder = isBudgetMode ? "e.g. Household budget" : "e.g. 2026";
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
        aria-labelledby="new-year-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        noValidate
      >
        <h2 id="new-year-title" className="modal-title">
          {title}
        </h2>
        <p className="modal-hint">{hint}</p>
        <div className="modal-fields">
          <label className="modal-field">
            <span className="label">{fieldLabel}</span>
            <input
              className="input"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onBlur={() => setTouched(true)}
              autoFocus
              placeholder={placeholder}
              maxLength={isBudgetMode ? 64 : 4}
              inputMode={isBudgetMode ? "text" : "numeric"}
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
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}
