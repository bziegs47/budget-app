import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ExpenseLineDto } from "../../types";
import { centsToInputString, formatUsd, parseMoneyToCents } from "../../money";
import { CalendarIcon, ListIcon, PencilIcon, TrashIcon } from "../../components/icons";
import { DateField, IconButton, PlannedAmountInput } from "../../components/primitives";
import { varianceClassExpense, selectAllOnFocus } from "../helpers";

function ExpenseLineBlock({
  line,
  budgetYearMonth,
  expanded,
  onToggle,
  onRefresh,
  onEdit,
  onDelete,
  onOpenYtd,
}: {
  line: ExpenseLineDto;
  budgetYearMonth: string;
  expanded: boolean;
  onToggle: () => void;
  onRefresh: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onOpenYtd: () => void;
}) {
  const [planned, setPlanned] = useState(centsToInputString(line.plannedCents));
  const [parseError, setParseError] = useState(false);
  useEffect(() => {
    setPlanned(centsToInputString(line.plannedCents));
    setParseError(false);
  }, [line.plannedCents]);

  const savePlanned = async () => {
    const c = parseMoneyToCents(planned);
    if (c === null) {
      setParseError(true);
      return;
    }
    setParseError(false);
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
          {line.isSinkingFund && (
            <span
              className="pill soft"
              title="Sinking fund — recurring savings toward a planned future expense"
            >
              sinking
            </span>
          )}
        </td>
        <td className="num">
          <PlannedAmountInput
            value={planned}
            onChange={(v) => {
              setPlanned(v);
              if (parseError) setParseError(false);
            }}
            onBlur={() => void savePlanned()}
            invalid={parseError}
          />
        </td>
        <td className="num clickable-cell" onClick={onToggle} title="Show transactions">
          {formatUsd(line.actualCents, "rounded")}
        </td>
        <td className={`num ${varianceClassExpense(line.varianceCents)}`}>
          {formatUsd(line.varianceCents, "rounded")}
        </td>
        <td className="actions">
          <div className="row-icon-actions">
            <IconButton
              label="Calendar year totals (this line)"
              onClick={onOpenYtd}
            >
              <CalendarIcon />
            </IconButton>
            <IconButton
              label={expanded ? "Hide transactions" : "Show transactions"}
              onClick={onToggle}
              active={expanded}
            >
              <ListIcon />
            </IconButton>
            {onEdit && (
              <IconButton
                label="Edit row (name, neutral, sinking)"
                onClick={onEdit}
              >
                <PencilIcon />
              </IconButton>
            )}
            {onDelete && (
              <IconButton label="Delete row" onClick={onDelete} variant="danger">
                <TrashIcon />
              </IconButton>
            )}
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="detail-row">
          <td colSpan={5}>
            <TransactionsPanel lineId={line.id} txs={line.transactions} budgetYearMonth={budgetYearMonth} onDone={onRefresh} />
          </td>
        </tr>
      )}
    </>
  );
}

function TransactionsPanel({
  lineId,
  txs,
  budgetYearMonth,
  onDone,
}: {
  lineId: number;
  txs: ExpenseLineDto["transactions"];
  budgetYearMonth: string;
  onDone: () => void;
}) {
  const [payee, setPayee] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [justAdded, setJustAdded] = useState(false);

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
    setDate("");
    setJustAdded(true);
    setTimeout(() => setJustAdded(false), 700);
    await onDone();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void add();
    }
  };

  return (
    <div className="detail-panel">
      <div className={`detail-toolbar${justAdded ? " just-added" : ""}`} onKeyDown={onKeyDown}>
        <input
          className="input"
          placeholder="Payee"
          value={payee}
          onChange={(e) => setPayee(e.target.value)}
          onFocus={selectAllOnFocus}
        />
        <input
          className="input"
          placeholder="Amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onFocus={selectAllOnFocus}
        />
        <DateField value={date} onChange={setDate} ariaLabel="Occurred on" fixedMonthYear={{ mm: budgetYearMonth.slice(5, 7), yyyy: budgetYearMonth.slice(0, 4) }} />
        <button type="button" className={`btn ${justAdded ? "primary" : "secondary"}`} onClick={() => void add()}>
          {justAdded ? "Added ✓" : "Add transaction"}
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

export { ExpenseLineBlock };
