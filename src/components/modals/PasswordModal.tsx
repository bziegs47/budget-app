import { useEffect, useState } from "react";
import { useModalFocusTrap } from "./useModalFocusTrap";

export type PasswordModalKind = "set" | "unlock" | "change";

export function PasswordModal({
  kind,
  open,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  kind: PasswordModalKind;
  open: boolean;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (password: string) => void;
}) {
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  useEffect(() => {
    if (open) {
      setPw("");
      setConfirm("");
    }
  }, [open, kind]);
  const trapRef = useModalFocusTrap<HTMLFormElement>(open && !busy, onCancel);
  if (!open) return null;
  const needsConfirm = kind !== "unlock";
  const trimmed = pw;
  const localError = !trimmed
    ? "Enter a password"
    : needsConfirm && trimmed !== confirm
      ? "Passwords don't match"
      : null;
  const submit = () => {
    if (localError) return;
    onSubmit(trimmed);
  };
  const title =
    kind === "set"
      ? "Protect this budget"
      : kind === "change"
        ? "Change password"
        : "Unlock budget";
  const help =
    kind === "set"
      ? "Choose a password to encrypt this file with SQLCipher. There is no recovery — losing the password means losing the data."
      : kind === "change"
        ? "Pick a new password. Old backups still need the old password."
        : "Enter the password for this budget.";
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
        aria-labelledby="password-modal-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        noValidate
      >
        <h2 id="password-modal-title" className="modal-title">
          {title}
        </h2>
        <p className="modal-hint">{help}</p>
        <div className="modal-fields">
          <label className="modal-field">
            <span className="label">
              {kind === "change" ? "New password" : "Password"}
            </span>
        <input
              type="password"
              className="input"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              autoFocus
              autoComplete="new-password"
              disabled={busy}
            />
          </label>
          {needsConfirm && (
            <label className="modal-field">
              <span className="label">Confirm</span>
              <input
                type="password"
                className="input"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                disabled={busy}
              />
            </label>
          )}
        </div>
        {(error || (localError && pw)) && (
          <p className="modal-error" role="alert">
            {error ?? localError}
          </p>
        )}
        <div className="modal-actions">
          <button
            type="button"
            className="btn secondary"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn primary"
            disabled={busy || !!localError}
          >
            {busy
              ? "Working…"
              : kind === "unlock"
                ? "Unlock"
                : kind === "change"
                  ? "Change"
                  : "Encrypt"}
          </button>
        </div>
      </form>
    </div>
  );
}
