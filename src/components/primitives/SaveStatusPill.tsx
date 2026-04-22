import { useEffect, useState } from "react";
import "./SaveStatusPill.css";

function relativeTimeShort(ms: number): string {
  const sec = Math.max(0, Math.round(ms / 1000));
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}

export function SaveStatusPill({
  isDefaultWorkspace,
  dirty,
  autoSaveOn,
  snapshotBusy,
  lastSnapshotAt,
  onSaveAs,
}: {
  isDefaultWorkspace: boolean;
  dirty: boolean;
  autoSaveOn: boolean;
  snapshotBusy: boolean;
  lastSnapshotAt: number | null;
  onSaveAs: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  if (isDefaultWorkspace) {
    if (dirty) {
      return (
        <button
          type="button"
          className="status-pill warn clickable"
          onClick={onSaveAs}
          title="Default budget — Save As to keep these changes in your own .mimo file"
        >
          <span className="status-dot" /> Unsaved · Save As…
        </button>
      );
    }
    return (
      <span className="status-pill muted-pill">
        <span className="status-dot" /> Scratch budget
      </span>
    );
  }
  if (snapshotBusy) {
    return (
      <span className="status-pill" title="Writing snapshot…">
        <span className="status-dot busy" /> Auto-saving…
      </span>
    );
  }
  if (autoSaveOn && lastSnapshotAt) {
    return (
      <span
        className="status-pill ok"
        title={`Last snapshot ${new Date(lastSnapshotAt).toLocaleString()}`}
      >
        <span className="status-dot ok" /> Auto-saved {relativeTimeShort(now - lastSnapshotAt)}
      </span>
    );
  }
  return (
    <span className="status-pill ok" title="Every change is written to the .mimo file immediately">
      <span className="status-dot ok" /> Saved
    </span>
  );
}
