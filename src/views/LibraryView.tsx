import { useMemo } from "react";
import type { LibraryEntry } from "../types";
import {
  LockIcon,
  NewWindowIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
} from "../components/icons";
import { basename, formatRelative } from "./helpers";

export function LibraryView({
  entries,
  defaultFolder,
  busy,
  onRescan,
  onOpen,
  onOpenInNewWindow,
  onImport,
  onCreateYear,
  onRevealFolder,
  onRenameWorkspace,
  onDeleteWorkspace,
}: {
  entries: LibraryEntry[];
  defaultFolder: string | null;
  busy: boolean;
  onRescan: () => void;
  onOpen: (path: string) => void;
  onOpenInNewWindow: (path: string) => void;
  onImport: () => void;
  onCreateYear: () => void;
  onRevealFolder: () => void;
  onRenameWorkspace: (entry: LibraryEntry) => void;
  onDeleteWorkspace: (entry: LibraryEntry) => void;
}) {
  // Tiles read top-down alphabetically so users can scan a long library
  // by name. We use locale-aware comparison so accented or non-ASCII
  // workspace names land where users expect them. The backend returns
  // entries sorted by mtime, which is useful for the sidebar but not
  // for a grid that's about identification.
  const sortedEntries = useMemo(
    () =>
      [...entries].sort((a, b) =>
        basename(a.path).localeCompare(basename(b.path), undefined, {
          sensitivity: "base",
          numeric: true,
        }),
      ),
    [entries],
  );
  return (
    <div className="library-view">
      <header className="library-header">
        <div>
          <h1>Budget library</h1>
          {/* Source-folder line doubles as a quiet rescan affordance.
              The library auto-rescans on entry, so the button is only
              needed when the user adds a file via Finder while staying
              on this page — keeping it inline keeps it discoverable
              without competing with the primary actions on the right. */}
          <p className="muted library-source">
            From <code>{defaultFolder ?? "~/Documents/Budget"}</code>
            <button
              type="button"
              className="btn-link library-rescan"
              onClick={onRescan}
              disabled={busy}
              title="Re-read the default folder for changes"
            >
              {busy ? "Scanning…" : "Rescan"}
            </button>
          </p>
        </div>
        <div className="library-actions">
          <button type="button" className="btn secondary" onClick={onRevealFolder}>
            Show in Finder
          </button>
          <button type="button" className="btn secondary" onClick={onImport}>
            Import…
          </button>
          <button type="button" className="btn primary" onClick={onCreateYear}>
            <PlusIcon /> New budget
          </button>
        </div>
      </header>
      {sortedEntries.length === 0 ? (
        <div className="library-empty">
          <p>No budget files found in your default folder yet.</p>
          <p className="muted">Create one above, or open an existing file from elsewhere.</p>
        </div>
      ) : (
        <ul className="library-list">
          {sortedEntries.map((e) => {
            const lastEdited = e.lastEditedAt ?? e.lastModified;
            const name = basename(e.path);
            // Build the meta string once so the JSX reads cleanly.
            const labels = e.yearLabels ?? [];
            let yearText: string;
            if (labels.length === 0) {
              yearText = e.encrypted ? "Locked" : "No years";
            } else if (labels.length === 1) {
              yearText = labels[0];
            } else {
              const sorted = [...labels].sort();
              yearText = `${labels.length} years (${sorted[0]}–${sorted[sorted.length - 1]})`;
            }
            const tracked = e.trackedMonthCount ?? e.monthCount;
            const monthText = `${tracked} ${tracked === 1 ? "month" : "months"} tracked`;
            const rowClass = [
              "library-row",
              e.isConflictCopy ? "is-conflict" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <li key={e.path} className="library-list-item">
                <div
                  role="button"
                  tabIndex={0}
                  className={rowClass}
                  onClick={() => onOpen(e.path)}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter" || ev.key === " ") {
                      ev.preventDefault();
                      onOpen(e.path);
                    }
                  }}
                >
                  <div className="library-row-info">
                    <div className="library-row-title">
                      <span className="library-row-name">{name}</span>
                      {e.provider && (
                        <span
                          className="library-card-badge provider"
                          title={`Stored in ${e.provider}`}
                        >
                          {e.provider}
                        </span>
                      )}
                      {e.isConflictCopy && (
                        <span
                          className="library-card-badge conflict"
                          title="Cloud sync conflict copy. Compare with the canonical file before merging."
                        >
                          Conflict copy
                        </span>
                      )}
                      {e.encrypted && (
                        <span
                          className="library-card-lock"
                          title="Encrypted"
                        >
                          <LockIcon />
                        </span>
                      )}
                      <span
                        className="library-row-actions"
                        onClick={(ev) => ev.stopPropagation()}
                      >
                        <button
                          type="button"
                          className="library-card-action"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            ev.currentTarget.blur();
                            onOpenInNewWindow(e.path);
                          }}
                          title={`Open ${name} in a new window`}
                          aria-label={`Open ${name} in a new window`}
                        >
                          <NewWindowIcon size={14} />
                        </button>
                        <button
                          type="button"
                          className="library-card-action"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            ev.currentTarget.blur();
                            onRenameWorkspace(e);
                          }}
                          title={`Rename ${name}`}
                          aria-label={`Rename ${name}`}
                        >
                          <PencilIcon size={14} />
                        </button>
                        <button
                          type="button"
                          className="library-card-action danger"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            ev.currentTarget.blur();
                            onDeleteWorkspace(e);
                          }}
                          title={`Delete ${name}`}
                          aria-label={`Delete ${name}`}
                        >
                          <TrashIcon size={14} />
                        </button>
                      </span>
                    </div>
                    <div className="library-row-meta muted">
                      Edited {formatRelative(lastEdited)} · {yearText} · {monthText}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
