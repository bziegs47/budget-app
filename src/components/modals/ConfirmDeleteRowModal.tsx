import { useModalFocusTrap } from "./useModalFocusTrap";

export function ConfirmDeleteRowModal({
  open,
  rowName,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  rowName: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const trapRef = useModalFocusTrap<HTMLDivElement>(open && !busy, onCancel);
  if (!open) return null;
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={() => {
        if (!busy) onCancel();
      }}
    >
      <div
        ref={trapRef}
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-delete-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-delete-title" className="modal-title">
          Delete row?
        </h2>
        <p className="modal-hint">
          This will delete <strong>{rowName}</strong> and every transaction recorded against
          it in this month. This cannot be undone.
        </p>
        <div className="modal-actions">
          <button
            type="button"
            className="btn ghost"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn primary danger"
            onClick={onConfirm}
            disabled={busy}
            autoFocus
          >
            {busy ? "Deleting…" : "Delete row"}
          </button>
        </div>
      </div>
    </div>
  );
}
