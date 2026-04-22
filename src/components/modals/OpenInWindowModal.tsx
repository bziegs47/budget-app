import { useModalFocusTrap, preventFocusSteal } from "./useModalFocusTrap";

export function OpenInWindowModal({
  open,
  fileName,
  onCancel,
  onPick,
}: {
  open: boolean;
  fileName: string;
  onCancel: () => void;
  onPick: (where: "current" | "new") => void;
}) {
  const trapRef = useModalFocusTrap<HTMLDivElement>(open, onCancel);
  if (!open) return null;
  return (
    <div className="modal-backdrop" role="presentation" onClick={onCancel}>
      <div
        ref={trapRef}
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="open-where-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="open-where-title" className="modal-title">
          Open {fileName}
        </h2>
        <p className="modal-hint">
          You already have a budget open. Pick where this one should
          land — opening here will close the current budget (with an
          unsaved-changes prompt if needed).
        </p>
        <div className="modal-actions">
          <button
            type="button"
            className="btn secondary"
            onMouseDown={preventFocusSteal}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={() => onPick("current")}
          >
            This window
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => onPick("new")}
          >
            New window
          </button>
        </div>
      </div>
    </div>
  );
}
