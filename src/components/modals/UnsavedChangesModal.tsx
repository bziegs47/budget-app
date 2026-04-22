import { useModalFocusTrap } from "./useModalFocusTrap";
import "./UnsavedChangesModal.css";

export type UnsavedChangesMode = "close" | "quit";

export function UnsavedChangesModal({
  open,
  busy,
  mode,
  onSave,
  onDiscard,
  onCancel,
}: {
  open: boolean;
  busy: boolean;
  mode: UnsavedChangesMode;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}) {
  const trapRef = useModalFocusTrap<HTMLDivElement>(open && !busy, onCancel);
  if (!open) return null;
  const isQuit = mode === "quit";
  const title = isQuit
    ? "Save changes before quitting?"
    : "Save changes before closing?";
  const discardLabel = isQuit ? "Quit without saving" : "Close without saving";
  const saveIdle = isQuit ? "Save & quit" : "Save & close";
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
        className="modal-card unsaved-changes-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="unsaved-changes-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="unsaved-changes-title" className="modal-title">
          {title}
        </h2>
        <p className="modal-hint">
          This budget has not been saved to a <code>.mimo</code> file. Save it now or your
          changes will only remain in this app's default budget.
        </p>
        <div className="modal-actions unsaved-changes-actions">
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
            className="btn secondary"
            onClick={onDiscard}
            disabled={busy}
          >
            {discardLabel}
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={onSave}
            disabled={busy}
            autoFocus
          >
            {busy ? "Saving…" : saveIdle}
          </button>
        </div>
      </div>
    </div>
  );
}
