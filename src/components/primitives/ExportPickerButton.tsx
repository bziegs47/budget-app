import { useEffect, useRef, useState } from "react";
import "./ExportPickerButton.css";

export function ExportPickerButton({
  label,
  onDetailed,
  onRedacted,
  formatLabel,
}: {
  label: string;
  onDetailed: () => void;
  onRedacted: () => void;
  formatLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const choose = (kind: "detailed" | "redacted") => {
    setOpen(false);
    if (kind === "detailed") onDetailed();
    else onRedacted();
  };

  return (
    <div className="export-split" ref={wrapRef}>
      <button
        type="button"
        className="btn ghost export-split-main"
        onClick={onDetailed}
        title={`${label} (detailed)`}
      >
        {label}
      </button>
      <button
        type="button"
        className="btn ghost export-split-caret"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`${formatLabel} export options`}
      >
        ▾
      </button>
      {open && (
        <div className="export-split-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            className="export-split-item"
            onClick={() => choose("detailed")}
          >
            <span className="export-split-item-title">Detailed</span>
            <span className="export-split-item-help">
              Includes payees, transactions, and entry labels.
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="export-split-item"
            onClick={() => choose("redacted")}
          >
            <span className="export-split-item-title">Redacted</span>
            <span className="export-split-item-help">
              Buckets, lines, and totals only. Safe to share.
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
