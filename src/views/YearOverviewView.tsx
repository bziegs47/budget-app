import type { YearOverview } from "../types";
import { formatUsd } from "../money";
import { varianceClassIncome, varianceClassExpense } from "./helpers";
import { YearEndNudge } from "./YearEndNudge";

export function YearOverviewView({
  overview,
  onActivateMonth,
  yearEndNudge,
  onStartYearEndNudge,
}: {
  overview: YearOverview;
  onActivateMonth: (id: number) => void;
  yearEndNudge: { sourceLabel: string; nextLabel: string } | null;
  onStartYearEndNudge: () => void;
}) {
  // Each card has its own three rows. Income and Expenses share the
  // Planned / Actual / Difference shape, but the Net card is a
  // different beast — it summarises the year by stacking actual
  // income against actual expenses, with the surplus/deficit as the
  // third row. We keep that intentionally inside the same totals grid
  // so the visual rhythm is consistent (three cards × three rows).
  type StatTone = "neutral" | "income-variance" | "expense-variance";
  type StatRow = { label: string; value: number; tone: StatTone };
  type TotalCard = { title: string; rows: StatRow[] };

  const incomeActual = overview.incomeActualCents;
  const expensesActual = overview.expenseNetActualCents;

  const totalCards: TotalCard[] = [
    {
      title: "Income",
      rows: [
        { label: "Planned", value: overview.incomePlannedCents, tone: "neutral" },
        { label: "Actual", value: incomeActual, tone: "neutral" },
        {
          label: "Difference",
          value: incomeActual - overview.incomePlannedCents,
          tone: "income-variance",
        },
      ],
    },
    {
      title: "Expenses",
      rows: [
        { label: "Planned", value: overview.expenseNetPlannedCents, tone: "neutral" },
        { label: "Actual", value: expensesActual, tone: "neutral" },
        {
          label: "Difference",
          // Under-spend is positive on an expense card, so we flip the
          // sign convention here: planned - actual.
          value: overview.expenseNetPlannedCents - expensesActual,
          tone: "expense-variance",
        },
      ],
    },
    {
      title: "Net",
      rows: [
        { label: "Income", value: incomeActual, tone: "neutral" },
        { label: "Expenses", value: expensesActual, tone: "neutral" },
        {
          label: "Difference",
          // Surplus (income − expenses) reads the same way as an
          // income variance: positive = good, negative = bad.
          value: incomeActual - expensesActual,
          tone: "income-variance",
        },
      ],
    },
  ];

  const toneClass = (tone: StatTone, value: number): string => {
    if (tone === "income-variance") return varianceClassIncome(value);
    if (tone === "expense-variance") return varianceClassExpense(value);
    return "";
  };

  return (
    <div className="year-overview">
      <header className="year-overview-header">
        <h1>{overview.yearLabel || "Year overview"}</h1>
        <p className="muted">
          {(() => {
            const tracked = overview.months.filter(
              (m) => m.incomeActualCents !== 0 || m.expenseNetActualCents !== 0,
            ).length;
            return `${tracked} ${tracked === 1 ? "month" : "months"} tracked`;
          })()}
        </p>
      </header>

      {yearEndNudge && (
        <YearEndNudge
          sourceLabel={yearEndNudge.sourceLabel}
          nextLabel={yearEndNudge.nextLabel}
          onStart={onStartYearEndNudge}
        />
      )}

      <section className="card">
        <h2>Year totals</h2>
        <div className="overview-totals">
          {totalCards.map((card) => (
            <div className="overview-total-card" key={card.title}>
              <div className="overview-total-label">{card.title}</div>
              <div className="overview-total-cols">
                {card.rows.map((row) => (
                  <div key={row.label}>
                    <div className="mini-label">{row.label}</div>
                    <div className={`num ${toneClass(row.tone, row.value)}`}>
                      {formatUsd(row.value, "rounded")}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>By bucket (annual)</h2>
        {overview.buckets.length === 0 ? (
          <p className="muted">No expense buckets yet.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Bucket</th>
                <th className="num">Planned</th>
                <th className="num">Actual</th>
                <th className="num">Variance</th>
              </tr>
            </thead>
            <tbody>
              {overview.buckets.map((b) => (
                <tr key={b.name}>
                  <td>{b.name}</td>
                  <td className="num">{formatUsd(b.plannedCents, "rounded")}</td>
                  <td className="num">{formatUsd(b.actualCents, "rounded")}</td>
                  <td className={`num ${varianceClassExpense(b.varianceCents)}`}>
                    {formatUsd(b.varianceCents, "rounded")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h2>By month</h2>
        {overview.months.length === 0 ? (
          <p className="muted">No months yet — add one from the sidebar.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Month</th>
                <th className="num">Income</th>
                <th className="num">Net expenses</th>
                <th className="num">Net</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {overview.months.map((m) => (
                <tr key={m.monthId}>
                  <td>{m.label}</td>
                  <td className="num">{formatUsd(m.incomeActualCents, "rounded")}</td>
                  <td className="num">{formatUsd(m.expenseNetActualCents, "rounded")}</td>
                  <td className={`num ${varianceClassExpense(m.netActualCents)}`}>
                    {formatUsd(m.netActualCents, "rounded")}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn-link"
                      onClick={() => onActivateMonth(m.monthId)}
                    >
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
