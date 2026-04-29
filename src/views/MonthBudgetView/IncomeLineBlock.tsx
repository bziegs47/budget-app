import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { IncomeLineDto } from "../../types";
import { centsToInputString, formatUsd, parseMoneyToCents } from "../../money";
import { CalendarIcon, ListIcon } from "../../components/icons";
import { DateField, IconButton, PlannedAmountInput } from "../../components/primitives";
import { varianceClassIncome, selectAllOnFocus } from "../helpers";

function IncomeLineBlock({
  line,
  budgetYearMonth,
  expanded,
  onToggle,
  onRefresh,
  onOpenYtd,
}: {
  line: IncomeLineDto;
  budgetYearMonth: string;
  expanded: boolean;
  onToggle: () => void;
  onRefresh: () => void;
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
    await invoke("set_income_line_planned", { id: line.id, plannedCents: c });
    await onRefresh();
  };

  return (
    <>
      <tr className={line.entries.length ? "has-detail" : ""}>
        <td>{line.name}</td>
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
        <td className="num clickable-cell" onClick={onToggle} title="Show entries">
          {formatUsd(line.actualCents, "rounded")}
        </td>
        <td className={`num ${varianceClassIncome(line.varianceCents)}`}>
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
              label={expanded ? "Hide entries" : "Show entries"}
              onClick={onToggle}
              active={expanded}
            >
              <ListIcon />
            </IconButton>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="detail-row">
          <td colSpan={5}>
            <IncomeEntriesPanel lineId={line.id} entries={line.entries} budgetYearMonth={budgetYearMonth} onDone={onRefresh} />
          </td>
        </tr>
      )}
    </>
  );
}

function IncomeEntriesPanel({
  lineId,
  entries,
  budgetYearMonth,
  onDone,
}: {
  lineId: number;
  entries: IncomeLineDto["entries"];
  budgetYearMonth: string;
  onDone: () => void;
}) {
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [justAdded, setJustAdded] = useState(false);

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
          placeholder="Label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onFocus={selectAllOnFocus}
        />
        <input
          className="input"
          placeholder="Amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onFocus={selectAllOnFocus}
        />
        <DateField value={date} onChange={setDate} ariaLabel="Received on" fixedMonthYear={{ mm: budgetYearMonth.slice(5, 7), yyyy: budgetYearMonth.slice(0, 4) }} />
        <button type="button" className={`btn ${justAdded ? "primary" : "secondary"}`} onClick={() => void add()}>
          {justAdded ? "Added ✓" : "Add entry"}
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

export { IncomeLineBlock };
