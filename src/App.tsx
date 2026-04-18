import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import {
  centsToInputString,
  currentYearMonth,
  formatUsd,
  fullMonthBoundsFromYearMonth,
  nextFullMonthAfterPeriodEnd,
  parseMoneyToCents,
} from "./money";
import type {
  AppSettings,
  ExpenseBucketDto,
  ExpenseLineDto,
  ExternalRenameInfo,
  IncomeLineDto,
  LibraryEntry,
  MonthRow,
  MonthView,
  RecentFile,
  WorkspaceMeta,
  YearOverview,
} from "./types";
import "./App.css";

type IconProps = { size?: number; className?: string };

function ListIcon({ size = 16, className }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <line x1="9" y1="6" x2="20" y2="6" />
      <line x1="9" y1="12" x2="20" y2="12" />
      <line x1="9" y1="18" x2="20" y2="18" />
      <circle cx="4.5" cy="6" r="1.25" />
      <circle cx="4.5" cy="12" r="1.25" />
      <circle cx="4.5" cy="18" r="1.25" />
    </svg>
  );
}

function PencilIcon({ size = 16, className }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4 20h4l11-11a2.5 2.5 0 0 0-3.5-3.5L4.5 16.5z" />
      <path d="M14 7l3 3" />
    </svg>
  );
}

function CalendarIcon({ size = 16, className }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
      <line x1="3.5" y1="9.5" x2="20.5" y2="9.5" />
      <line x1="8" y1="3.5" x2="8" y2="6.5" />
      <line x1="16" y1="3.5" x2="16" y2="6.5" />
    </svg>
  );
}

function TrashIcon({ size = 16, className }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4 7h16" />
      <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
      <path d="M6 7l1 12.2A2 2 0 0 0 9 21h6a2 2 0 0 0 2-1.8L18 7" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}

function IconButton({
  label,
  onClick,
  variant,
  active,
  children,
}: {
  label: string;
  onClick: () => void;
  variant?: "default" | "danger";
  active?: boolean;
  children: ReactNode;
}) {
  const cls = [
    "icon-btn",
    variant === "danger" ? "danger" : "",
    active ? "active" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      type="button"
      className={cls}
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}

type DateParts = { mm: string; dd: string; yyyy: string };

function isoToParts(iso: string): DateParts {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  if (!m) return { mm: "", dd: "", yyyy: "" };
  return { mm: m[2], dd: m[3], yyyy: m[1] };
}

function partsToIso(p: DateParts): string {
  if (p.mm.length !== 2 || p.dd.length !== 2 || p.yyyy.length !== 4) return "";
  const y = parseInt(p.yyyy, 10);
  const mo = parseInt(p.mm, 10);
  const d = parseInt(p.dd, 10);
  if (!y || !mo || !d || mo < 1 || mo > 12 || d < 1 || d > 31) return "";
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== mo - 1 ||
    dt.getUTCDate() !== d
  ) {
    return "";
  }
  return `${p.yyyy}-${p.mm}-${p.dd}`;
}

function isoOfDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const DOW_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function PopoverCalendar({
  value,
  onSelect,
  onClose,
  anchorRef,
}: {
  value: string;
  onSelect: (iso: string) => void;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
}) {
  const popRef = useRef<HTMLDivElement>(null);

  const initialView = useMemo(() => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
    if (m) return { year: parseInt(m[1], 10), month: parseInt(m[2], 10) - 1 };
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  }, [value]);

  const [view, setView] = useState(initialView);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    const reposition = () => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      const popWidth = 252;
      const popHeight = 280;
      const margin = 8;
      let top = rect.bottom + 6;
      if (top + popHeight > window.innerHeight - margin) {
        top = Math.max(margin, rect.top - popHeight - 6);
      }
      let left = rect.right - popWidth;
      left = Math.max(margin, Math.min(window.innerWidth - popWidth - margin, left));
      setPos({ top, left });
    };
    reposition();
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [anchorRef]);

  useEffect(() => {
    const onMouseDown = (ev: MouseEvent) => {
      const target = ev.target as Node | null;
      if (!target) return;
      if (popRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onMouseDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onMouseDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [onClose, anchorRef]);

  const cells = useMemo(() => {
    const firstWeekday = new Date(view.year, view.month, 1).getDay();
    const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();
    const out: { date: Date; current: boolean }[] = [];
    for (let i = 0; i < firstWeekday; i++) {
      out.push({
        date: new Date(view.year, view.month, i - firstWeekday + 1),
        current: false,
      });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      out.push({ date: new Date(view.year, view.month, d), current: true });
    }
    while (out.length < 42) {
      const last = out[out.length - 1].date;
      const next = new Date(last);
      next.setDate(next.getDate() + 1);
      out.push({ date: next, current: false });
    }
    return out;
  }, [view]);

  const monthLabel = new Date(view.year, view.month, 1).toLocaleString(undefined, {
    month: "long",
    year: "numeric",
  });
  const todayIso = isoOfDate(new Date());

  const goPrev = () =>
    setView((v) =>
      v.month === 0 ? { year: v.year - 1, month: 11 } : { year: v.year, month: v.month - 1 },
    );
  const goNext = () =>
    setView((v) =>
      v.month === 11 ? { year: v.year + 1, month: 0 } : { year: v.year, month: v.month + 1 },
    );

  const style: React.CSSProperties = pos
    ? { position: "fixed", top: pos.top, left: pos.left, zIndex: 80 }
    : { position: "fixed", visibility: "hidden", top: 0, left: 0, zIndex: 80 };

  return (
    <div className="cal-popover" ref={popRef} style={style} role="dialog" aria-label="Date picker">
      <div className="cal-header">
        <button
          type="button"
          className="cal-nav"
          onClick={goPrev}
          aria-label="Previous month"
        >
          ‹
        </button>
        <span className="cal-title">{monthLabel}</span>
        <button
          type="button"
          className="cal-nav"
          onClick={goNext}
          aria-label="Next month"
        >
          ›
        </button>
      </div>
      <div className="cal-dow">
        {DOW_LABELS.map((d) => (
          <span key={d} className="cal-dow-cell">
            {d}
          </span>
        ))}
      </div>
      <div className="cal-grid">
        {cells.map((cell, i) => {
          const iso = isoOfDate(cell.date);
          const cls = ["cal-day"];
          if (!cell.current) cls.push("muted");
          if (iso === value) cls.push("selected");
          if (iso === todayIso) cls.push("today");
          return (
            <button
              key={i}
              type="button"
              className={cls.join(" ")}
              onClick={() => {
                onSelect(iso);
                onClose();
              }}
            >
              {cell.date.getDate()}
            </button>
          );
        })}
      </div>
      <div className="cal-footer">
        <button
          type="button"
          className="cal-foot-btn"
          onClick={() => {
            onSelect(todayIso);
            onClose();
          }}
        >
          Today
        </button>
        <button
          type="button"
          className="cal-foot-btn"
          onClick={() => {
            onSelect("");
            onClose();
          }}
        >
          Clear
        </button>
      </div>
    </div>
  );
}

/**
 * Date input split into MM / DD / YYYY segments. Each segment auto-advances
 * to the next when filled, and Backspace from an empty segment moves back to
 * the previous one. A trailing calendar button opens a custom popover calendar.
 * `value` is an ISO YYYY-MM-DD string; an empty string means "no date".
 */
function DateField({
  value,
  onChange,
  ariaLabel = "Date",
}: {
  value: string;
  onChange: (iso: string) => void;
  ariaLabel?: string;
}) {
  const [parts, setParts] = useState<DateParts>(() => isoToParts(value));
  const partsRef = useRef<DateParts>(parts);
  const mmRef = useRef<HTMLInputElement>(null);
  const ddRef = useRef<HTMLInputElement>(null);
  const yyRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const calBtnRef = useRef<HTMLButtonElement>(null);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const justAdvancedRef = useRef(false);

  useEffect(() => {
    const next = isoToParts(value);
    partsRef.current = next;
    setParts(next);
  }, [value]);

  const emit = useCallback(
    (next: DateParts) => {
      if (next.mm === "" && next.dd === "" && next.yyyy === "") {
        if (value !== "") onChange("");
        return;
      }
      const iso = partsToIso(next);
      if (iso && iso !== value) onChange(iso);
    },
    [onChange, value],
  );

  const update = useCallback(
    (next: DateParts) => {
      partsRef.current = next;
      setParts(next);
      emit(next);
    },
    [emit],
  );

  const onSegChange = (
    seg: keyof DateParts,
    raw: string,
    maxLen: number,
    nextRef: React.RefObject<HTMLInputElement | null> | null,
  ) => {
    const digits = raw.replace(/\D/g, "").slice(0, maxLen);
    const next = { ...partsRef.current, [seg]: digits };
    update(next);
    if (digits.length === maxLen && nextRef?.current) {
      justAdvancedRef.current = true;
      nextRef.current.focus();
      nextRef.current.select();
    }
  };

  const onSegKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    seg: keyof DateParts,
    prevRef: React.RefObject<HTMLInputElement | null> | null,
    nextRef: React.RefObject<HTMLInputElement | null> | null,
  ) => {
    const target = e.currentTarget;
    if (e.key === "Backspace" && target.value === "" && prevRef?.current) {
      e.preventDefault();
      prevRef.current.focus();
      const len = prevRef.current.value.length;
      prevRef.current.setSelectionRange(len, len);
      return;
    }
    if (e.key === "ArrowLeft" && target.selectionStart === 0 && prevRef?.current) {
      e.preventDefault();
      prevRef.current.focus();
      const len = prevRef.current.value.length;
      prevRef.current.setSelectionRange(len, len);
      return;
    }
    if (
      e.key === "ArrowRight" &&
      target.selectionStart === target.value.length &&
      nextRef?.current
    ) {
      e.preventDefault();
      nextRef.current.focus();
      nextRef.current.setSelectionRange(0, 0);
      return;
    }
    if ((e.key === "/" || e.key === "-" || e.key === " ") && nextRef?.current) {
      e.preventDefault();
      const cur = partsRef.current[seg];
      const padded = seg !== "yyyy" && cur.length === 1 ? `0${cur}` : cur;
      const next = { ...partsRef.current, [seg]: padded };
      update(next);
      nextRef.current.focus();
      nextRef.current.select();
    }
  };

  const padOnBlur = (seg: "mm" | "dd") => {
    if (justAdvancedRef.current) {
      justAdvancedRef.current = false;
      return;
    }
    const cur = partsRef.current[seg];
    if (cur.length === 1) {
      update({ ...partsRef.current, [seg]: `0${cur}` });
    }
  };

  const closePopover = useCallback(() => setPopoverOpen(false), []);

  const togglePopover = () => {
    setPopoverOpen((open) => !open);
  };

  const onPickDate = (iso: string) => {
    if (iso === "") {
      update({ mm: "", dd: "", yyyy: "" });
    } else {
      update(isoToParts(iso));
    }
  };

  const clear = () => {
    update({ mm: "", dd: "", yyyy: "" });
    mmRef.current?.focus();
  };

  const hasAny = parts.mm !== "" || parts.dd !== "" || parts.yyyy !== "";

  return (
    <div className="date-field" role="group" aria-label={ariaLabel} ref={rootRef}>
      <input
        ref={mmRef}
        className="date-seg date-seg-mm"
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="MM"
        aria-label="Month"
        maxLength={2}
        value={parts.mm}
        onChange={(e) => onSegChange("mm", e.target.value, 2, ddRef)}
        onKeyDown={(e) => onSegKeyDown(e, "mm", null, ddRef)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={() => padOnBlur("mm")}
      />
      <span className="date-sep" aria-hidden="true">/</span>
      <input
        ref={ddRef}
        className="date-seg date-seg-dd"
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="DD"
        aria-label="Day"
        maxLength={2}
        value={parts.dd}
        onChange={(e) => onSegChange("dd", e.target.value, 2, yyRef)}
        onKeyDown={(e) => onSegKeyDown(e, "dd", mmRef, yyRef)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={() => padOnBlur("dd")}
      />
      <span className="date-sep" aria-hidden="true">/</span>
      <input
        ref={yyRef}
        className="date-seg date-seg-yyyy"
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="YYYY"
        aria-label="Year"
        maxLength={4}
        value={parts.yyyy}
        onChange={(e) => onSegChange("yyyy", e.target.value, 4, null)}
        onKeyDown={(e) => onSegKeyDown(e, "yyyy", ddRef, null)}
        onFocus={(e) => e.currentTarget.select()}
      />
      {hasAny && (
        <button
          type="button"
          className="date-clear"
          onClick={clear}
          title="Clear date"
          aria-label="Clear date"
        >
          ×
        </button>
      )}
      <button
        ref={calBtnRef}
        type="button"
        className={`date-picker-btn${popoverOpen ? " active" : ""}`}
        onClick={togglePopover}
        title="Pick a date"
        aria-label="Open date picker"
        aria-expanded={popoverOpen}
      >
        <CalendarIcon />
      </button>
      {popoverOpen && (
        <PopoverCalendar
          value={partsToIso(parts)}
          onSelect={onPickDate}
          onClose={closePopover}
          anchorRef={calBtnRef}
        />
      )}
    </div>
  );
}

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

function selectAllOnFocus(e: React.FocusEvent<HTMLInputElement>) {
  e.currentTarget.select();
}

function PlannedAmountInput({
  value,
  onChange,
  onBlur,
}: {
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
}) {
  return (
    <span className="currency-field" title="USD — planned amount">
      <span className="currency-symbol">$</span>
      <input
        className="input-money"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={selectAllOnFocus}
        onBlur={onBlur}
        inputMode="decimal"
        autoComplete="off"
        aria-label="Planned amount (USD)"
      />
    </span>
  );
}

type PeriodModalConfig = {
  intent: "create" | "duplicate" | "edit";
  editMonthId?: number;
  title: string;
  confirmLabel: string;
  initialStart: string;
  initialEnd: string;
};

function PeriodRangeModal({
  config,
  onClose,
  onConfirm,
}: {
  config: PeriodModalConfig | null;
  onClose: () => void;
  onConfirm: (start: string, end: string) => void;
}) {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  useEffect(() => {
    if (!config) return;
    setStart(config.initialStart);
    setEnd(config.initialEnd);
  }, [config]);

  if (!config) return null;

  const startYearMonth = start.length >= 7 ? start.slice(0, 7) : "";

  const applyFullMonth = () => {
    if (!startYearMonth) return;
    const b = fullMonthBoundsFromYearMonth(startYearMonth);
    setStart(b.periodStart);
    setEnd(b.periodEnd);
  };

  const save = () => {
    if (end < start) {
      window.alert("End date must be on or after start date.");
      return;
    }
    onConfirm(start, end);
  };

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="period-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="period-modal-title" className="modal-title">
          {config.title}
        </h2>
        <p className="modal-assume">
          If the range is a full calendar month, the tab label uses the month shorthand (e.g. APR &apos;26).
        </p>
        <div className="modal-fields">
          <label className="field-inline" style={{ flexDirection: "column", alignItems: "stretch" }}>
            <span className="label">Start</span>
            <input
              className="input mono"
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <label className="field-inline" style={{ flexDirection: "column", alignItems: "stretch" }}>
            <span className="label">End</span>
            <input
              className="input mono"
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
          <div className="modal-quick">
            <button
              type="button"
              className="btn secondary"
              onClick={() => applyFullMonth()}
              disabled={!startYearMonth}
            >
              Use full month
            </button>
            <p className="modal-hint">
              Sets the range to the full calendar month of the <strong>Start</strong> date (End is ignored).
            </p>
          </div>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={() => void save()}>
            {config.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function BucketReorderModal({
  open,
  buckets,
  onClose,
  onCommit,
}: {
  open: boolean;
  buckets: ExpenseBucketDto[];
  onClose: () => void;
  onCommit: (orderedIds: number[]) => void;
}) {
  const [pending, setPending] = useState<number[]>([]);
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [dropTargetId, setDropTargetId] = useState<number | null>(null);

  useEffect(() => {
    if (open) {
      setPending(buckets.map((b) => b.id));
      setDraggingId(null);
      setDropTargetId(null);
    }
  }, [open, buckets]);

  if (!open) return null;

  const nameFor = (id: number) => buckets.find((b) => b.id === id)?.name ?? `#${id}`;

  const handleDrop = (targetId: number) => {
    const dragged = draggingId;
    setDraggingId(null);
    setDropTargetId(null);
    if (dragged == null || dragged === targetId) return;
    setPending((prev) => {
      const next = [...prev];
      const from = next.indexOf(dragged);
      const to = next.indexOf(targetId);
      if (from < 0 || to < 0) return prev;
      next.splice(from, 1);
      next.splice(to, 0, dragged);
      return next;
    });
  };

  const done = () => {
    onCommit(pending);
    onClose();
  };

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-card bucket-reorder-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bucket-reorder-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="bucket-reorder-title" className="modal-title">
          Reorder buckets
        </h2>
        <p className="modal-hint">
          Drag a row to reorder. Click <strong>Done</strong> to apply changes to the budget.
        </p>
        <ul className="bucket-reorder-list" role="list">
          {pending.map((id) => {
            const isDragging = draggingId === id;
            const isDropTarget = dropTargetId === id && draggingId !== id;
            const cls = [
              "bucket-reorder-row",
              isDragging ? "dragging" : "",
              isDropTarget ? "drop-target" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <li
                key={id}
                className={cls}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", String(id));
                  setDraggingId(id);
                }}
                onDragEnd={() => {
                  setDraggingId(null);
                  setDropTargetId(null);
                }}
                onDragOver={(e) => {
                  if (draggingId == null) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (dropTargetId !== id) setDropTargetId(id);
                }}
                onDragLeave={() => {
                  if (dropTargetId === id) setDropTargetId(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  handleDrop(id);
                }}
              >
                <span className="bucket-reorder-handle" aria-hidden="true">
                  ⋮⋮
                </span>
                <span className="bucket-reorder-name">{nameFor(id)}</span>
              </li>
            );
          })}
          {pending.length === 0 && (
            <li className="muted">No buckets to reorder.</li>
          )}
        </ul>
        <div className="modal-actions">
          <button type="button" className="btn secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={done}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function UnsavedChangesModal({
  open,
  busy,
  onSave,
  onDiscard,
  onCancel,
}: {
  open: boolean;
  busy: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={() => {
        if (!busy) onCancel();
      }}
    >
      <div
        className="modal-card unsaved-changes-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="unsaved-changes-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="unsaved-changes-title" className="modal-title">
          Save changes before quitting?
        </h2>
        <p className="modal-hint">
          This workspace has not been saved to a <code>.budget</code> file. Save it now or your
          changes will only remain in this app's default workspace.
        </p>
        <div className="modal-actions unsaved-changes-actions">
          <button
            type="button"
            className="btn ghost"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn secondary"
            onClick={onDiscard}
            disabled={busy}
          >
            Quit without saving
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={onSave}
            disabled={busy}
            autoFocus
          >
            {busy ? "Saving…" : "Save & quit"}
          </button>
        </div>
      </div>
    </div>
  );
}

type AppView =
  | { kind: "welcome" }
  | { kind: "library" }
  | { kind: "overview" }
  | { kind: "month"; monthId: number };

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform 0.12s" }}
    >
      <polyline points="9 6 15 12 9 18" />
    </svg>
  );
}

function PlusIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <line x1="5" y1="12" x2="19" y2="12" />
      <line x1="12" y1="5" x2="12" y2="19" />
    </svg>
  );
}

function FolderIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.4l1.6 2H19.5A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z" />
    </svg>
  );
}

function LockIcon({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function YearLabelEditor({
  initial,
  onCancel,
  onCommit,
}: {
  initial: string;
  onCancel: () => void;
  onCommit: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  return (
    <form
      className="year-label-form"
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = value.trim();
        if (trimmed) onCommit(trimmed);
        else onCancel();
      }}
    >
      <input
        ref={inputRef}
        className="year-label-input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          const trimmed = value.trim();
          if (trimmed && trimmed !== initial) onCommit(trimmed);
          else onCancel();
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        aria-label="Year label"
      />
    </form>
  );
}

function YearHeader({
  meta,
  isDefaultWorkspace,
  active,
  onActivate,
  onRename,
}: {
  meta: WorkspaceMeta | null;
  isDefaultWorkspace: boolean;
  active: boolean;
  onActivate: () => void;
  onRename: (label: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const label = meta?.yearLabel?.trim() || (isDefaultWorkspace ? "Untitled" : "");
  return (
    <div className={`sidebar-year ${active ? "active" : ""}`}>
      <button
        type="button"
        className="sidebar-year-main"
        onClick={onActivate}
        title="Show year overview"
      >
        <span className="sidebar-year-eyebrow">Workspace</span>
        {editing ? (
          <YearLabelEditor
            initial={label}
            onCancel={() => setEditing(false)}
            onCommit={async (next) => {
              setEditing(false);
              await onRename(next);
            }}
          />
        ) : (
          <span className="sidebar-year-label" title="Click to rename">
            {label || "Add a year label"}
          </span>
        )}
      </button>
      {!editing && (
        <button
          type="button"
          className="icon-btn small ghost"
          title="Rename year (also renames the file)"
          aria-label="Rename year"
          onClick={(e) => {
            e.stopPropagation();
            setEditing(true);
          }}
        >
          <PencilIcon size={13} />
        </button>
      )}
    </div>
  );
}

function MonthRowItem({
  row,
  active,
  onActivate,
  onEditDates,
}: {
  row: MonthRow;
  active: boolean;
  onActivate: () => void;
  onEditDates: () => void;
}) {
  return (
    <li className={`sidebar-month-row ${active ? "active" : ""}`}>
      <button type="button" className="sidebar-month-main" onClick={onActivate}>
        <span className="sidebar-month-label">{row.tabLabel}</span>
        <span className="sidebar-month-range">
          {row.periodStart} → {row.periodEnd}
        </span>
      </button>
      <button
        type="button"
        className="icon-btn small ghost"
        title="Change dates / rename this period"
        aria-label="Edit period"
        onClick={(e) => {
          e.stopPropagation();
          onEditDates();
        }}
      >
        <PencilIcon size={12} />
      </button>
    </li>
  );
}

function Sidebar({
  collapsed,
  onToggleCollapsed,
  workspaceMeta,
  isDefaultWorkspace,
  months,
  view,
  onShowOverview,
  onShowLibrary,
  onActivateMonth,
  onAddMonth,
  onDuplicateCurrentMonth,
  onEditPeriod,
  onRenameYear,
  hasWorkspace,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  workspaceMeta: WorkspaceMeta | null;
  isDefaultWorkspace: boolean;
  months: MonthRow[];
  view: AppView;
  onShowOverview: () => void;
  onShowLibrary: () => void;
  onActivateMonth: (id: number) => void;
  onAddMonth: () => void;
  onDuplicateCurrentMonth: () => void;
  onEditPeriod: (id: number) => void;
  onRenameYear: (next: string) => Promise<void>;
  hasWorkspace: boolean;
}) {
  if (collapsed) {
    return (
      <aside className="sidebar collapsed" aria-label="Workspace sidebar">
        <button
          type="button"
          className="sidebar-collapse-btn"
          onClick={onToggleCollapsed}
          title="Expand sidebar (⌘\\)"
          aria-label="Expand sidebar"
        >
          ›
        </button>
      </aside>
    );
  }

  const overviewActive = view.kind === "overview";
  const libraryActive = view.kind === "library";

  return (
    <aside className="sidebar" aria-label="Workspace sidebar">
      <div className="sidebar-top">
        <button
          type="button"
          className="sidebar-library-link"
          onClick={onShowLibrary}
          aria-pressed={libraryActive}
        >
          <FolderIcon /> All years…
        </button>
        <button
          type="button"
          className="sidebar-collapse-btn"
          onClick={onToggleCollapsed}
          title="Collapse sidebar (⌘\\)"
          aria-label="Collapse sidebar"
        >
          ‹
        </button>
      </div>

      {hasWorkspace && (
        <YearHeader
          meta={workspaceMeta}
          isDefaultWorkspace={isDefaultWorkspace}
          active={overviewActive}
          onActivate={onShowOverview}
          onRename={onRenameYear}
        />
      )}

      {hasWorkspace && (
        <div className="sidebar-section">
          <div className="sidebar-section-header">
            <ChevronIcon open />
            <span>Months</span>
          </div>
          <ul className="sidebar-month-list">
            {months.length === 0 && (
              <li className="sidebar-empty muted">No months yet — add one below.</li>
            )}
            {months.map((m) => (
              <MonthRowItem
                key={m.id}
                row={m}
                active={view.kind === "month" && view.monthId === m.id}
                onActivate={() => onActivateMonth(m.id)}
                onEditDates={() => onEditPeriod(m.id)}
              />
            ))}
          </ul>
          <div className="sidebar-section-actions">
            <button type="button" className="sidebar-action" onClick={onAddMonth}>
              <PlusIcon /> Add month
            </button>
            <button
              type="button"
              className="sidebar-action"
              onClick={onDuplicateCurrentMonth}
              disabled={view.kind !== "month"}
              title="Duplicate the active month (planned amounts only)"
            >
              Duplicate current
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}

function WelcomeScreen({
  defaultFolder,
  recentFiles,
  busy,
  onCreateYear,
  onOpenFile,
  onShowLibrary,
  onOpenRecent,
  onRevealFolder,
}: {
  defaultFolder: string | null;
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
        <h1>Welcome to Budget</h1>
        <p className="welcome-sub">
          Your `.budget` files live in <code>{defaultFolder ?? "~/Documents/Budget"}</code>.
          Each file holds one year of budgeting. Open or create one to begin.
        </p>
      </div>

      <div className="welcome-cards">
        <button
          type="button"
          className="welcome-card primary"
          onClick={onCreateYear}
          disabled={busy}
        >
          <span className="welcome-card-eyebrow">Start a new year</span>
          <span className="welcome-card-title">Create a year budget</span>
          <span className="welcome-card-sub">
            Picks a calendar year, scaffolds 12 months, and saves a fresh `.budget` file.
          </span>
        </button>
        <button
          type="button"
          className="welcome-card"
          onClick={onOpenFile}
          disabled={busy}
        >
          <span className="welcome-card-eyebrow">Have a file?</span>
          <span className="welcome-card-title">Open existing budget…</span>
          <span className="welcome-card-sub">Opens any .budget file in a new window.</span>
        </button>
        <button
          type="button"
          className="welcome-card"
          onClick={onShowLibrary}
          disabled={busy}
        >
          <span className="welcome-card-eyebrow">Browse</span>
          <span className="welcome-card-title">Library of years</span>
          <span className="welcome-card-sub">
            See every `.budget` file in your default folder, with summaries.
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
                  <span className="recent-name">{r.yearLabel || basename(r.path)}</span>
                  <span className="recent-path muted">{r.path}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function basename(path: string): string {
  const parts = path.split(/[/\\]/);
  const last = parts[parts.length - 1] ?? path;
  return last.replace(/\.budget$/i, "");
}

function LibraryView({
  entries,
  defaultFolder,
  busy,
  onRescan,
  onOpen,
  onCreateYear,
  onRevealFolder,
}: {
  entries: LibraryEntry[];
  defaultFolder: string | null;
  busy: boolean;
  onRescan: () => void;
  onOpen: (path: string) => void;
  onCreateYear: () => void;
  onRevealFolder: () => void;
}) {
  return (
    <div className="library-view">
      <header className="library-header">
        <div>
          <h1>Years library</h1>
          <p className="muted">
            From <code>{defaultFolder ?? "~/Documents/Budget"}</code>
          </p>
        </div>
        <div className="library-actions">
          <button type="button" className="btn secondary" onClick={onRevealFolder}>
            Show in Finder
          </button>
          <button type="button" className="btn secondary" onClick={onRescan} disabled={busy}>
            {busy ? "Scanning…" : "Rescan"}
          </button>
          <button type="button" className="btn primary" onClick={onCreateYear}>
            <PlusIcon /> New year budget
          </button>
        </div>
      </header>
      {entries.length === 0 ? (
        <div className="library-empty">
          <p>No `.budget` files found in your default folder yet.</p>
          <p className="muted">Create a new year, or open one from elsewhere.</p>
        </div>
      ) : (
        <ul className="library-grid">
          {entries.map((e) => (
            <li key={e.path}>
              <button
                type="button"
                className="library-card"
                onClick={() => onOpen(e.path)}
              >
                <div className="library-card-head">
                  <span className="library-card-year">{e.yearLabel || basename(e.path)}</span>
                  {e.encrypted && (
                    <span className="library-card-lock" title="Encrypted">
                      <LockIcon />
                    </span>
                  )}
                </div>
                <div className="library-card-meta muted">
                  Updated {formatRelative(e.lastModified)} · {e.monthCount} months
                </div>
                <div className="library-card-totals">
                  <div>
                    <span className="mini-label">Income</span>
                    <span className="num">{formatUsd(e.incomeActualCents, "rounded")}</span>
                  </div>
                  <div>
                    <span className="mini-label">Net spend</span>
                    <span className="num">{formatUsd(e.expenseNetActualCents, "rounded")}</span>
                  </div>
                  <div>
                    <span className="mini-label">Net</span>
                    <span className="num">{formatUsd(e.netActualCents, "rounded")}</span>
                  </div>
                </div>
                <div className="library-card-path muted" title={e.path}>
                  {e.path}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatRelative(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const now = Date.now();
  const diff = Math.max(0, now - t);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const days = Math.floor(hr / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.floor(days / 365);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

function YearOverviewView({
  overview,
  onActivateMonth,
}: {
  overview: YearOverview;
  onActivateMonth: (id: number) => void;
}) {
  const totalRows: { label: string; planned: number; actual: number }[] = [
    {
      label: "Income",
      planned: overview.incomePlannedCents,
      actual: overview.incomeActualCents,
    },
    {
      label: "Net expenses",
      planned: overview.expenseNetPlannedCents,
      actual: overview.expenseNetActualCents,
    },
    {
      label: "Net",
      planned: overview.netPlannedCents,
      actual: overview.netActualCents,
    },
  ];

  return (
    <div className="year-overview">
      <header className="year-overview-header">
        <h1>{overview.yearLabel || "Year overview"}</h1>
        <p className="muted">{overview.months.length} months tracked</p>
      </header>

      <section className="card">
        <h2>Year totals</h2>
        <div className="overview-totals">
          {totalRows.map((row) => (
            <div className="overview-total-card" key={row.label}>
              <div className="overview-total-label">{row.label}</div>
              <div className="overview-total-cols">
                <div>
                  <div className="mini-label">Planned</div>
                  <div className="num">{formatUsd(row.planned, "rounded")}</div>
                </div>
                <div>
                  <div className="mini-label">Actual</div>
                  <div className="num">{formatUsd(row.actual, "rounded")}</div>
                </div>
                <div>
                  <div className="mini-label">Difference</div>
                  <div
                    className={`num ${
                      row.label === "Income"
                        ? varianceClassIncome(row.actual - row.planned)
                        : row.label === "Net expenses"
                          ? varianceClassExpense(row.planned - row.actual)
                          : varianceClassExpense(row.actual - row.planned)
                    }`}
                  >
                    {formatUsd(
                      row.label === "Net expenses"
                        ? row.planned - row.actual
                        : row.actual - row.planned,
                      "rounded",
                    )}
                  </div>
                </div>
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

function ExternalRenameModal({
  info,
  onAcknowledge,
}: {
  info: ExternalRenameInfo | null;
  onAcknowledge: () => void;
}) {
  if (!info) return null;
  return (
    <div className="modal-backdrop" role="presentation">
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="external-rename-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="external-rename-title" className="modal-title">
          File was renamed outside the app
        </h2>
        <p className="modal-hint">
          The file on disk is named <code>{info.fileBasename}.budget</code>, but the workspace
          inside it is labeled <strong>{info.yearLabel || "(blank)"}</strong>. The app will
          adopt the new name.
        </p>
        <div className="modal-actions">
          <button type="button" className="btn primary" autoFocus onClick={onAcknowledge}>
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

function NewYearModal({
  open,
  defaultYear,
  onCancel,
  onCreate,
}: {
  open: boolean;
  defaultYear: number;
  onCancel: () => void;
  onCreate: (label: string, scaffoldYear: number) => void;
}) {
  const [label, setLabel] = useState(String(defaultYear));
  const [scaffold, setScaffold] = useState(true);
  useEffect(() => {
    if (open) {
      setLabel(String(defaultYear));
      setScaffold(true);
    }
  }, [open, defaultYear]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-year-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="new-year-title" className="modal-title">
          New year budget
        </h2>
        <p className="modal-hint">
          A `.budget` file will be created in your default folder. The label becomes the
          filename and shows up in the sidebar.
        </p>
        <div className="modal-fields">
          <label className="field-inline" style={{ flexDirection: "column", alignItems: "stretch" }}>
            <span className="label">Year label</span>
            <input
              className="input"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              autoFocus
              placeholder="e.g. 2026 or House fund 2026"
            />
          </label>
          <label className="field-inline" style={{ marginTop: 8 }}>
            <input
              type="checkbox"
              checked={scaffold}
              onChange={(e) => setScaffold(e.target.checked)}
            />
            <span className="label">Pre-populate Jan–Dec months</span>
          </label>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn secondary" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              const trimmed = label.trim();
              if (!trimmed) return;
              const yearMatch = /\b(19|20|21)\d{2}\b/.exec(trimmed);
              const yr = yearMatch ? Number(yearMatch[0]) : defaultYear;
              onCreate(trimmed, scaffold ? yr : 0);
            }}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

function MonthBudgetView({
  view,
  expandedIncome,
  expandedExpense,
  onToggleIncome,
  onToggleExpense,
  onRefresh,
  onAddRow,
  onRenameRow,
  onDeleteRow,
  onOpenReorder,
}: {
  view: MonthView;
  expandedIncome: Set<number>;
  expandedExpense: Set<number>;
  onToggleIncome: (id: number) => void;
  onToggleExpense: (id: number) => void;
  onRefresh: () => void;
  onAddRow: (bucketId: number) => void;
  onRenameRow: (lineId: number, name: string) => void;
  onDeleteRow: (lineId: number, name: string) => void;
  onOpenReorder: () => void;
}) {
  return (
    <>
      <header className="month-view-header">
        <h1>{view.tabLabel}</h1>
        <p className="muted">
          {view.periodStart} → {view.periodEnd}
        </p>
      </header>

      <section className="ytd-strip" aria-label="Year-to-date totals for the active month">
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
                onToggle={() => onToggleIncome(line.id)}
                onRefresh={onRefresh}
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
                  onToggle={() => onToggleExpense(line.id)}
                  onRefresh={onRefresh}
                  onRename={() => onRenameRow(line.id, line.name)}
                  onDelete={() => onDeleteRow(line.id, line.name)}
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

export default function App() {
  const [months, setMonths] = useState<MonthRow[]>([]);
  const [view, setView] = useState<AppView>({ kind: "welcome" });
  const [monthView, setMonthView] = useState<MonthView | null>(null);
  const [yearOverview, setYearOverview] = useState<YearOverview | null>(null);
  const [workspaceMeta, setWorkspaceMeta] = useState<WorkspaceMeta | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [libraryEntries, setLibraryEntries] = useState<LibraryEntry[]>([]);
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [externalRename, setExternalRename] = useState<ExternalRenameInfo | null>(null);
  const [newYearOpen, setNewYearOpen] = useState(false);
  const [isDefaultWorkspace, setIsDefaultWorkspace] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [expandedIncome, setExpandedIncome] = useState<Set<number>>(new Set());
  const [expandedExpense, setExpandedExpense] = useState<Set<number>>(new Set());
  const [dbPath, setDbPath] = useState<string>("");
  const [periodModal, setPeriodModal] = useState<PeriodModalConfig | null>(null);
  const [reorderModalOpen, setReorderModalOpen] = useState(false);
  const [autoSaveOn, setAutoSaveOn] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [unsavedPromptOpen, setUnsavedPromptOpen] = useState(false);
  const [unsavedBusy, setUnsavedBusy] = useState(false);

  const monthsRef = useRef<MonthRow[]>([]);
  const viewRef = useRef<AppView>(view);
  const monthViewRef = useRef<MonthView | null>(null);
  useEffect(() => {
    monthsRef.current = months;
  }, [months]);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);
  useEffect(() => {
    monthViewRef.current = monthView;
  }, [monthView]);

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

  const refreshMonthView = useCallback(async (monthId: number) => {
    setError(null);
    const v = await invoke<MonthView>("get_month_view", { monthId });
    setMonthView(v);
  }, []);

  const refreshOverview = useCallback(async () => {
    setError(null);
    const o = await invoke<YearOverview>("get_year_overview");
    setYearOverview(o);
  }, []);

  const refreshMonths = useCallback(async () => {
    const list = await invoke<MonthRow[]>("list_months");
    setMonths(list);
    return list;
  }, []);

  const refreshWorkspaceMeta = useCallback(async () => {
    try {
      const meta = await invoke<WorkspaceMeta>("get_workspace_meta");
      setWorkspaceMeta(meta);
      return meta;
    } catch {
      return null;
    }
  }, []);

  const refreshSettings = useCallback(async () => {
    const s = await invoke<AppSettings>("get_settings");
    setSettings(s);
    setSidebarCollapsed(Boolean(s.sidebarCollapsed));
    setRecentFiles(s.recentFiles ?? []);
    return s;
  }, []);

  const refreshLibrary = useCallback(async () => {
    try {
      const idx = await invoke<LibraryEntry[]>("get_library_index");
      setLibraryEntries(idx);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const rescanLibrary = useCallback(async () => {
    setBusy(true);
    try {
      const idx = await invoke<LibraryEntry[]>("scan_library");
      setLibraryEntries(idx);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const checkForExternalRename = useCallback(async () => {
    try {
      const info = await invoke<ExternalRenameInfo>("check_external_rename");
      if (!info.isDefaultWorkspace && !info.matches && info.fileBasename.trim() !== "") {
        setExternalRename(info);
      }
    } catch {
      // ignore — best effort
    }
  }, []);

  const bootstrap = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const path = await invoke<string>("get_database_path");
      setDbPath(path);
      const isDefault = await invoke<boolean>("is_default_workspace");
      setIsDefaultWorkspace(isDefault);

      const [list, meta, s] = await Promise.all([
        refreshMonths(),
        refreshWorkspaceMeta(),
        refreshSettings(),
      ]);
      const autoSave = await invoke<boolean>("get_auto_save");
      setAutoSaveOn(autoSave);
      void refreshLibrary();

      const hasYearLabel = !!meta?.yearLabel?.trim();
      const hasMonths = list.length > 0;
      const hasWorkspaceContent = !isDefault || hasYearLabel || hasMonths;

      if (!hasWorkspaceContent) {
        setView({ kind: "welcome" });
      } else {
        await refreshOverview();
        setView({ kind: "overview" });
      }

      // Settings result kept for parent state — value already applied via refresh.
      void s;
      await checkForExternalRename();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [
    refreshMonths,
    refreshWorkspaceMeta,
    refreshSettings,
    refreshOverview,
    refreshLibrary,
    checkForExternalRename,
  ]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  const activateMonth = useCallback(
    async (monthId: number) => {
      const current = viewRef.current;
      if (current.kind === "month" && current.monthId === monthId) return;
      setBusy(true);
      setError(null);
      try {
        flushSync(() => {
          setView({ kind: "month", monthId });
        });
        await refreshMonthView(monthId);
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
    },
    [refreshMonthView],
  );

  const cycleMonth = useCallback(
    (direction: 1 | -1) => {
      const list = monthsRef.current;
      if (list.length === 0) return;
      const current = viewRef.current;
      const sorted = [...list].sort((a, b) => a.periodStart.localeCompare(b.periodStart));
      const ids = sorted.map((m) => m.id);
      let idx = -1;
      if (current.kind === "month") {
        idx = ids.indexOf(current.monthId);
      }
      if (idx === -1) {
        void activateMonth(ids[direction === 1 ? 0 : ids.length - 1]);
        return;
      }
      const next = (idx + direction + ids.length) % ids.length;
      void activateMonth(ids[next]);
    },
    [activateMonth],
  );

  const showOverview = useCallback(async () => {
    setBusy(true);
    try {
      await refreshOverview();
      setView({ kind: "overview" });
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [refreshOverview]);

  const showLibrary = useCallback(async () => {
    setBusy(true);
    try {
      await refreshLibrary();
      setView({ kind: "library" });
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [refreshLibrary]);

  const onOpenFile = useCallback(async () => {
    try {
      const defaultDir = settings?.defaultFolder ?? undefined;
      const picked = await openDialog({
        multiple: false,
        directory: false,
        defaultPath: defaultDir,
        filters: [{ name: "Budget File", extensions: ["budget", "sqlite3", "db"] }],
      });
      const filePath = typeof picked === "string" ? picked : null;
      if (!filePath) return;
      await invoke("open_budget_in_new_window", { filePath });
      void refreshSettings();
    } catch (e) {
      setError(String(e));
    }
  }, [settings, refreshSettings]);

  const onSaveAs = useCallback(async (): Promise<boolean> => {
    try {
      const defaultDir = settings?.defaultFolder ?? undefined;
      const suggested = workspaceMeta?.yearLabel?.trim() || "budget";
      const target = await saveDialog({
        title: "Save budget as",
        defaultPath: defaultDir
          ? `${defaultDir}/${suggested}.budget`
          : `${suggested}.budget`,
        filters: [{ name: "Budget File", extensions: ["budget"] }],
      });
      if (!target) return false;
      await invoke("save_budget_as", { targetPath: target });
      const newPath = await invoke<string>("get_database_path");
      setDbPath(newPath);
      const isDefault = await invoke<boolean>("is_default_workspace");
      setIsDefaultWorkspace(isDefault);
      void refreshSettings();
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    }
  }, [settings, workspaceMeta, refreshSettings]);

  const onSave = useCallback(async () => {
    try {
      const isDefault = await invoke<boolean>("is_default_workspace");
      const wrote = isDefault ? await onSaveAs() : true;
      if (wrote) {
        setSavedFlash(true);
        window.setTimeout(() => setSavedFlash(false), 1500);
      }
    } catch (e) {
      setError(String(e));
    }
  }, [onSaveAs]);

  const onCreateYear = useCallback(() => {
    setNewYearOpen(true);
  }, []);

  const onCreateYearSubmit = useCallback(
    async (label: string, scaffoldYearValue: number) => {
      setNewYearOpen(false);
      setBusy(true);
      try {
        await invoke("create_year_workspace", {
          yearLabel: label,
          scaffoldYearValue: scaffoldYearValue || null,
        });
        void refreshSettings();
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
    },
    [refreshSettings],
  );

  const onRenameYear = useCallback(
    async (next: string) => {
      try {
        const newPath = await invoke<string>("set_workspace_year", { yearLabel: next });
        setDbPath(newPath);
        const isDefault = await invoke<boolean>("is_default_workspace");
        setIsDefaultWorkspace(isDefault);
        await refreshWorkspaceMeta();
        void refreshSettings();
      } catch (e) {
        setError(String(e));
      }
    },
    [refreshWorkspaceMeta, refreshSettings],
  );

  const onAcknowledgeRename = useCallback(async () => {
    if (!externalRename) return;
    const target = externalRename.fileBasename;
    setExternalRename(null);
    if (!target) return;
    try {
      await invoke<string>("set_workspace_year", { yearLabel: target });
      await refreshWorkspaceMeta();
    } catch (e) {
      setError(String(e));
    }
  }, [externalRename, refreshWorkspaceMeta]);

  const onToggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      void invoke("set_sidebar_collapsed", { collapsed: next }).catch(() => {});
      return next;
    });
  }, []);

  const onRevealFolder = useCallback(async () => {
    try {
      await invoke<string>("reveal_default_folder");
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const onOpenRecent = useCallback(async (path: string) => {
    try {
      await invoke("open_budget_in_new_window", { filePath: path });
      void refreshSettings();
    } catch (e) {
      setError(String(e));
    }
  }, [refreshSettings]);

  const onLibraryOpen = useCallback(
    async (path: string) => {
      try {
        await invoke("open_budget_in_new_window", { filePath: path });
        void refreshSettings();
      } catch (e) {
        setError(String(e));
      }
    },
    [refreshSettings],
  );

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    const win = getCurrentWindow();
    win
      .onCloseRequested(async (event) => {
        try {
          const isDefault = await invoke<boolean>("is_default_workspace");
          const dirty = await invoke<boolean>("is_dirty");
          if (!isDefault || !dirty) return;
          event.preventDefault();
          setUnsavedPromptOpen(true);
        } catch (err) {
          setError(String(err));
        }
      })
      .then((u) => {
        unlisten = u;
      });
    return () => {
      unlisten?.();
    };
  }, []);

  const closeAfterPrompt = useCallback(async () => {
    setUnsavedPromptOpen(false);
    try {
      await getCurrentWindow().destroy();
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const onUnsavedSave = useCallback(async () => {
    setUnsavedBusy(true);
    try {
      const wrote = await onSaveAs();
      if (wrote) {
        await closeAfterPrompt();
      }
    } finally {
      setUnsavedBusy(false);
    }
  }, [onSaveAs, closeAfterPrompt]);

  const onUnsavedDiscard = useCallback(async () => {
    await closeAfterPrompt();
  }, [closeAfterPrompt]);

  const onUnsavedCancel = useCallback(() => {
    setUnsavedPromptOpen(false);
  }, []);

  const onToggleAutoSave = useCallback(async () => {
    try {
      const next = !autoSaveOn;
      await invoke("set_auto_save", { enabled: next });
      setAutoSaveOn(next);
      if (next) {
        await invoke("save_snapshot");
      }
    } catch (e) {
      setError(String(e));
    }
  }, [autoSaveOn]);

  const openReorderModal = useCallback(() => {
    setReorderModalOpen(true);
  }, []);

  const openCreatePeriodModal = useCallback(() => {
    const list = monthsRef.current;
    const sorted = [...list].sort((a, b) => a.periodStart.localeCompare(b.periodStart));
    const last = sorted[sorted.length - 1];
    const { periodStart, periodEnd } = last
      ? nextFullMonthAfterPeriodEnd(last.periodEnd)
      : fullMonthBoundsFromYearMonth(currentYearMonth());
    setPeriodModal({
      intent: "create",
      title: "Add a budget month",
      confirmLabel: "Create",
      initialStart: periodStart,
      initialEnd: periodEnd,
    });
  }, []);

  const openDuplicatePeriodModal = useCallback(() => {
    const v = viewRef.current;
    const mv = monthViewRef.current;
    if (v.kind !== "month" || !mv) return;
    const { periodStart, periodEnd } = nextFullMonthAfterPeriodEnd(mv.periodEnd);
    setPeriodModal({
      intent: "duplicate",
      title: "Duplicate current month",
      confirmLabel: "Duplicate",
      initialStart: periodStart,
      initialEnd: periodEnd,
    });
  }, []);

  const openEditPeriodModal = useCallback((monthId: number) => {
    const row = monthsRef.current.find((m) => m.id === monthId);
    if (!row) return;
    setPeriodModal({
      intent: "edit",
      editMonthId: monthId,
      title: "Edit period dates",
      confirmLabel: "Save dates",
      initialStart: row.periodStart,
      initialEnd: row.periodEnd,
    });
  }, []);

  useEffect(() => {
    const unlisteners: UnlistenFn[] = [];
    const listenSafe = (name: string, fn: () => void) =>
      listen(name, fn).then((u) => unlisteners.push(u));
    void listenSafe("menu:next-month", () => cycleMonth(1));
    void listenSafe("menu:prev-month", () => cycleMonth(-1));
    void listenSafe("menu:open-file", () => void onOpenFile());
    void listenSafe("menu:new-year", () => onCreateYear());
    void listenSafe("menu:save", () => void onSave());
    void listenSafe("menu:save-as", () => void onSaveAs());
    void listenSafe("menu:toggle-autosave", () => void onToggleAutoSave());
    void listenSafe("menu:reorganize", () => openReorderModal());
    void listenSafe("menu:show-default-folder", () => void onRevealFolder());
    void listenSafe("menu:export-csv", () => void onExportCsv());
    void listenSafe("menu:export-json", () => void onExportJson());
    void listenSafe("menu:toggle-sidebar", () => onToggleSidebar());
    void listenSafe("menu:show-overview", () => void showOverview());
    void listenSafe("menu:show-library", () => void showLibrary());
    void listenSafe("menu:add-month", () => openCreatePeriodModal());
    void listenSafe("menu:duplicate-month", () => openDuplicatePeriodModal());
    return () => {
      unlisteners.forEach((u) => u());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    cycleMonth,
    onOpenFile,
    onCreateYear,
    onSave,
    onSaveAs,
    onToggleAutoSave,
    openReorderModal,
    onRevealFolder,
    onToggleSidebar,
    showOverview,
    showLibrary,
    openCreatePeriodModal,
    openDuplicatePeriodModal,
  ]);

  useEffect(() => {
    if (!autoSaveOn) return;
    const intervalMs = 5 * 60 * 1000;
    const id = window.setInterval(() => {
      void invoke("save_snapshot").catch(() => {});
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [autoSaveOn]);

  const activeMonthId = useCallback((): number | null => {
    const v = viewRef.current;
    return v.kind === "month" ? v.monthId : null;
  }, []);

  const reorderBuckets = useCallback(
    async (orderedIds: number[]) => {
      const mv = monthViewRef.current;
      const monthId = activeMonthId();
      if (!mv || monthId == null) return;
      const orderedBuckets = orderedIds
        .map((id) => mv.expenseBuckets.find((b) => b.id === id))
        .filter((b): b is ExpenseBucketDto => Boolean(b));
      flushSync(() => {
        setMonthView({ ...mv, expenseBuckets: orderedBuckets });
      });
      try {
        await invoke("reorder_buckets", { monthId, orderedIds });
      } catch (e) {
        setError(String(e));
        await refreshMonthView(monthId);
      }
    },
    [refreshMonthView, activeMonthId],
  );

  const onAddRow = useCallback(
    async (bucketId: number) => {
      const monthId = activeMonthId();
      if (monthId == null) return;
      const name = window.prompt("New budget row name:");
      if (name == null) return;
      const trimmed = name.trim();
      if (!trimmed) return;
      try {
        await invoke("add_expense_line", { bucketId, name: trimmed });
        await refreshMonthView(monthId);
      } catch (e) {
        setError(String(e));
      }
    },
    [refreshMonthView, activeMonthId],
  );

  const onRenameRow = useCallback(
    async (lineId: number, currentName: string) => {
      const monthId = activeMonthId();
      if (monthId == null) return;
      const name = window.prompt("Rename row:", currentName);
      if (name == null) return;
      const trimmed = name.trim();
      if (!trimmed || trimmed === currentName) return;
      try {
        await invoke("rename_expense_line", { id: lineId, name: trimmed });
        await refreshMonthView(monthId);
      } catch (e) {
        setError(String(e));
      }
    },
    [refreshMonthView, activeMonthId],
  );

  const onDeleteRow = useCallback(
    async (lineId: number, currentName: string) => {
      const monthId = activeMonthId();
      if (monthId == null) return;
      const ok = window.confirm(`Delete row "${currentName}" and all its transactions?`);
      if (!ok) return;
      try {
        await invoke("delete_expense_line", { id: lineId });
        await refreshMonthView(monthId);
      } catch (e) {
        setError(String(e));
      }
    },
    [refreshMonthView, activeMonthId],
  );

  const confirmPeriodModal = useCallback(
    async (start: string, end: string) => {
      if (!periodModal) return;
      const cfg = periodModal;
      setPeriodModal(null);
      setBusy(true);
      setError(null);
      try {
        if (cfg.intent === "create") {
          const newId = await invoke<number>("create_period", {
            periodStart: start,
            periodEnd: end,
          });
          await refreshMonths();
          flushSync(() => {
            setView({ kind: "month", monthId: newId });
          });
          await refreshMonthView(newId);
        } else if (cfg.intent === "duplicate") {
          const fromId = activeMonthId();
          if (fromId == null) return;
          const newId = await invoke<number>("duplicate_period", {
            fromMonthId: fromId,
            periodStart: start,
            periodEnd: end,
          });
          await refreshMonths();
          flushSync(() => {
            setView({ kind: "month", monthId: newId });
          });
          await refreshMonthView(newId);
        } else if (cfg.editMonthId != null) {
          await invoke("update_period_range", {
            monthId: cfg.editMonthId,
            periodStart: start,
            periodEnd: end,
          });
          await refreshMonths();
          const mid = activeMonthId();
          if (mid === cfg.editMonthId) {
            await refreshMonthView(cfg.editMonthId);
          }
        }
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
    },
    [periodModal, refreshMonths, refreshMonthView, activeMonthId],
  );

  const onExportCsv = useCallback(async () => {
    try {
      const csv = await invoke<string>("export_csv_data");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const label =
        (workspaceMeta?.yearLabel?.trim() || "budget").replace(/\s+/g, "_");
      a.download = `${label}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(String(e));
    }
  }, [workspaceMeta]);

  const onExportJson = useCallback(async () => {
    try {
      const json = await invoke<string>("export_workspace_json");
      const blob = new Blob([json], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const label =
        (workspaceMeta?.yearLabel?.trim() || "budget").replace(/\s+/g, "_");
      a.download = `${label}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(String(e));
    }
  }, [workspaceMeta]);

  if (loading) {
    return (
      <div className="app-shell">
        <p className="muted">Loading…</p>
      </div>
    );
  }

  return (
    <div className={`app-layout${sidebarCollapsed ? " sidebar-collapsed" : ""}`}>
      <PeriodRangeModal
        config={periodModal}
        onClose={() => setPeriodModal(null)}
        onConfirm={(s, e) => void confirmPeriodModal(s, e)}
      />
      <BucketReorderModal
        open={reorderModalOpen}
        buckets={monthView?.expenseBuckets ?? []}
        onClose={() => setReorderModalOpen(false)}
        onCommit={(ids) => void reorderBuckets(ids)}
      />
      <UnsavedChangesModal
        open={unsavedPromptOpen}
        busy={unsavedBusy}
        onSave={() => void onUnsavedSave()}
        onDiscard={() => void onUnsavedDiscard()}
        onCancel={onUnsavedCancel}
      />
      <NewYearModal
        open={newYearOpen}
        defaultYear={new Date().getFullYear()}
        onCancel={() => setNewYearOpen(false)}
        onCreate={(label, scaffold) => void onCreateYearSubmit(label, scaffold)}
      />
      <ExternalRenameModal
        info={externalRename}
        onAcknowledge={() => void onAcknowledgeRename()}
      />

      <Sidebar
        collapsed={sidebarCollapsed}
        onToggleCollapsed={onToggleSidebar}
        view={view}
        workspaceMeta={workspaceMeta}
        months={months}
        isDefaultWorkspace={isDefaultWorkspace}
        hasWorkspace={!isDefaultWorkspace || !!workspaceMeta?.yearLabel?.trim() || months.length > 0}
        onShowOverview={() => void showOverview()}
        onShowLibrary={() => void showLibrary()}
        onActivateMonth={(id) => void activateMonth(id)}
        onAddMonth={openCreatePeriodModal}
        onDuplicateCurrentMonth={openDuplicatePeriodModal}
        onEditPeriod={openEditPeriodModal}
        onRenameYear={onRenameYear}
      />

      <div className="app-main">
        <header className="top-bar">
          <button
            type="button"
            className="btn ghost sidebar-toggle-btn"
            onClick={onToggleSidebar}
            title="Toggle sidebar (⌘\\)"
            aria-label="Toggle sidebar"
          >
            <ChevronIcon open={!sidebarCollapsed} />
          </button>
          <div className="brand">
            <span className="brand-mark">◆</span>
            <span>Budget</span>
            {workspaceMeta?.yearLabel && (
              <span className="brand-year" title="Current year workspace">
                {workspaceMeta.yearLabel}
              </span>
            )}
          </div>
          <div className="top-bar-spacer" />
          <button
            type="button"
            className="btn ghost"
            onClick={() => void showOverview()}
            title="Year overview"
          >
            Overview
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={() => void showLibrary()}
            title="Browse all years"
          >
            Library
          </button>
          <button
            type="button"
            className="btn secondary"
            onClick={() => void onOpenFile()}
            title="Open a saved budget file (⌘O)"
          >
            Open…
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => void onSave()}
            title="Save changes (⌘S)"
          >
            Save
          </button>
          <button
            type="button"
            className="btn secondary"
            onClick={() => void onSaveAs()}
            title="Save as… (⇧⌘S)"
          >
            Save as…
          </button>
          {savedFlash && (
            <span className="saved-flash" role="status" aria-live="polite">
              Saved
            </span>
          )}
          <label
            className="field-inline auto-save-toggle"
            title="Saves a snapshot every 5 minutes"
          >
            <input
              type="checkbox"
              checked={autoSaveOn}
              onChange={() => void onToggleAutoSave()}
              aria-label="Toggle auto-save"
            />
            <span className="label">Auto-save</span>
          </label>
        </header>

        {error && (
          <div className="banner error" role="alert">
            {error}
          </div>
        )}

        {busy && <div className="busy-strip muted">Working…</div>}

        <main className="app-content">
          {view.kind === "welcome" && (
            <WelcomeScreen
              recentFiles={recentFiles}
              busy={busy}
              onCreateYear={onCreateYear}
              onOpenFile={() => void onOpenFile()}
              onOpenRecent={(p) => void onOpenRecent(p)}
              onShowLibrary={() => void showLibrary()}
              defaultFolder={settings?.defaultFolder ?? null}
              onRevealFolder={() => void onRevealFolder()}
            />
          )}

          {view.kind === "library" && (
            <LibraryView
              entries={libraryEntries}
              busy={busy}
              onOpen={(p) => void onLibraryOpen(p)}
              onRescan={() => void rescanLibrary()}
              onRevealFolder={() => void onRevealFolder()}
              onCreateYear={onCreateYear}
              defaultFolder={settings?.defaultFolder ?? null}
            />
          )}

          {view.kind === "overview" && yearOverview && (
            <>
              <div className="overview-toolbar">
                <button type="button" className="btn ghost" onClick={() => void onExportCsv()}>
                  Export CSV
                </button>
                <button type="button" className="btn ghost" onClick={() => void onExportJson()}>
                  Export JSON
                </button>
                <button
                  type="button"
                  className="btn secondary"
                  onClick={openCreatePeriodModal}
                >
                  <PlusIcon /> Add month
                </button>
              </div>
              <YearOverviewView
                overview={yearOverview}
                onActivateMonth={(id) => void activateMonth(id)}
              />
            </>
          )}

          {view.kind === "overview" && !yearOverview && (
            <p className="muted month-loading-banner">Loading overview…</p>
          )}

          {view.kind === "month" && monthView && monthView.monthId === view.monthId && (
            <MonthBudgetView
              view={monthView}
              expandedIncome={expandedIncome}
              expandedExpense={expandedExpense}
              onToggleIncome={toggleIncome}
              onToggleExpense={toggleExpense}
              onRefresh={() => {
                if (view.kind === "month") void refreshMonthView(view.monthId);
              }}
              onAddRow={onAddRow}
              onRenameRow={onRenameRow}
              onDeleteRow={onDeleteRow}
              onOpenReorder={openReorderModal}
            />
          )}

          {view.kind === "month" && (!monthView || monthView.monthId !== view.monthId) && (
            <p className="muted month-loading-banner">Loading month…</p>
          )}
        </main>

        <footer className="footer muted">
          <span>Data file: {dbPath || "—"}</span>
        </footer>
      </div>
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
          <PlannedAmountInput
            value={planned}
            onChange={setPlanned}
            onBlur={() => void savePlanned()}
          />
        </td>
        <td className="num">{formatUsd(line.actualCents, "rounded")}</td>
        <td className={`num ${varianceClassIncome(line.varianceCents)}`}>
          {formatUsd(line.varianceCents, "rounded")}
        </td>
        <td className="actions">
          <div className="row-icon-actions">
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
          onFocus={selectAllOnFocus}
        />
        <input
          className="input"
          placeholder="Amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onFocus={selectAllOnFocus}
        />
        <DateField value={date} onChange={setDate} ariaLabel="Received on" />
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
  onRename,
  onDelete,
}: {
  line: ExpenseLineDto;
  expanded: boolean;
  onToggle: () => void;
  onRefresh: () => void;
  onRename?: () => void;
  onDelete?: () => void;
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
          <PlannedAmountInput
            value={planned}
            onChange={setPlanned}
            onBlur={() => void savePlanned()}
          />
        </td>
        <td className="num">{formatUsd(line.rolloverInCents, "rounded")}</td>
        <td className="num">{formatUsd(line.actualCents, "rounded")}</td>
        <td className={`num ${varianceClassExpense(line.varianceCents)}`}>
          {formatUsd(line.varianceCents, "rounded")}
        </td>
        <td className="actions">
          <div className="row-icon-actions">
            <IconButton
              label={expanded ? "Hide transactions" : "Show transactions"}
              onClick={onToggle}
              active={expanded}
            >
              <ListIcon />
            </IconButton>
            {onRename && (
              <IconButton label="Rename row" onClick={onRename}>
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
          onFocus={selectAllOnFocus}
        />
        <input
          className="input"
          placeholder="Amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onFocus={selectAllOnFocus}
        />
        <DateField value={date} onChange={setDate} ariaLabel="Occurred on" />
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
