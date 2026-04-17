import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  centsToInputString,
  currentYearMonth,
  formatUsd,
  parseMoneyToCents,
} from "./money";
import type { ExpenseLineDto, IncomeLineDto, MonthRow, MonthView } from "./types";
import "./App.css";

function varianceClassIncome(varianceCents: number): string {
  if (varianceCents > 0) return "variance-good";
  if (varianceCents < 0) return "variance-bad";
  return "";
}

function varianceClassExpense(varianceCents: number): string {
  if (varianceCents > 0) return "variance-good";
  if (varianceCents < 0) return "variance-bad";
  return "";
}

export default function App() {
  const [months, setMonths] = useState<MonthRow[]>([]);
  const [yearMonth, setYearMonth] = useState(currentYearMonth());
  const [view, setView] = useState<MonthView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedIncome, setExpandedIncome] = useState<Set<number>>(new Set());
  const [expandedExpense, setExpandedExpense] = useState<Set<number>>(new Set());
  const [dbPath, setDbPath] = useState<string>("");

  const toggleIncome = (id: number) => {
    setExpandedIncome((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const toggleExpense = (id: number) => {
    setExpandedExpense((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const refresh = useCallback(async (ym: string) => {
    setError(null);
    const v = await invoke<MonthView>("get_month_view", { yearMonth: ym });
    setView(v);
  }, []);

  const bootstrap = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const path = await invoke<string>("get_database_path");
      setDbPath(path);
      const ym = currentYearMonth();
      await invoke("ensure_month", { yearMonth: ym });
      const list = await invoke<MonthRow[]>("list_months");
      setMonths(list);
      const active =
        list.find((m) => m.yearMonth === ym)?.yearMonth ?? list[list.length - 1]?.yearMonth ?? ym;
      setYearMonth(active);
      await refresh(active);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [refresh]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  const onSelectMonth = async (ym: string) => {
    setYearMonth(ym);
    setLoading(true);
    try {
      await refresh(ym);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const onEnsureMonth = async () => {
    setLoading(true);
    setError(null);
    try {
      await invoke("ensure_month", { yearMonth });
      const list = await invoke<MonthRow[]>("list_months");
      setMonths(list);
      await refresh(yearMonth);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const onDuplicate = async () => {
    const to = window.prompt("New month as YYYY-MM (must not exist yet)", "");
    if (!to) return;
    setLoading(true);
    setError(null);
    try {
      await invoke("duplicate_month", {
        fromYearMonth: yearMonth,
        toYearMonth: to.trim(),
      });
      const list = await invoke<MonthRow[]>("list_months");
      setMonths(list);
      setYearMonth(to.trim());
      await refresh(to.trim());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const onExport = async () => {
    const csv = await invoke<string>("export_csv_data");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `budget-export-${yearMonth}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const monthOptions = useMemo(
    () => [...months].sort((a, b) => a.yearMonth.localeCompare(b.yearMonth)),
    [months],
  );

  if (loading && !view) {
    return (
      <div className="app-shell">
        <p className="muted">Loading…</p>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="top-bar">
        <div className="brand">
          <span className="brand-mark">◆</span>
          <span>Budget</span>
        </div>
        <label className="field-inline">
          <span className="label">Month</span>
          <select
            value={yearMonth}
            onChange={(e) => void onSelectMonth(e.target.value)}
            className="select"
          >
            {monthOptions.map((m) => (
              <option key={m.id} value={m.yearMonth}>
                {m.yearMonth}
              </option>
            ))}
          </select>
        </label>
        <label className="field-inline">
          <span className="label">Go to</span>
          <input
            className="input mono"
            value={yearMonth}
            onChange={(e) => setYearMonth(e.target.value)}
            placeholder="YYYY-MM"
          />
        </label>
        <button type="button" className="btn secondary" onClick={() => void onEnsureMonth()}>
          Open / create
        </button>
        <button type="button" className="btn secondary" onClick={() => void onDuplicate()}>
          Duplicate month
        </button>
        <button type="button" className="btn primary" onClick={() => void onExport()}>
          Export CSV
        </button>
      </header>

      {error && (
        <div className="banner error" role="alert">
          {error}
        </div>
      )}

      {view && (
        <>
          <section className="ytd-strip">
            <div>
              <div className="ytd-label">YTD income (actual)</div>
              <div className="ytd-value">{formatUsd(view.ytd.incomeActualCents, "rounded")}</div>
            </div>
            <div>
              <div className="ytd-label">YTD expenses (net)</div>
              <div className="ytd-value">{formatUsd(view.ytd.expenseNetActualCents, "rounded")}</div>
            </div>
            <div>
              <div className="ytd-label">YTD net</div>
              <div className="ytd-value">{formatUsd(view.ytd.netActualCents, "rounded")}</div>
            </div>
            <div className="ytd-meta">
              Calendar {view.ytd.year} through {view.ytd.throughMonth}
            </div>
          </section>

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
                diff={view.summary.neutralExpensePlannedCents - view.summary.neutralExpenseActualCents}
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

          <section className="card">
            <h2>Income</h2>
            <table className="data-table">
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
                    expanded={expandedIncome.has(line.id)}
                    onToggle={() => toggleIncome(line.id)}
                    onRefresh={() => void refresh(yearMonth)}
                  />
                ))}
              </tbody>
            </table>
          </section>

          {view.expenseBuckets.map((bucket) => (
            <section key={bucket.id} className="card bucket-card">
              <div className="bucket-header">
                <h2>{bucket.name}</h2>
              </div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Line</th>
                    <th className="num">Planned</th>
                    <th className="num">Rollover in</th>
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
                      expanded={expandedExpense.has(line.id)}
                      onToggle={() => toggleExpense(line.id)}
                      onRefresh={() => void refresh(yearMonth)}
                    />
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </>
      )}

      <footer className="footer muted">
        <span>Data file: {dbPath || "—"}</span>
      </footer>
    </div>
  );
}

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

function IncomeLineBlock({
  line,
  expanded,
  onToggle,
  onRefresh,
}: {
  line: IncomeLineDto;
  expanded: boolean;
  onToggle: () => void;
  onRefresh: () => void;
}) {
  const [planned, setPlanned] = useState(centsToInputString(line.plannedCents));
  useEffect(() => {
    setPlanned(centsToInputString(line.plannedCents));
  }, [line.plannedCents]);

  const savePlanned = async () => {
    const c = parseMoneyToCents(planned);
    if (c === null) return;
    await invoke("set_income_line_planned", { id: line.id, plannedCents: c });
    await onRefresh();
  };

  return (
    <>
      <tr className={line.entries.length ? "has-detail" : ""}>
        <td>{line.name}</td>
        <td className="num">
          <input
            className="input-money"
            value={planned}
            onChange={(e) => setPlanned(e.target.value)}
            onBlur={() => void savePlanned()}
          />
        </td>
        <td className="num">{formatUsd(line.actualCents, "rounded")}</td>
        <td className={`num ${varianceClassIncome(line.varianceCents)}`}>
          {formatUsd(line.varianceCents, "rounded")}
        </td>
        <td className="actions">
          <button type="button" className="btn-link" onClick={onToggle}>
            {expanded ? "Hide entries" : "Entries"}
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="detail-row">
          <td colSpan={5}>
            <IncomeEntriesPanel lineId={line.id} entries={line.entries} onDone={onRefresh} />
          </td>
        </tr>
      )}
    </>
  );
}

function IncomeEntriesPanel({
  lineId,
  entries,
  onDone,
}: {
  lineId: number;
  entries: IncomeLineDto["entries"];
  onDone: () => void;
}) {
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");

  const add = async () => {
    const c = parseMoneyToCents(amount);
    if (c === null || c === 0) return;
    await invoke("add_income_entry", {
      incomeLineId: lineId,
      label: label || "Income",
      amountCents: c,
      receivedOn: date || null,
    });
    setLabel("");
    setAmount("");
    await onDone();
  };

  return (
    <div className="detail-panel">
      <div className="detail-toolbar">
        <input
          className="input"
          placeholder="Label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <input
          className="input"
          placeholder="Amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <input
          className="input mono"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <button type="button" className="btn secondary" onClick={() => void add()}>
          Add entry
        </button>
      </div>
      <ul className="entry-list">
        {entries.map((e) => (
          <li key={e.id} className="entry-row">
            <span>{e.label}</span>
            <span className="muted mono">{e.receivedOn ?? ""}</span>
            <span className="num">{formatUsd(e.amountCents, "exact")}</span>
            <button
              type="button"
              className="btn-link danger"
              onClick={() => void invoke("delete_income_entry", { id: e.id }).then(onDone)}
            >
              Remove
            </button>
          </li>
        ))}
        {entries.length === 0 && <li className="muted">No entries yet.</li>}
      </ul>
    </div>
  );
}

function ExpenseLineBlock({
  line,
  expanded,
  onToggle,
  onRefresh,
}: {
  line: ExpenseLineDto;
  expanded: boolean;
  onToggle: () => void;
  onRefresh: () => void;
}) {
  const [planned, setPlanned] = useState(centsToInputString(line.plannedCents));
  useEffect(() => {
    setPlanned(centsToInputString(line.plannedCents));
  }, [line.plannedCents]);

  const savePlanned = async () => {
    const c = parseMoneyToCents(planned);
    if (c === null) return;
    await invoke("set_expense_line_planned", { id: line.id, plannedCents: c });
    await onRefresh();
  };

  const rowClass = [
    line.isNeutralTransfer ? "neutral-line" : "",
    line.transactions.length ? "has-detail" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <tr className={rowClass}>
        <td>
          {line.name}
          {line.isNeutralTransfer && (
            <span className="pill" title="Excluded from net spend">
              tracking
            </span>
          )}
          {line.isSinkingFund && <span className="pill soft">sinking</span>}
        </td>
        <td className="num">
          <input
            className="input-money"
            value={planned}
            onChange={(e) => setPlanned(e.target.value)}
            onBlur={() => void savePlanned()}
          />
        </td>
        <td className="num">{formatUsd(line.rolloverInCents, "rounded")}</td>
        <td className="num">{formatUsd(line.actualCents, "rounded")}</td>
        <td className={`num ${varianceClassExpense(line.varianceCents)}`}>
          {formatUsd(line.varianceCents, "rounded")}
        </td>
        <td className="actions">
          <button type="button" className="btn-link" onClick={onToggle}>
            {expanded ? "Hide transactions" : "Transactions"}
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="detail-row">
          <td colSpan={6}>
            <TransactionsPanel lineId={line.id} txs={line.transactions} onDone={onRefresh} />
          </td>
        </tr>
      )}
    </>
  );
}

function TransactionsPanel({
  lineId,
  txs,
  onDone,
}: {
  lineId: number;
  txs: ExpenseLineDto["transactions"];
  onDone: () => void;
}) {
  const [payee, setPayee] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");

  const add = async () => {
    const c = parseMoneyToCents(amount);
    if (c === null || c === 0) return;
    await invoke("add_transaction", {
      expenseLineId: lineId,
      payee: payee || "Purchase",
      amountCents: c,
      occurredOn: date || null,
    });
    setPayee("");
    setAmount("");
    await onDone();
  };

  return (
    <div className="detail-panel">
      <div className="detail-toolbar">
        <input
          className="input"
          placeholder="Payee"
          value={payee}
          onChange={(e) => setPayee(e.target.value)}
        />
        <input
          className="input"
          placeholder="Amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <input
          className="input mono"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <button type="button" className="btn secondary" onClick={() => void add()}>
          Add transaction
        </button>
      </div>
      <ul className="entry-list">
        {txs.map((t) => (
          <li key={t.id} className="entry-row">
            <span>{t.payee}</span>
            <span className="muted mono">{t.occurredOn ?? ""}</span>
            <span className="num">{formatUsd(t.amountCents, "exact")}</span>
            <button
              type="button"
              className="btn-link danger"
              onClick={() => void invoke("delete_transaction", { id: t.id }).then(onDone)}
            >
              Remove
            </button>
          </li>
        ))}
        {txs.length === 0 && <li className="muted">No transactions yet.</li>}
      </ul>
    </div>
  );
}
