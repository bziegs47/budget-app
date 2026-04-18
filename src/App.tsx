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
import type { ExpenseBucketDto, ExpenseLineDto, IncomeLineDto, MonthRow, MonthView } from "./types";
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

export default function App() {
  const [months, setMonths] = useState<MonthRow[]>([]);
  const [activeMonthId, setActiveMonthId] = useState(0);
  /** Open tabs (browser-style); order is left-to-right — budget month ids */
  const [openTabs, setOpenTabs] = useState<number[]>([]);
  const [view, setView] = useState<MonthView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedIncome, setExpandedIncome] = useState<Set<number>>(new Set());
  const [expandedExpense, setExpandedExpense] = useState<Set<number>>(new Set());
  const [dbPath, setDbPath] = useState<string>("");
  const [periodModal, setPeriodModal] = useState<PeriodModalConfig | null>(null);
  const [reorderModalOpen, setReorderModalOpen] = useState(false);
  const [autoSaveOn, setAutoSaveOn] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [unsavedPromptOpen, setUnsavedPromptOpen] = useState(false);
  const [unsavedBusy, setUnsavedBusy] = useState(false);

  const openTabsRef = useRef<number[]>([]);
  const activeMonthIdRef = useRef<number>(0);
  const viewRef = useRef<MonthView | null>(null);
  useEffect(() => {
    openTabsRef.current = openTabs;
  }, [openTabs]);
  useEffect(() => {
    activeMonthIdRef.current = activeMonthId;
  }, [activeMonthId]);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

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

  const refresh = useCallback(async (monthId: number) => {
    setError(null);
    const v = await invoke<MonthView>("get_month_view", { monthId });
    setView(v);
  }, []);

  const bootstrap = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const path = await invoke<string>("get_database_path");
      setDbPath(path);
      const ym = currentYearMonth();
      const monthId = await invoke<number>("ensure_month", { yearMonth: ym });
      const list = await invoke<MonthRow[]>("list_months");
      setMonths(list);
      setActiveMonthId(monthId);
      setOpenTabs([monthId]);
      await refresh(monthId);
      const autoSave = await invoke<boolean>("get_auto_save");
      setAutoSaveOn(autoSave);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [refresh]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  /** Month dropdown: open month in a new tab if needed, then show it */
  const onMonthDropdownChange = async (idStr: string) => {
    const id = Number(idStr);
    setLoading(true);
    setError(null);
    try {
      flushSync(() => {
        setOpenTabs((prev) => (prev.includes(id) ? prev : [...prev, id]));
        setActiveMonthId(id);
      });
      await refresh(id);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const activateTab = useCallback(
    async (monthId: number) => {
      if (monthId === activeMonthIdRef.current) return;
      setLoading(true);
      setError(null);
      try {
        flushSync(() => {
          setActiveMonthId(monthId);
        });
        await refresh(monthId);
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    },
    [refresh],
  );

  const cycleTab = useCallback(
    (direction: 1 | -1) => {
      const tabs = openTabsRef.current;
      if (tabs.length < 2) return;
      const current = activeMonthIdRef.current;
      const idx = tabs.indexOf(current);
      if (idx === -1) return;
      const nextIdx = (idx + direction + tabs.length) % tabs.length;
      void activateTab(tabs[nextIdx]);
    },
    [activateTab],
  );

  const onOpenFile = useCallback(async () => {
    try {
      const picked = await openDialog({
        multiple: false,
        directory: false,
        filters: [{ name: "Budget File", extensions: ["budget", "sqlite3", "db"] }],
      });
      const filePath = typeof picked === "string" ? picked : null;
      if (!filePath) return;
      await invoke("open_budget_in_new_window", { filePath });
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const onSaveAs = useCallback(async (): Promise<boolean> => {
    try {
      const target = await saveDialog({
        title: "Save budget as",
        defaultPath: "budget.budget",
        filters: [{ name: "Budget File", extensions: ["budget"] }],
      });
      if (!target) return false;
      await invoke("save_budget_as", { targetPath: target });
      const newPath = await invoke<string>("get_database_path");
      setDbPath(newPath);
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    }
  }, []);

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

  useEffect(() => {
    const unlisteners: UnlistenFn[] = [];
    void listen("menu:next-tab", () => cycleTab(1)).then((u) => unlisteners.push(u));
    void listen("menu:prev-tab", () => cycleTab(-1)).then((u) => unlisteners.push(u));
    void listen("menu:open-file", () => void onOpenFile()).then((u) => unlisteners.push(u));
    void listen("menu:save", () => void onSave()).then((u) => unlisteners.push(u));
    void listen("menu:save-as", () => void onSaveAs()).then((u) => unlisteners.push(u));
    void listen("menu:toggle-autosave", () => void onToggleAutoSave()).then((u) =>
      unlisteners.push(u),
    );
    void listen("menu:reorganize", () => openReorderModal()).then((u) => unlisteners.push(u));
    return () => {
      unlisteners.forEach((u) => u());
    };
  }, [cycleTab, onOpenFile, onSave, onSaveAs, onToggleAutoSave, openReorderModal]);

  useEffect(() => {
    if (!autoSaveOn) return;
    const intervalMs = 5 * 60 * 1000;
    const id = window.setInterval(() => {
      void invoke("save_snapshot").catch(() => {});
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [autoSaveOn]);

  const reorderBuckets = useCallback(
    async (orderedIds: number[]) => {
      const v = viewRef.current;
      if (!v) return;
      const orderedBuckets = orderedIds
        .map((id) => v.expenseBuckets.find((b) => b.id === id))
        .filter((b): b is ExpenseBucketDto => Boolean(b));
      flushSync(() => {
        setView({ ...v, expenseBuckets: orderedBuckets });
      });
      try {
        await invoke("reorder_buckets", {
          monthId: activeMonthIdRef.current,
          orderedIds,
        });
      } catch (e) {
        setError(String(e));
        await refresh(activeMonthIdRef.current);
      }
    },
    [refresh],
  );

  const onAddRow = useCallback(
    async (bucketId: number) => {
      const name = window.prompt("New budget row name:");
      if (name == null) return;
      const trimmed = name.trim();
      if (!trimmed) return;
      try {
        await invoke("add_expense_line", { bucketId, name: trimmed });
        await refresh(activeMonthIdRef.current);
      } catch (e) {
        setError(String(e));
      }
    },
    [refresh],
  );

  const onRenameRow = useCallback(
    async (lineId: number, currentName: string) => {
      const name = window.prompt("Rename row:", currentName);
      if (name == null) return;
      const trimmed = name.trim();
      if (!trimmed || trimmed === currentName) return;
      try {
        await invoke("rename_expense_line", { id: lineId, name: trimmed });
        await refresh(activeMonthIdRef.current);
      } catch (e) {
        setError(String(e));
      }
    },
    [refresh],
  );

  const onDeleteRow = useCallback(
    async (lineId: number, currentName: string) => {
      const ok = window.confirm(`Delete row "${currentName}" and all its transactions?`);
      if (!ok) return;
      try {
        await invoke("delete_expense_line", { id: lineId });
        await refresh(activeMonthIdRef.current);
      } catch (e) {
        setError(String(e));
      }
    },
    [refresh],
  );

  const closeTab = async (monthId: number) => {
    if (openTabs.length <= 1) return;
    const idx = openTabs.indexOf(monthId);
    const newTabs = openTabs.filter((x) => x !== monthId);
    const neighbor = openTabs[idx - 1] ?? openTabs[idx + 1] ?? newTabs[newTabs.length - 1];
    if (monthId !== activeMonthId) {
      setOpenTabs(newTabs);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      flushSync(() => {
        setOpenTabs(newTabs);
        setActiveMonthId(neighbor);
      });
      await refresh(neighbor);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const openCreatePeriodModal = () => {
    const { periodStart, periodEnd } = fullMonthBoundsFromYearMonth(currentYearMonth());
    setPeriodModal({
      intent: "create",
      title: "New budget period",
      confirmLabel: "Create",
      initialStart: periodStart,
      initialEnd: periodEnd,
    });
  };

  const openDuplicatePeriodModal = () => {
    if (!view) return;
    const { periodStart, periodEnd } = nextFullMonthAfterPeriodEnd(view.periodEnd);
    setPeriodModal({
      intent: "duplicate",
      title: "Duplicate budget period",
      confirmLabel: "Duplicate",
      initialStart: periodStart,
      initialEnd: periodEnd,
    });
  };

  const openEditPeriodModal = (monthId: number) => {
    const row = months.find((m) => m.id === monthId);
    if (!row) return;
    setPeriodModal({
      intent: "edit",
      editMonthId: monthId,
      title: "Budget period for this tab",
      confirmLabel: "Save dates",
      initialStart: row.periodStart,
      initialEnd: row.periodEnd,
    });
  };

  const confirmPeriodModal = async (start: string, end: string) => {
    if (!periodModal) return;
    const cfg = periodModal;
    setPeriodModal(null);
    setLoading(true);
    setError(null);
    try {
      if (cfg.intent === "create") {
        const newId = await invoke<number>("create_period", { periodStart: start, periodEnd: end });
        const list = await invoke<MonthRow[]>("list_months");
        flushSync(() => {
          setMonths(list);
          setOpenTabs((prev) => (prev.includes(newId) ? prev : [...prev, newId]));
          setActiveMonthId(newId);
        });
        await refresh(newId);
      } else if (cfg.intent === "duplicate") {
        const newId = await invoke<number>("duplicate_period", {
          fromMonthId: activeMonthId,
          periodStart: start,
          periodEnd: end,
        });
        const list = await invoke<MonthRow[]>("list_months");
        flushSync(() => {
          setMonths(list);
          setOpenTabs((prev) => (prev.includes(newId) ? prev : [...prev, newId]));
          setActiveMonthId(newId);
        });
        await refresh(newId);
      } else {
        await invoke("update_period_range", {
          monthId: cfg.editMonthId!,
          periodStart: start,
          periodEnd: end,
        });
        const list = await invoke<MonthRow[]>("list_months");
        setMonths(list);
        if (cfg.editMonthId === activeMonthId) {
          await refresh(activeMonthId);
        }
      }
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
    const label = view?.tabLabel?.replace(/\s+/g, "_") ?? String(activeMonthId);
    a.download = `budget-export-${label}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const monthOptions = useMemo(
    () => [...months].sort((a, b) => a.periodStart.localeCompare(b.periodStart)),
    [months],
  );

  const monthSelectValue =
    monthOptions.some((m) => m.id === activeMonthId) && monthOptions.length > 0
      ? String(activeMonthId)
      : String(monthOptions[0]?.id ?? activeMonthId);

  if (loading && !view) {
    return (
      <div className="app-shell">
        <p className="muted">Loading…</p>
      </div>
    );
  }

  const tabLabelFor = (id: number) => months.find((m) => m.id === id)?.tabLabel ?? `#${id}`;

  return (
    <div className="app-shell">
      <PeriodRangeModal
        config={periodModal}
        onClose={() => setPeriodModal(null)}
        onConfirm={(s, e) => void confirmPeriodModal(s, e)}
      />
      <BucketReorderModal
        open={reorderModalOpen}
        buckets={view?.expenseBuckets ?? []}
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
      <header className="top-bar">
        <div className="brand">
          <span className="brand-mark">◆</span>
          <span>Budget</span>
        </div>
        <label className="field-inline month-dropdown-label">
          <span className="label">Month</span>
          <select
            value={monthSelectValue}
            onChange={(e) => void onMonthDropdownChange(e.target.value)}
            className="select month-dropdown"
            aria-label="Open or switch month (adds a tab if not already open)"
          >
            {monthOptions.map((m) => (
              <option key={m.id} value={String(m.id)}>
                {m.tabLabel}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn secondary" onClick={() => openCreatePeriodModal()}>
          Open / create
        </button>
        <button type="button" className="btn secondary" onClick={() => openDuplicatePeriodModal()}>
          Duplicate month
        </button>
        <button type="button" className="btn primary" onClick={() => void onExport()}>
          Export CSV
        </button>
        <div className="top-bar-spacer" />
        <button
          type="button"
          className="btn secondary"
          onClick={() => void onOpenFile()}
          title="Open a saved budget file in a new window (⌘O)"
        >
          Open file…
        </button>
        <button
          type="button"
          className="btn primary"
          onClick={() => void onSave()}
          title="Save changes to the current budget file (⌘S)"
        >
          Save
        </button>
        <button
          type="button"
          className="btn secondary"
          onClick={() => void onSaveAs()}
          title="Save the current budget to a new file (⇧⌘S)"
        >
          Save as…
        </button>
        {savedFlash && (
          <span className="saved-flash" role="status" aria-live="polite">
            Saved
          </span>
        )}
        <label className="field-inline auto-save-toggle" title="Saves a snapshot every 5 minutes">
          <input
            type="checkbox"
            checked={autoSaveOn}
            onChange={() => void onToggleAutoSave()}
            aria-label="Toggle auto-save"
          />
          <span className="label">Auto-save</span>
        </label>
      </header>

      <section className="ytd-strip ytd-strip-global" aria-label="Year-to-date totals for the active month">
        {view && view.monthId === activeMonthId ? (
          <>
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
          </>
        ) : (
          <div className="ytd-strip-placeholder">
            <span className="muted">Loading year-to-date…</span>
          </div>
        )}
      </section>

      <div className="tab-strip-container" role="tablist" aria-label="Open month tabs">
        <div className="tab-strip">
          {openTabs.map((tid) => (
            <div
              key={tid}
              className={`tab-chip ${tid === activeMonthId ? "tab-chip-active" : ""}`}
              role="presentation"
            >
              <button
                type="button"
                role="tab"
                id={`tab-${tid}`}
                aria-selected={tid === activeMonthId}
                className="tab-chip-main"
                title="Double-click to change this tab’s date range"
                onClick={() => void activateTab(tid)}
                onDoubleClick={(e) => {
                  e.preventDefault();
                  openEditPeriodModal(tid);
                }}
              >
                {tabLabelFor(tid)}
              </button>
              {openTabs.length > 1 && (
                <button
                  type="button"
                  className="tab-chip-close"
                  title={`Close ${tabLabelFor(tid)}`}
                  aria-label={`Close tab ${tabLabelFor(tid)}`}
                  onClick={() => void closeTab(tid)}
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {error && (
        <div className="banner error" role="alert">
          {error}
        </div>
      )}

      {loading && view && view.monthId !== activeMonthId && (
        <p className="muted month-loading-banner">Loading month…</p>
      )}

      {view && view.monthId === activeMonthId && (
        <>
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
                    onRefresh={() => void refresh(activeMonthId)}
                  />
                ))}
              </tbody>
            </table>
          </section>

          <div className="buckets-toolbar">
            <button
              type="button"
              className="btn secondary"
              onClick={() => openReorderModal()}
              title="Open the bucket reorder window (⌘R)"
            >
              Reorganize
            </button>
          </div>
          {view.expenseBuckets.map((bucket) => {
            return (
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
                        onRefresh={() => void refresh(activeMonthId)}
                        onRename={() => void onRenameRow(line.id, line.name)}
                        onDelete={() => void onDeleteRow(line.id, line.name)}
                      />
                    ))}
                  </tbody>
                </table>
                <div className="bucket-footer">
                  <button
                    type="button"
                    className="btn-link"
                    onClick={() => void onAddRow(bucket.id)}
                  >
                    + Add row
                  </button>
                </div>
              </section>
            );
          })}
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
