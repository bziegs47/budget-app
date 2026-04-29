import { formatUsd } from "../../money";

function SummaryRow({
  label,
  planned,
  actual,
  diff,
  diffClass,
  note,
}: {
  label: string;
  planned: number;
  actual: number;
  diff: number;
  diffClass: string;
  note?: string;
}) {
  return (
    <div className="summary-row">
      <div>
        <div className="summary-label">{label}</div>
        {note && <div className="summary-note">{note}</div>}
      </div>
      <div className="summary-cols">
        <div>
          <div className="mini-label">Projected</div>
          <div className="num">{formatUsd(planned, "rounded")}</div>
        </div>
        <div>
          <div className="mini-label">Actual</div>
          <div className="num">{formatUsd(actual, "rounded")}</div>
        </div>
        <div>
          <div className="mini-label">Difference</div>
          <div className={`num ${diffClass}`}>{formatUsd(diff, "rounded")}</div>
        </div>
      </div>
    </div>
  );
}

export { SummaryRow };
