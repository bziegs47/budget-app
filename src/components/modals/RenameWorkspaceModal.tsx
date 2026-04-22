import { useEffect, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useModalFocusTrap, preventFocusSteal } from "./useModalFocusTrap";

export function RenameWorkspaceModal({
  open,
  initial,
  busy,
  onCancel,
  onSubmit,
}: {
  open: boolean;
  initial: string;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (name: string) => void;
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
  const error = !trimmed
    ? "Enter a budget name."
    : trimmed.length > 120
    ? "Name is too long (max 120 characters)."
    : /[\\/]/.test(trimmed)
    ? "Name cannot contain slashes."
    : trimmed.startsWith(".")
    ? "Name cannot start with a dot."
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
        aria-labelledby="rename-workspace-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        noValidate
      >
        <h2 id="rename-workspace-title" className="modal-title">
          Rename budget
        </h2>
        <p className="modal-hint">
          Renames the file on disk. The <code>.mimo</code> extension is
          kept automatically.
        </p>
        <div className="modal-fields">
          <label className="modal-field">
            <span className="label">Budget name</span>
            <input
              className="input"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onBlur={() => setTouched(true)}
              autoFocus
              maxLength={120}
              spellCheck={false}
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
            {busy ? "Saving…" : "Rename"}
          </button>
        </div>
      </form>
    </div>
  );
}
