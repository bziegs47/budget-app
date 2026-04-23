import { type MouseEvent as ReactMouseEvent } from "react";
import { useModalFocusTrap, preventFocusSteal } from "./useModalFocusTrap";

export function DeleteYearConfirmModal({
  open,
  yearLabel,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  yearLabel: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const trapRef = useModalFocusTrap<HTMLDivElement>(open && !busy, onCancel);
  if (!open) return null;
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
      <div
        ref={trapRef}
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="del-year-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="del-year-title" className="modal-title">
          Delete year {yearLabel}?
        </h2>
        <p className="modal-hint">
          All 12 months, transactions, and entries for {yearLabel} will be removed from this
          file. This can't be undone, but you can still recover from a recent autosave or
          backup.
        </p>
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
          <button
            type="button"
            className="btn danger"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Deleting…" : "Delete year"}
          </button>
        </div>
      </div>
    </div>
  );
}
