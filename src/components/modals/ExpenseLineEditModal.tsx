import { useEffect, useState } from "react";
import { useModalFocusTrap } from "./useModalFocusTrap";
import "./ExpenseLineEditModal.css";

export type ExpenseLineEditConfig =
  | {
      mode: "add";
      bucketId: number;
      bucketName: string;
    }
  | {
      mode: "edit";
      lineId: number;
      bucketName?: string;
      initialName: string;
      initialNeutral: boolean;
      initialSinking: boolean;
    };

export function ExpenseLineEditModal({
  config,
  onCancel,
  onSubmit,
}: {
  config: ExpenseLineEditConfig | null;
  onCancel: () => void;
  onSubmit: (payload: {
    name: string;
    isNeutralTransfer: boolean;
    isSinkingFund: boolean;
  }) => Promise<void> | void;
}) {
  const [name, setName] = useState("");
  const [neutral, setNeutral] = useState(false);
  const [sinking, setSinking] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!config) return;
    if (config.mode === "add") {
      setName("");
      setNeutral(false);
      setSinking(false);
    } else {
      setName(config.initialName);
      setNeutral(config.initialNeutral);
      setSinking(config.initialSinking);
    }
    setBusy(false);
  }, [config]);

  const trapRef = useModalFocusTrap<HTMLDivElement>(
    config != null && !busy,
    onCancel,
  );

  if (!config) return null;

  const isAdd = config.mode === "add";
  const heading = isAdd ? "Add budget row" : "Edit budget row";
  const subheading = isAdd
    ? `New row in ${config.bucketName}`
    : config.bucketName
      ? `Editing row in ${config.bucketName}`
      : "Edit row";
  const confirmLabel = isAdd ? "Create row" : "Save changes";

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      await onSubmit({
        name: trimmed,
        isNeutralTransfer: neutral,
        isSinkingFund: sinking,
      });
    } finally {
      setBusy(false);
    }
  };

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
        className="modal-card line-edit-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="line-edit-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="line-edit-title" className="modal-title">
          {heading}
        </h2>
        <p className="modal-hint">{subheading}</p>
        <div className="modal-fields">
          <label className="field-stack">
            <span className="label">Row name</span>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              placeholder="e.g. Streaming, Dining out, Tuition"
            />
          </label>

          <label className="line-edit-toggle">
            <input
              type="checkbox"
              checked={neutral}
              onChange={(e) => setNeutral(e.target.checked)}
            />
            <span>
              <span className="line-edit-toggle-label">Neutral transfer (tracking only)</span>
              <span className="line-edit-toggle-hint">
                Excludes this line from net spend totals. Use for credit-card payments,
                savings transfers, and other intra-account moves.
              </span>
            </span>
          </label>

          <label className="line-edit-toggle">
            <input
              type="checkbox"
              checked={sinking}
              onChange={(e) => setSinking(e.target.checked)}
            />
            <span>
              <span className="line-edit-toggle-label">Sinking fund</span>
              <span className="line-edit-toggle-hint">
                Marks this line as money you set aside each month for an irregular or
                annual expense (gifts, travel, renewals).
              </span>
            </span>
          </label>
      </div>
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
            type="button"
            className="btn primary"
            onClick={() => void handleSubmit()}
            disabled={busy || !name.trim()}
          >
            {busy ? "Saving…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
