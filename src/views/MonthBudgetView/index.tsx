import { MonthView } from "../../types";
import { ExportPickerButton } from "../../components/primitives";
import { varianceClassIncome, varianceClassExpense } from "../helpers";
import { YtdDualStrip } from "../YtdDualStrip";
import { SummaryRow } from "./SummaryRow";
import { IncomeLineBlock } from "./IncomeLineBlock";
import { ExpenseLineBlock } from "./ExpenseLineBlock";

function MonthBudgetView({
  view,
  expandedIncome,
  expandedExpense,
  onToggleIncome,
  onToggleExpense,
  onRefresh,
  onAddRow,
  onEditRow,
  onDeleteRow,
  onOpenReorder,
  onOpenLineYtd,
  onExportCsv,
  onExportJson,
  onExportCsvRedacted,
  onExportJsonRedacted,
}: {
  view: MonthView;
  expandedIncome: Set<number>;
  expandedExpense: Set<number>;
  onToggleIncome: (id: number) => void;
  onToggleExpense: (id: number) => void;
  onRefresh: () => void;
  onAddRow: (bucketId: number) => void;
  onEditRow: (lineId: number) => void;
  onDeleteRow: (lineId: number, name: string) => void;
  onOpenReorder: () => void;
  onOpenLineYtd: (args: {
    lineKind: "income" | "expense";
    lineIdentity: string;
    year: number;
    asOf: string | null;
  }) => void;
  onExportCsv: () => void;
  onExportJson: () => void;
  onExportCsvRedacted: () => void;
  onExportJsonRedacted: () => void;
}) {
  return (
    <>
      <header className="month-view-header">
        <h1>{view.tabLabel}</h1>
        <div className="month-view-toolbar">
          <ExportPickerButton
            label="Export CSV"
            formatLabel="CSV"
            onDetailed={onExportCsv}
            onRedacted={onExportCsvRedacted}
          />
          <ExportPickerButton
            label="Export JSON"
            formatLabel="JSON"
            onDetailed={onExportJson}
            onRedacted={onExportJsonRedacted}
          />
        </div>
      </header>

      <YtdDualStrip view={view} />


      <section className="card summary-card">
        <h2>Monthly summary</h2>
        <div className="summary-grid">
          <SummaryRow
            label="Total income"
            planned={view.summary.incomePlannedCents}
            actual={view.summary.incomeActualCents}
            diff={view.summary.incomeVarianceCents}
            diffClass={varianceClassIncome(view.summary.incomeVarianceCents)}
          />
          <SummaryRow
            label="Total expenses (net)"
            planned={view.summary.expenseNetPlannedCents}
            actual={view.summary.expenseNetActualCents}
            diff={view.summary.expenseNetVarianceCents}
            diffClass={varianceClassExpense(view.summary.expenseNetVarianceCents)}
          />
          <SummaryRow
            label="Neutral transfers (tracking)"
            planned={view.summary.neutralExpensePlannedCents}
            actual={view.summary.neutralExpenseActualCents}
            diff={
              view.summary.neutralExpensePlannedCents - view.summary.neutralExpenseActualCents
            }
            diffClass=""
            note="Excluded from net spend totals"
          />
          <SummaryRow
            label="Net"
            planned={view.summary.netPlannedCents}
            actual={view.summary.netActualCents}
            diff={view.summary.netVarianceCents}
            diffClass={varianceClassExpense(view.summary.netVarianceCents)}
          />
        </div>
      </section>

      <section className="card" id="section-income">
        <h2>Income</h2>
        <table className="data-table budget-line-table">
          <colgroup>
            <col />
            <col className="col-money" />
            <col className="col-money" />
            <col className="col-money" />
            <col className="col-actions" />
          </colgroup>
          <thead>
            <tr>
              <th>Line</th>
              <th className="num">Planned</th>
              <th className="num">Actual</th>
              <th className="num">Difference</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {view.incomeLines.map((line) => (
              <IncomeLineBlock
                key={line.id}
                line={line}
                budgetYearMonth={view.yearMonth}
                expanded={expandedIncome.has(line.id)}
                onToggle={() => onToggleIncome(line.id)}
                onRefresh={onRefresh}
                onOpenYtd={() =>
                  onOpenLineYtd({
                    lineKind: "income",
                    lineIdentity: line.lineIdentity,
                    year: Number(view.periodEnd.slice(0, 4)),
                    asOf: view.periodEnd,
                  })
                }
              />
            ))}
          </tbody>
        </table>
      </section>

      <div className="buckets-toolbar">
        <button
          type="button"
          className="btn secondary"
          onClick={onOpenReorder}
          title="Open the bucket reorder window (⌘R)"
        >
          Reorganize
        </button>
      </div>
      {view.expenseBuckets.map((bucket) => (
        <section key={bucket.id} className="card bucket-card" id={`section-bucket-${bucket.id}`}>
          <div className="bucket-header">
            <h2>{bucket.name}</h2>
          </div>
          <table className="data-table budget-line-table">
            <colgroup>
              <col />
              <col className="col-money" />
              <col className="col-money" />
              <col className="col-money" />
              <col className="col-actions" />
            </colgroup>
            <thead>
              <tr>
                <th>Line</th>
                <th className="num">Planned</th>
                <th className="num">Actual</th>
                <th className="num">Variance</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {bucket.lines.map((line) => (
                <ExpenseLineBlock
                  key={line.id}
                  line={line}
                  budgetYearMonth={view.yearMonth}
                  expanded={expandedExpense.has(line.id)}
                  onToggle={() => onToggleExpense(line.id)}
                  onRefresh={onRefresh}
                  onEdit={() => onEditRow(line.id)}
                  onDelete={() => onDeleteRow(line.id, line.name)}
                  onOpenYtd={() =>
                    onOpenLineYtd({
                      lineKind: "expense",
                      lineIdentity: line.lineIdentity,
                      year: Number(view.periodEnd.slice(0, 4)),
                      asOf: view.periodEnd,
                    })
                  }
                />
              ))}
            </tbody>
          </table>
          <div className="bucket-footer">
            <button
              type="button"
              className="btn-link"
              onClick={() => onAddRow(bucket.id)}
            >
              + Add row
            </button>
          </div>
        </section>
      ))}
    </>
  );
}

export { MonthBudgetView };
