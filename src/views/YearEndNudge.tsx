export function YearEndNudge({
  sourceLabel,
  nextLabel,
  onStart,
}: {
  sourceLabel: string;
  nextLabel: string;
  onStart: () => void;
}) {
  return (
    <div className="year-end-nudge" role="status">
      <div className="year-end-nudge-text">
        <strong>Plan {nextLabel} now?</strong>
        <span className="muted">
          {" "}
          Roll {sourceLabel} forward — buckets and projected amounts copy over,
          actuals stay put.
        </span>
      </div>
      <button type="button" className="btn primary" onClick={onStart}>
        Set up {nextLabel}
      </button>
    </div>
  );
}
