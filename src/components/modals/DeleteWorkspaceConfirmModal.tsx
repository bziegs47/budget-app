import { type MouseEvent as ReactMouseEvent } from "react";
import { useModalFocusTrap, preventFocusSteal } from "./useModalFocusTrap";

export function DeleteWorkspaceConfirmModal({
  open,
  workspaceName,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  workspaceName: string;
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
        aria-labelledby="del-workspace-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="del-workspace-title" className="modal-title">
          Delete {workspaceName}?
        </h2>
        <p className="modal-hint">
          The file is removed from disk along with every year, month, and
          transaction it contains. This can't be undone here, but a recent
          autosave or cloud history may still hold a copy.
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
            {busy ? "Deleting…" : "Delete budget"}
          </button>
        </div>
      </div>
    </div>
  );
}
