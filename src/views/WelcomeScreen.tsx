import type { RecentFile } from "../types";
import { basename } from "./helpers";

export function WelcomeScreen({
  recentFiles,
  busy,
  onCreateYear,
  onOpenFile,
  onShowLibrary,
  onOpenRecent,
  onRevealFolder,
}: {
  recentFiles: RecentFile[];
  busy: boolean;
  onCreateYear: () => void;
  onOpenFile: () => void;
  onShowLibrary: () => void;
  onOpenRecent: (path: string) => void;
  onRevealFolder: () => void;
}) {
  return (
    <div className="welcome-screen">
      <div className="welcome-hero">
        <h1>Welcome to mimo</h1>
      </div>

      <div className="welcome-cards">
        <button
          type="button"
          className="welcome-card primary"
          onClick={onCreateYear}
          disabled={busy}
        >
          <span className="welcome-card-eyebrow">Create</span>
          <span className="welcome-card-title">Create a budget</span>
          <span className="welcome-card-sub">
            Names a new <code>.mimo</code> file in your default folder and
            scaffolds the current year's months for you.
          </span>
        </button>
        <button
          type="button"
          className="welcome-card"
          onClick={onShowLibrary}
          disabled={busy}
        >
          <span className="welcome-card-eyebrow">Browse</span>
          <span className="welcome-card-title">Browse the library</span>
          <span className="welcome-card-sub">
            See every budget in your default folder, with summaries.
          </span>
        </button>
        <button
          type="button"
          className="welcome-card"
          onClick={onOpenFile}
          disabled={busy}
        >
          <span className="welcome-card-eyebrow">Open</span>
          <span className="welcome-card-title">Open an existing budget…</span>
          <span className="welcome-card-sub">
            Opens any <code>.mimo</code> file from anywhere on disk.
          </span>
        </button>
      </div>

      <section className="welcome-recent">
        <header>
          <h2>Recent</h2>
          <button type="button" className="btn-link" onClick={onRevealFolder}>
            Show default folder in Finder
          </button>
        </header>
        {recentFiles.length === 0 ? (
          <p className="muted">No recent files yet.</p>
        ) : (
          <ul className="recent-list">
            {recentFiles.slice(0, 8).map((r) => (
              <li key={r.path}>
                <button
                  type="button"
                  className="recent-item"
                  onClick={() => onOpenRecent(r.path)}
                >
                  <span className="recent-name">{basename(r.path) || r.yearLabel}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
