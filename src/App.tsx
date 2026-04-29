import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import type {
  AppSettings,
  AppView,
  CrossYearOverview,
  DuplicateYearArgs,
  ExpenseBucketDto,
  ExpenseLineDto,
  LibraryEntry,
  LineCalendarReport,
  MonthRow,
  MonthView,
  RecentFile,
  ReportsViewSeed,
  WorkspaceMeta,
  YearOverview,
  YearRow,
} from "./types";
import { ExportPickerButton, SaveStatusPill } from "./components/primitives";
import { BucketReorderModal } from "./components/modals/BucketReorderModal";
import { UnsavedChangesModal } from "./components/modals/UnsavedChangesModal";
import { ConfirmDeleteRowModal } from "./components/modals/ConfirmDeleteRowModal";
import { OpenInWindowModal } from "./components/modals/OpenInWindowModal";
import {
  ExpenseLineEditModal,
  type ExpenseLineEditConfig,
} from "./components/modals/ExpenseLineEditModal";
import { PasswordModal, type PasswordModalKind } from "./components/modals/PasswordModal";
import { PreferencesModal } from "./components/modals/PreferencesModal";
import { CreateYearModal } from "./components/modals/CreateYearModal";
import { RenameYearModal } from "./components/modals/RenameYearModal";
import { DeleteYearConfirmModal } from "./components/modals/DeleteYearConfirmModal";
import { RenameWorkspaceModal } from "./components/modals/RenameWorkspaceModal";
import { DeleteWorkspaceConfirmModal } from "./components/modals/DeleteWorkspaceConfirmModal";
import { DuplicateYearModal } from "./components/modals/DuplicateYearModal";
import { Sidebar } from "./components/sidebar/Sidebar";
import {
  WelcomeScreen,
  BudgetDashboard,
  LibraryView,
  YearOverviewView,
  CrossYearView,
  YtdSlideOver,
  ReportsView,
  MonthBudgetView,
  basename,
  formatRelative,
} from "./views";
import "./App.css";

function basenameNoExt(path: string): string {
  if (!path) return "";
  const lastSlash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const file = lastSlash >= 0 ? path.slice(lastSlash + 1) : path;
  const dot = file.lastIndexOf(".");
  return dot > 0 ? file.slice(0, dot) : file;
}

// Mirror a piece of state into a ref so async callbacks (menu
// listeners, IPC subscribers, autosave timers) can read the latest
// value without re-binding when the state changes. Replaces the
// useRef + useEffect boilerplate at every call site.
function useSyncedRef<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}

export default function App() {
  const [months, setMonths] = useState<MonthRow[]>([]);
  const [years, setYears] = useState<YearRow[]>([]);
  const [sidebarYearId, setSidebarYearId] = useState<number | null>(null);
  const [view, setView] = useState<AppView>({ kind: "welcome" });
  const [monthView, setMonthView] = useState<MonthView | null>(null);
  const [yearOverview, setYearOverview] = useState<YearOverview | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [libraryEntries, setLibraryEntries] = useState<LibraryEntry[]>([]);
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [createYearOpen, setCreateYearOpen] = useState(false);
  const [createYearMode, setCreateYearMode] = useState<"budget" | "year">("year");
  const [createYearBusy, setCreateYearBusy] = useState(false);
  const [renameYearTarget, setRenameYearTarget] = useState<YearRow | null>(null);
  const [renameYearBusy, setRenameYearBusy] = useState(false);
  const [deleteYearTarget, setDeleteYearTarget] = useState<YearRow | null>(null);
  const [deleteYearBusy, setDeleteYearBusy] = useState(false);
  const [duplicateYearTarget, setDuplicateYearTarget] = useState<YearRow | null>(null);
  const [duplicateYearBusy, setDuplicateYearBusy] = useState(false);
  const [duplicateYearMonths, setDuplicateYearMonths] = useState<MonthRow[]>([]);
  const [renameWorkspaceTarget, setRenameWorkspaceTarget] = useState<LibraryEntry | null>(
    null,
  );
  const [renameWorkspaceBusy, setRenameWorkspaceBusy] = useState(false);
  const [deleteWorkspaceTarget, setDeleteWorkspaceTarget] = useState<LibraryEntry | null>(
    null,
  );
  const [deleteWorkspaceBusy, setDeleteWorkspaceBusy] = useState(false);
  // When the user picks a tile in the library while a real budget is
  // already open, we ask whether to take over this window or open the
  // tile in a new one. `null` = no prompt; otherwise it carries the
  // pending file path so the choice handler knows what to launch.
  const [libraryOpenChoice, setLibraryOpenChoice] = useState<{ path: string } | null>(null);
  const [isDefaultWorkspace, setIsDefaultWorkspace] = useState(true);
  const [workspaceMeta, setWorkspaceMeta] = useState<WorkspaceMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [expandedIncome, setExpandedIncome] = useState<Set<number>>(new Set());
  const [expandedExpense, setExpandedExpense] = useState<Set<number>>(new Set());
  const [dbPath, setDbPath] = useState<string>("");
  const [reorderModalOpen, setReorderModalOpen] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [passwordModal, setPasswordModal] = useState<PasswordModalKind | null>(
    null,
  );
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [encryptionAvailable, setEncryptionAvailable] = useState(false);
  const [workspaceEncrypted, setWorkspaceEncrypted] = useState(false);
  const encryptionAvailableRef = useRef(false);
  const workspaceEncryptedRef = useRef(false);
  useEffect(() => {
    encryptionAvailableRef.current = encryptionAvailable;
  }, [encryptionAvailable]);
  useEffect(() => {
    workspaceEncryptedRef.current = workspaceEncrypted;
  }, [workspaceEncrypted]);
  const [autoSaveOn, setAutoSaveOn] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [snapshotState, setSnapshotState] = useState<{
    busy: boolean;
    lastAt: number | null;
  }>({ busy: false, lastAt: null });
  const [saveToast, setSaveToast] = useState<string | null>(null);
  const [unsavedPromptOpen, setUnsavedPromptOpen] = useState(false);
  const [unsavedBusy, setUnsavedBusy] = useState(false);
  const [lineEditConfig, setLineEditConfig] = useState<ExpenseLineEditConfig | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{
    lineId: number;
    name: string;
  } | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [ytdDrawer, setYtdDrawer] = useState<{
    lineKind: "income" | "expense";
    lineIdentity: string;
    year: number;
    asOf: string | null;
  } | null>(null);
  const [ytdReport, setYtdReport] = useState<LineCalendarReport | null>(null);
  const [ytdLoading, setYtdLoading] = useState(false);
  const [reportsInitial, setReportsInitial] = useState<ReportsViewSeed | null>(null);
  const [crossYear, setCrossYear] = useState<CrossYearOverview | null>(null);
  const [crossYearLoading, setCrossYearLoading] = useState(false);
  // Loading flag for the years-landing dashboard's snapshot card
  // (separate from yearOverview so the snapshot fetch doesn't blank
  // the year-overview screen when the user toggles between views).
  const [dashboardSnapshotLoading, setDashboardSnapshotLoading] =
    useState(false);
  // User-driven year override for the dashboard snapshot. null means
  // "follow the default" (calendar year if present, else most recent),
  // computed below as `dashboardCurrentYearId`. Clicking a year card on
  // the dashboard sets this; entering the dashboard view resets it so
  // re-entry always lands on the default year.
  const [dashboardSelectedYearId, setDashboardSelectedYearId] = useState<
    number | null
  >(null);

  // Launcher views are the home screen and the library browser. They
  // exist outside of any specific budget — no DB connection, no
  // dirty-tracking, no autosave, no save pill, no in-budget chrome.
  // Computed eagerly so effects below can depend on it without
  // forward-references.
  const isLauncherView = view.kind === "welcome" || view.kind === "library";

  const monthsRef = useSyncedRef(months);
  const viewRef = useSyncedRef(view);
  const monthViewRef = useSyncedRef(monthView);
  const sidebarYearIdRef = useSyncedRef(sidebarYearId);
  const yearsRef = useSyncedRef(years);

  useEffect(() => {
    if (!ytdDrawer) {
      setYtdReport(null);
      return;
    }
    let cancelled = false;
    setYtdLoading(true);
    void invoke<LineCalendarReport>("get_line_calendar_report", {
      year: ytdDrawer.year,
      lineKind: ytdDrawer.lineKind,
      lineIdentity: ytdDrawer.lineIdentity,
      asOf: ytdDrawer.asOf,
    })
      .then((r) => {
        if (!cancelled) setYtdReport(r);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setYtdLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ytdDrawer]);

  // Keep the OS title bar empty. The active budget is shown by the
  // in-app sidebar chip; mimicking Finder / Notes / Reminders, the
  // window chrome stays untitled. We still actively set "" here so any
  // stale title from a prior session or backend call is cleared.
  useEffect(() => {
    if (loading) return;
    void getCurrentWindow().setTitle("");
  }, [loading]);

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

  useEffect(() => {
    setExpandedIncome(new Set());
    setExpandedExpense(new Set());
  }, [view]);

  const refreshMonthView = useCallback(async (monthId: number) => {
    setError(null);
    const v = await invoke<MonthView>("get_month_view", { monthId });
    setMonthView(v);
  }, []);

  const refreshOverview = useCallback(async (yearId?: number | null) => {
    setError(null);
    const target = yearId === undefined ? sidebarYearIdRef.current : yearId;
    const o = await invoke<YearOverview>("get_year_overview", { yearId: target ?? null });
    setYearOverview(o);
  }, []);

  const refreshMonths = useCallback(async (yearId?: number | null) => {
    const target = yearId === undefined ? sidebarYearIdRef.current : yearId;
    let list: MonthRow[];
    if (target != null) {
      list = await invoke<MonthRow[]>("list_months_for_year", { yearId: target });
    } else {
      list = await invoke<MonthRow[]>("list_months");
    }
    setMonths(list);
    return list;
  }, []);

  const refreshYears = useCallback(async () => {
    const list = await invoke<YearRow[]>("list_years");
    setYears(list);
    return list;
  }, []);

  const refreshSettings = useCallback(async () => {
    const s = await invoke<AppSettings>("get_settings");
    setSettings(s);
    setSidebarCollapsed(Boolean(s.sidebarCollapsed));
    setRecentFiles(s.recentFiles ?? []);
    return s;
  }, []);

  const refreshWorkspaceMeta = useCallback(async () => {
    try {
      const meta = await invoke<WorkspaceMeta>("get_workspace_meta");
      setWorkspaceMeta(meta);
      return meta;
    } catch (e) {
      // Best effort: leave the previous value in place so the UI never blanks
      // out the workspace title just because of a transient connection issue.
      // Surface the error so the user knows something is off.
      setError(String(e));
      return null;
    }
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

  // Library tile actions: keep the modal targets and the actual file IO
  // separate so the tile click handler stays cheap and the workspace
  // mutation only fires when the user confirms.
  const onRequestRenameWorkspace = useCallback((entry: LibraryEntry) => {
    setRenameWorkspaceTarget(entry);
  }, []);

  const onRequestDeleteWorkspace = useCallback((entry: LibraryEntry) => {
    setDeleteWorkspaceTarget(entry);
  }, []);

  const onConfirmRenameWorkspace = useCallback(
    async (newName: string) => {
      if (!renameWorkspaceTarget) return;
      setRenameWorkspaceBusy(true);
      try {
        await invoke<string>("rename_workspace_file", {
          path: renameWorkspaceTarget.path,
          newName,
        });
        setRenameWorkspaceTarget(null);
        await rescanLibrary();
      } catch (e) {
        setError(String(e));
      } finally {
        setRenameWorkspaceBusy(false);
      }
    },
    [renameWorkspaceTarget, rescanLibrary],
  );

  const onConfirmDeleteWorkspace = useCallback(async () => {
    if (!deleteWorkspaceTarget) return;
    setDeleteWorkspaceBusy(true);
    try {
      await invoke("delete_workspace_file", { path: deleteWorkspaceTarget.path });
      setDeleteWorkspaceTarget(null);
      await rescanLibrary();
    } catch (e) {
      setError(String(e));
    } finally {
      setDeleteWorkspaceBusy(false);
    }
  }, [deleteWorkspaceTarget, rescanLibrary]);

  const bootstrap = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // After the scratch elimination, the window starts with NO budget
      // open. `get_database_path` returns "" and `has_open_budget`
      // returns false in that state. We treat both as "show home, run
      // no data fetches".
      const path = await invoke<string>("get_database_path");
      setDbPath(path);
      const hasBudget = await invoke<boolean>("has_open_budget");
      setIsDefaultWorkspace(!hasBudget);

      try {
        const supported = await invoke<boolean>("encryption_supported");
        setEncryptionAvailable(supported);
      } catch {
        // best effort
      }

      // Always refresh the global settings + library so the home tiles
      // (recent files, library card, default folder) are accurate.
      void refreshSettings();
      void refreshLibrary();

      if (!hasBudget) {
        // Fresh launcher state — no DB connection, no year list, no
        // workspace meta, no autosave. The user gets the welcome
        // screen and picks where to go from there.
        setWorkspaceEncrypted(false);
        setSidebarYearId(null);
        setMonths([]);
        setYears([]);
        setYearOverview(null);
        setWorkspaceMeta(null);
        setAutoSaveOn(false);
        setView({ kind: "welcome" });
        return;
      }

      // Detect whether the active file is encrypted before issuing any
      // schema queries. The backend opens lazily, so this avoids the
      // first command throwing an "ENCRYPTED:" error mid-bootstrap.
      try {
        const enc = await invoke<boolean>("workspace_is_encrypted", { path });
        setWorkspaceEncrypted(enc);
        if (enc) {
          setPasswordError(null);
          setPasswordModal("unlock");
          setLoading(false);
          return;
        }
      } catch {
        // best effort - if the probe fails we'll fall back to the
        // ENCRYPTED-error branch below on the first real command.
      }

      const initialYears = await refreshYears();
      void refreshWorkspaceMeta();
      const autoSave = await invoke<boolean>("get_auto_save");
      setAutoSaveOn(autoSave);

      // Backfill: ensure every existing year has all 12 calendar months. This is
      // a one-shot reconcile that legacy files (pre-v3) will benefit from.
      // We still re-pull the years list afterward so any state derived
      // from per-year metadata reflects the post-backfill shape.
      let yearList = initialYears;
      if (initialYears.length > 0) {
        for (const y of initialYears) {
          try {
            await invoke<number[]>("ensure_year_months", { yearId: y.id });
          } catch {
            // ignore — best effort
          }
        }
        yearList = await refreshYears();
      }

      // Dashboard is the canonical per-budget landing page. Even when
      // years exist we drop the user there first so they see the
      // overview snapshot and can pick which year to enter from the
      // sidebar's "Go to year" list. This also means a freshly
      // opened budget never auto-loads a year's months — the user
      // chooses their entry point explicitly. Year-scoped state is
      // cleared so a stale year/month doesn't bleed across budgets.
      setSidebarYearId(null);
      sidebarYearIdRef.current = null;
      setMonths([]);

      // Pre-populate the dashboard snapshot for the default year so
      // the page never lands blank. The default mirrors
      // `dashboardCurrentYearId`: prefer the calendar year if it's in
      // this budget, otherwise the most recent. The dashboard's own
      // refresh effect will still re-fetch on view re-entry.
      if (yearList.length > 0) {
        const calLabel = String(new Date().getFullYear());
        const target =
          yearList.find((y) => y.yearLabel === calLabel) ?? yearList[0];
        try {
          await refreshOverview(target.id);
        } catch {
          // Snapshot is non-critical for landing; the dashboard's own
          // effect will retry on mount and surface real errors there.
          setYearOverview(null);
        }
      } else {
        setYearOverview(null);
      }

      setView({ kind: "years-landing" });
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [
    refreshYears,
    refreshOverview,
    refreshSettings,
    refreshLibrary,
    refreshWorkspaceMeta,
  ]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  // Keep macOS's single global menu bar in sync with the focused
  // window's context. In-budget items (Save As, Reports, Reorganize,
  // Year Overview, etc.) get greyed when this window is on a launcher
  // view so the user can't trigger commands against a budget that
  // doesn't exist. We re-push on view changes AND on focus so a
  // multi-window setup always reflects the foreground window.
  useEffect(() => {
    const sync = () => {
      void invoke("set_menu_context", {
        hasBudget: !isDefaultWorkspace,
        onLibrary: view.kind === "library",
      });
    };
    sync();
    let unlisten: UnlistenFn | undefined;
    void getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (focused) sync();
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => {
      unlisten?.();
    };
  }, [isDefaultWorkspace, view.kind]);

  const activateMonth = useCallback(
    async (monthId: number) => {
      const current = viewRef.current;
      if (current.kind === "month" && current.monthId === monthId) return;
      setBusy(true);
      setError(null);
      try {
        flushSync(() => {
          setYtdDrawer(null);
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
    setYtdDrawer(null);
    setBusy(true);
    try {
      const yid = sidebarYearIdRef.current;
      await refreshOverview(yid);
      // No active year ⇒ show the years-landing for this budget.
      setView(yid != null ? { kind: "year-overview", yearId: yid } : { kind: "years-landing" });
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [refreshOverview]);

  // Returns the user to the welcome screen (the "tiles" landing page they
  // see on first launch). The sidebar is hidden while this view is active
  // since none of its navigation applies until a workspace is opened.
  const showHome = useCallback(() => {
    setError(null);
    setYtdDrawer(null);
    setView({ kind: "welcome" });
  }, []);

  const showLibrary = useCallback(async () => {
    setYtdDrawer(null);
    // Show cached entries instantly so navigation feels snappy, then kick off a
    // fresh disk scan in the background so the list reflects any files the user
    // added/removed/renamed outside the app since last visit.
    try {
      await refreshLibrary();
      setView({ kind: "library" });
    } catch (e) {
      setError(String(e));
    }
    void rescanLibrary();
  }, [refreshLibrary, rescanLibrary]);

  const onReportsInitialApplied = useCallback(() => setReportsInitial(null), []);

  const showReports = useCallback((seed?: ReportsViewSeed) => {
    setError(null);
    setYtdDrawer(null);
    setReportsInitial(seed ?? null);
    setView({ kind: "reports" });
  }, []);

  const refreshCrossYear = useCallback(async () => {
    setCrossYearLoading(true);
    try {
      const data = await invoke<CrossYearOverview>("get_cross_year_overview");
      setCrossYear(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setCrossYearLoading(false);
    }
  }, []);

  // Default year for the dashboard snapshot. Prefers the calendar
  // year if it exists in this budget, otherwise falls back to the
  // most-recent year (list_years sorts year_label DESC).
  const dashboardCurrentYearId = useMemo<number | null>(() => {
    if (years.length === 0) return null;
    const cal = String(new Date().getFullYear());
    const match = years.find((y) => y.yearLabel === cal);
    return (match ?? years[0]).id;
  }, [years]);

  // Effective year shown in the snapshot card. Honours the user's
  // last click on a year card if that year still exists; otherwise
  // falls back to the default. This keeps the dashboard usable when
  // a year is renamed/deleted out from under the selection.
  const effectiveDashboardYearId = useMemo<number | null>(() => {
    if (
      dashboardSelectedYearId != null &&
      years.some((y) => y.id === dashboardSelectedYearId)
    ) {
      return dashboardSelectedYearId;
    }
    return dashboardCurrentYearId;
  }, [dashboardSelectedYearId, dashboardCurrentYearId, years]);

  // Mirror into a ref so quick-switch handlers (e.g. opening a month
  // from the dashboard's snapshot strip) can read the current value
  // without forcing a callback rebuild every time the selection
  // changes.
  const effectiveDashboardYearIdRef = useRef<number | null>(
    effectiveDashboardYearId,
  );
  useEffect(() => {
    effectiveDashboardYearIdRef.current = effectiveDashboardYearId;
  }, [effectiveDashboardYearId]);

  // Reset the user override every time we enter the dashboard so a
  // fresh visit always shows the default year. Without this, picking
  // 2025 then leaving via the sidebar and coming back would still
  // show 2025 even though the dashboard's "default focus" is the
  // calendar year.
  useEffect(() => {
    if (view.kind !== "years-landing") return;
    setDashboardSelectedYearId(null);
  }, [view.kind]);

  // When the user lands on / re-enters the dashboard, refresh both
  // the cross-year totals (powers the year-picker strip) and the
  // selected-year snapshot (powers the lower card). We refetch on
  // every entry and on every year-card click so the dashboard
  // reflects edits made in any year the user has been bouncing
  // through.
  useEffect(() => {
    if (view.kind !== "years-landing") return;
    void refreshCrossYear();
    if (effectiveDashboardYearId == null) {
      setYearOverview(null);
      return;
    }
    let cancelled = false;
    setDashboardSnapshotLoading(true);
    invoke<YearOverview>("get_year_overview", {
      yearId: effectiveDashboardYearId,
    })
      .then((o) => {
        if (!cancelled) setYearOverview(o);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setDashboardSnapshotLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [view.kind, effectiveDashboardYearId, refreshCrossYear]);

  const showCrossYear = useCallback(async () => {
    setError(null);
    setYtdDrawer(null);
    setSidebarYearId(null);
    sidebarYearIdRef.current = null;
    setView({ kind: "cross-year" });
    await refreshCrossYear();
  }, [refreshCrossYear]);

  // Launcher views (home + library) exist outside of any specific
  // budget — picking a tile from there is "decide what to work on",
  // not "spawn a second workspace". So opening from a launcher view
  // always reuses the current window. From inside a real budget,
  // opening another file always spawns a new window so the in-flight
  // one isn't silently blown away. The unsaved-changes prompt fires
  // automatically when reuse closes a dirty budget.
  const shouldReuseCurrentWindow = useCallback(
    () => viewRef.current.kind === "welcome" || viewRef.current.kind === "library",
    [],
  );

  const openWorkspaceFromHome = useCallback(
    async (filePath: string, opts?: { forceNewWindow?: boolean }) => {
      const reuse = !opts?.forceNewWindow && shouldReuseCurrentWindow();
      if (reuse) {
        await invoke("open_budget_in_current_window", { filePath });
        await bootstrap();
      } else {
        await invoke("open_budget_in_new_window", { filePath });
      }
      void refreshSettings();
    },
    [shouldReuseCurrentWindow, bootstrap, refreshSettings],
  );

  const onOpenFile = useCallback(async () => {
    try {
      const defaultDir = settings?.defaultFolder ?? undefined;
      const picked = await openDialog({
        multiple: false,
        directory: false,
        defaultPath: defaultDir,
        filters: [
          { name: "mimo file", extensions: ["mimo"] },
        ],
      });
      const filePath = typeof picked === "string" ? picked : null;
      if (!filePath) return;
      await openWorkspaceFromHome(filePath);
    } catch (e) {
      setError(String(e));
    }
  }, [settings, openWorkspaceFromHome]);

  const onSaveAs = useCallback(async (): Promise<boolean> => {
    try {
      const defaultDir = settings?.defaultFolder ?? undefined;
      const currentBase = basenameNoExt(dbPath);
      const suggested = currentBase || "mimo";
      const target = await saveDialog({
        title: "Save as",
        defaultPath: defaultDir
          ? `${defaultDir}/${suggested}.mimo`
          : `${suggested}.mimo`,
        filters: [{ name: "mimo file", extensions: ["mimo"] }],
      });
      if (!target) return false;
      await invoke("save_budget_as", { targetPath: target });
      const newPath = await invoke<string>("get_database_path");
      setDbPath(newPath);
      const hasBudget = await invoke<boolean>("has_open_budget");
      setIsDefaultWorkspace(!hasBudget);
      void refreshSettings();
      void refreshWorkspaceMeta();
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    }
  }, [settings, dbPath, refreshSettings, refreshWorkspaceMeta]);

  const showSaveToast = useCallback((msg: string) => {
    setSaveToast(msg);
    window.setTimeout(() => {
      setSaveToast((cur) => (cur === msg ? null : cur));
    }, 1800);
  }, []);

  const onPasswordSubmit = useCallback(
    async (password: string) => {
      if (!passwordModal) return;
      setPasswordBusy(true);
      setPasswordError(null);
      try {
        if (passwordModal === "unlock") {
          const ok = await invoke<boolean>("unlock_workspace", { password });
          if (!ok) {
            setPasswordError("Wrong password — try again.");
            return;
          }
          setWorkspaceEncrypted(true);
          setPasswordModal(null);
          await bootstrap();
        } else if (passwordModal === "set") {
          await invoke("encrypt_workspace", { password });
          setWorkspaceEncrypted(true);
          setPasswordModal(null);
          showSaveToast("Budget encrypted");
        } else if (passwordModal === "change") {
          await invoke("change_workspace_password", { newPassword: password });
          setPasswordModal(null);
          showSaveToast("Password changed");
        }
      } catch (e) {
        setPasswordError(String(e));
      } finally {
        setPasswordBusy(false);
      }
    },
    [passwordModal, bootstrap, showSaveToast],
  );

  const onCmdS = useCallback(async () => {
    // Cmd+S used to spring a Save As sheet whenever the active window
    // had no real `.mimo` file behind it — but on the launcher screens
    // that's confusing: there's nothing to save. After the scratch
    // elimination, "no file" means "user is on home/library", so we
    // short-circuit silently. For real budgets the file is always
    // up-to-date because edits write through, so Cmd+S just confirms.
    if (isLauncherView) return;
    try {
      const hasBudget = await invoke<boolean>("has_open_budget");
      if (!hasBudget) return;
      showSaveToast("Already saved");
    } catch (e) {
      setError(String(e));
    }
  }, [isLauncherView, showSaveToast]);

  // Two flavors of "create": from the home/library screens we open a New
  // Budget wizard that produces a brand-new `.mimo` file; from inside an
  // existing budget the same modal becomes a plain "+ New year" prompt
  // that adds another calendar year. Mode is decided by the caller so each
  // entry point reflects the user's actual intent.
  const onCreateBudget = useCallback(() => {
    setCreateYearMode("budget");
    setCreateYearOpen(true);
  }, []);
  const onCreateYear = useCallback(() => {
    setCreateYearMode("year");
    setCreateYearOpen(true);
  }, []);

  const enterYear = useCallback(
    async (yearId: number) => {
      setBusy(true);
      try {
        setSidebarYearId(yearId);
        sidebarYearIdRef.current = yearId;
        await refreshMonths(yearId);
        await refreshOverview(yearId);
        flushSync(() => {
          setView({ kind: "year-overview", yearId });
        });
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
    },
    [refreshMonths, refreshOverview],
  );

  const exitYear = useCallback(() => {
    setSidebarYearId(null);
    sidebarYearIdRef.current = null;
    setMonths([]);
    setYearOverview(null);
    setView({ kind: "years-landing" });
  }, []);

  // Quick-switch from the dashboard's snapshot month strip into the
  // month's data-entry screen. The strip is always rendered for the
  // dashboard's selected year, which may differ from whichever year
  // is currently "entered" in the sidebar — so we enter that year
  // first (no-op if already entered), then activate the month.
  const openMonthFromDashboard = useCallback(
    async (monthId: number) => {
      const yearId = effectiveDashboardYearIdRef.current;
      if (yearId == null) return;
      if (sidebarYearIdRef.current !== yearId) {
        await enterYear(yearId);
      }
      await activateMonth(monthId);
    },
    [enterYear, activateMonth],
  );

  const onCreateYearSubmit = useCallback(
    async (label: string) => {
      setCreateYearBusy(true);
      try {
        if (createYearMode === "budget") {
          // Spawn a brand-new `.mimo` file in the default folder. Always
          // scaffold the current calendar year so the new budget opens
          // ready to enter data; users can add more years later via the
          // sidebar's "+ New year" button.
          const reuse = shouldReuseCurrentWindow();
          const currentYear = new Date().getFullYear();
          await invoke<string>("create_year_workspace", {
            yearLabel: label,
            scaffoldYearValue: currentYear,
            reuseCurrentWindow: reuse,
          });
          setCreateYearOpen(false);
          if (reuse) {
            // Backend already swapped this window's connection over to
            // the new file; rerun the bootstrap so all in-memory state
            // (years, sidebar, view) reflects it.
            await bootstrap();
          }
          void refreshSettings();
        } else {
          const newId = await invoke<number>("create_year", { yearLabel: label });
          await refreshYears();
          setCreateYearOpen(false);
          await enterYear(newId);
        }
      } catch (e) {
        setError(String(e));
      } finally {
        setCreateYearBusy(false);
      }
    },
    [
      createYearMode,
      refreshYears,
      enterYear,
      shouldReuseCurrentWindow,
      bootstrap,
      refreshSettings,
    ],
  );

  const onRenameYearSubmit = useCallback(
    async (label: string) => {
      const target = renameYearTarget;
      if (!target) return;
      setRenameYearBusy(true);
      try {
        await invoke<string>("rename_year", { yearId: target.id, yearLabel: label });
        setRenameYearTarget(null);
        await refreshYears();
        const yid = sidebarYearIdRef.current;
        if (yid != null) {
          await refreshMonths(yid);
          await refreshOverview(yid);
        }
      } catch (e) {
        setError(String(e));
      } finally {
        setRenameYearBusy(false);
      }
    },
    [renameYearTarget, refreshYears, refreshMonths, refreshOverview],
  );

  const onDeleteYearConfirm = useCallback(async () => {
    const target = deleteYearTarget;
    if (!target) return;
    setDeleteYearBusy(true);
    try {
      await invoke("delete_year", { yearId: target.id });
      setDeleteYearTarget(null);
      const list = await refreshYears();
      const stillSelected = list.find((y) => y.id === sidebarYearIdRef.current);
      if (!stillSelected) {
        if (list.length === 0) {
          setSidebarYearId(null);
          sidebarYearIdRef.current = null;
          setMonths([]);
          setView({ kind: "welcome" });
        } else {
          await enterYear(list[0].id);
        }
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setDeleteYearBusy(false);
    }
  }, [deleteYearTarget, refreshYears, enterYear]);

  const openDuplicateYearModal = useCallback(
    async (yearId?: number) => {
      const id = yearId ?? sidebarYearIdRef.current;
      if (id == null) return;
      const target = yearsRef.current.find((y) => y.id === id) ?? null;
      if (!target) return;
      try {
        const sourceMonths = await invoke<MonthRow[]>("list_months_for_year", {
          yearId: target.id,
        });
        setDuplicateYearMonths(sourceMonths);
        setDuplicateYearTarget(target);
      } catch (e) {
        setError(String(e));
      }
    },
    [],
  );

  // Year-end nudge: in November/December, if the next calendar year hasn't
  // been added to this workspace yet, surface a soft banner inviting the
  // user to roll the current year forward. We pick the best source year
  // (the existing row matching the current calendar year, falling back to
  // the most recent numeric year) so the duplicate-year modal opens with a
  // sensible default rather than asking the user to pick.
  const yearEndNudge = useMemo(() => {
    const now = new Date();
    const month = now.getMonth();
    if (month !== 10 && month !== 11) return null;
    const currentYearLabel = String(now.getFullYear());
    const nextYearLabel = String(now.getFullYear() + 1);
    if (years.some((y) => y.yearLabel === nextYearLabel)) return null;
    if (years.length === 0) return null;
    const exact = years.find((y) => y.yearLabel === currentYearLabel);
    let source = exact ?? null;
    if (!source) {
      const numeric = [...years]
        .map((y) => ({ y, n: Number(y.yearLabel) }))
        .filter((x) => Number.isFinite(x.n))
        .sort((a, b) => b.n - a.n)[0];
      source = numeric?.y ?? null;
    }
    if (!source) return null;
    return {
      sourceYearId: source.id,
      sourceLabel: source.yearLabel,
      nextLabel: nextYearLabel,
    };
  }, [years]);

  const onStartYearEndNudge = useCallback(() => {
    if (!yearEndNudge) return;
    void openDuplicateYearModal(yearEndNudge.sourceYearId);
  }, [yearEndNudge, openDuplicateYearModal]);

  const openRenameYearModal = useCallback((yearId?: number) => {
    const id = yearId ?? sidebarYearIdRef.current;
    if (id == null) return;
    const target = yearsRef.current.find((y) => y.id === id) ?? null;
    if (target) setRenameYearTarget(target);
  }, []);

  const openDeleteYearModal = useCallback((yearId?: number) => {
    const id = yearId ?? sidebarYearIdRef.current;
    if (id == null) return;
    const target = yearsRef.current.find((y) => y.id === id) ?? null;
    if (target) setDeleteYearTarget(target);
  }, []);

  const onDuplicateYearSubmit = useCallback(
    async (args: DuplicateYearArgs) => {
      const target = duplicateYearTarget;
      if (!target) return;
      setDuplicateYearBusy(true);
      try {
        const newId = await invoke<number>("duplicate_year", {
          sourceYearId: target.id,
          destYearLabel: args.destYearLabel,
          mode: args.mode,
          sourceMonthId: args.sourceMonthId ?? null,
        });
        setDuplicateYearTarget(null);
        await refreshYears();
        await enterYear(newId);
      } catch (e) {
        setError(String(e));
      } finally {
        setDuplicateYearBusy(false);
      }
    },
    [duplicateYearTarget, refreshYears, enterYear],
  );

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

  const onOpenRecent = useCallback(
    async (path: string) => {
      try {
        await openWorkspaceFromHome(path);
      } catch (e) {
        setError(String(e));
      }
    },
    [openWorkspaceFromHome],
  );

  // When a library tile is picked from inside an active budget the
  // user almost always wants the new file in a fresh window — the
  // open one usually has work in progress. But sometimes they want to
  // *replace* what they're looking at. Rather than guess, we ask. On
  // the launcher view itself (no budget behind us) there's nothing to
  // protect, so we skip the prompt and reuse silently.
  // Bring an external `.mimo` file into the user's library: copy it
  // into the default folder (with " (1)", " (2)", … name de-duping if
  // a file by that name is already there), then open the new copy in
  // the current window. The original file is left untouched, so the
  // source can stay in Google Drive / Downloads / wherever without
  // being double-managed by the app.
  const onImportToLibrary = useCallback(async () => {
    try {
      const picked = await openDialog({
        multiple: false,
        directory: false,
        filters: [{ name: "mimo file", extensions: ["mimo"] }],
      });
      const sourcePath = typeof picked === "string" ? picked : null;
      if (!sourcePath) return;
      const importedPath = await invoke<string>("import_workspace", {
        sourcePath,
      });
      await rescanLibrary();
      await openWorkspaceFromHome(importedPath);
    } catch (e) {
      setError(String(e));
    }
  }, [openWorkspaceFromHome, rescanLibrary]);

  const onLibraryOpen = useCallback(
    async (path: string) => {
      try {
        if (shouldReuseCurrentWindow()) {
          await openWorkspaceFromHome(path);
        } else {
          setLibraryOpenChoice({ path });
        }
      } catch (e) {
        setError(String(e));
      }
    },
    [openWorkspaceFromHome, shouldReuseCurrentWindow],
  );

  const onLibraryOpenChoiceConfirm = useCallback(
    async (mode: "current" | "new") => {
      const target = libraryOpenChoice;
      if (!target) return;
      setLibraryOpenChoice(null);
      try {
        await openWorkspaceFromHome(target.path, {
          forceNewWindow: mode === "new",
        });
      } catch (e) {
        setError(String(e));
      }
    },
    [libraryOpenChoice, openWorkspaceFromHome],
  );

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    const win = getCurrentWindow();
    win
      .onCloseRequested((event) => {
        // We must call preventDefault SYNCHRONOUSLY — once the handler yields
        // to an `await`, Tauri may have already resolved the close. We block
        // the default close every time, then either destroy the window
        // ourselves (clean state) or surface the unsaved-changes prompt.
        event.preventDefault();
        void (async () => {
          try {
            const hasBudget = await invoke<boolean>("has_open_budget");
            const dirty = await invoke<boolean>("is_dirty");
            if (!hasBudget || !dirty) {
              await win.destroy();
              return;
            }
            setUnsavedPromptOpen(true);
          } catch (err) {
            setError(String(err));
            // Don't trap the user inside a window we can't reason about.
            try {
              await win.destroy();
            } catch {
              /* swallow — window may already be gone */
            }
          }
        })();
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

  // Menu listeners need to bind exactly once for the lifetime of the
  // window — Tauri rebinds aren't free, and the previous deps array
  // didn't list every handler the bodies actually called (which is what
  // the old eslint-disable was hiding). Route everything through a ref
  // that's refreshed on every render so the listeners always reach the
  // freshest closure without re-subscribing.
  //
  // The ref is initialized lazily because some of the callbacks it
  // closes over are declared further down in this component body —
  // populating it here would hit the temporal-dead-zone. We assign
  // `.current` in a single statement after every callback is defined
  // (search for `menuHandlersRef.current = {...}` below).
  type MenuHandlers = {
    cycleMonth: typeof cycleMonth;
    onOpenFile: typeof onOpenFile;
    onCreateBudget: typeof onCreateBudget;
    onSaveAs: typeof onSaveAs;
    onToggleAutoSave: typeof onToggleAutoSave;
    openReorderModal: typeof openReorderModal;
    onRevealFolder: typeof onRevealFolder;
    onExportCsv: () => Promise<void>;
    onExportJson: () => Promise<void>;
    onExportCsvRedacted: () => Promise<void>;
    onExportJsonRedacted: () => Promise<void>;
    onToggleSidebar: typeof onToggleSidebar;
    showOverview: typeof showOverview;
    showReports: typeof showReports;
    showLibrary: typeof showLibrary;
    openDuplicateYearModal: typeof openDuplicateYearModal;
    openRenameYearModal: typeof openRenameYearModal;
    openDeleteYearModal: typeof openDeleteYearModal;
    showSaveToast: typeof showSaveToast;
  };
  const menuHandlersRef = useRef<MenuHandlers | null>(null);

  useEffect(() => {
    const unlisteners: UnlistenFn[] = [];
    const listenSafe = (name: string, fn: () => void) =>
      listen(name, fn).then((u) => unlisteners.push(u));
    const h = () => menuHandlersRef.current!;
    void listenSafe("menu:next-month", () => h().cycleMonth(1));
    void listenSafe("menu:prev-month", () => h().cycleMonth(-1));
    void listenSafe("menu:open-file", () => void h().onOpenFile());
    void listenSafe("menu:new-year", () => h().onCreateBudget());
    void listenSafe("menu:save-as", () => void h().onSaveAs());
    void listenSafe("menu:toggle-autosave", () => void h().onToggleAutoSave());
    void listenSafe("menu:reorganize", () => h().openReorderModal());
    void listenSafe("menu:show-default-folder", () => void h().onRevealFolder());
    void listenSafe("menu:export-csv", () => void h().onExportCsv());
    void listenSafe("menu:export-json", () => void h().onExportJson());
    void listenSafe("menu:export-csv-redacted", () => void h().onExportCsvRedacted());
    void listenSafe("menu:export-json-redacted", () => void h().onExportJsonRedacted());
    void listenSafe("menu:toggle-sidebar", () => h().onToggleSidebar());
    void listenSafe("menu:show-overview", () => void h().showOverview());
    void listenSafe("menu:show-reports", () => void h().showReports());
    void listenSafe("menu:show-library", () => void h().showLibrary());
    void listenSafe("menu:duplicate-year", () => void h().openDuplicateYearModal());
    void listenSafe("menu:rename-year", () => h().openRenameYearModal());
    void listenSafe("menu:delete-year", () => h().openDeleteYearModal());
    void listenSafe("menu:open-preferences", () => setPrefsOpen(true));
    void listenSafe("menu:set-password", () => {
      if (!encryptionAvailableRef.current) {
        setError(
          "This build of mimo doesn't include encryption support. Rebuild with --features encryption.",
        );
        return;
      }
      if (workspaceEncryptedRef.current) {
        setError(
          "This budget is already encrypted. Use Change Password to update it.",
        );
        return;
      }
      setPasswordError(null);
      setPasswordModal("set");
    });
    void listenSafe("menu:change-password", () => {
      if (!encryptionAvailableRef.current) {
        setError("This build of mimo doesn't include encryption support.");
        return;
      }
      if (!workspaceEncryptedRef.current) {
        setError(
          "This budget isn't encrypted yet. Use Set Password to add a password.",
        );
        return;
      }
      setPasswordError(null);
      setPasswordModal("change");
    });
    void listenSafe("menu:remove-password", () => {
      if (!encryptionAvailableRef.current || !workspaceEncryptedRef.current) {
        setError(
          encryptionAvailableRef.current
            ? "This budget isn't encrypted."
            : "This build of mimo doesn't include encryption support.",
        );
        return;
      }
      const ok = window.confirm(
        "Remove encryption from this budget? The file will be readable without a password after this.",
      );
      if (!ok) return;
      void (async () => {
        try {
          await invoke("decrypt_workspace");
          setWorkspaceEncrypted(false);
          h().showSaveToast("Encryption removed");
        } catch (e) {
          setError(String(e));
        }
      })();
    });
    return () => {
      unlisteners.forEach((u) => u());
    };
  }, []);

  // Window-level Cmd+S handler (the menu Save item was removed in favor of a status pill).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      if (e.key.toLowerCase() === "s" && !e.shiftKey) {
        e.preventDefault();
        void onCmdS();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCmdS]);

  useEffect(() => {
    // Autosave snapshots only make sense for a real `.mimo` file.
    // Skip entirely when the user is on home/library or has no
    // budget open — otherwise we'd snapshot nothing into the
    // backups folder every five minutes.
    if (!autoSaveOn || isDefaultWorkspace) return;
    const intervalMs = 5 * 60 * 1000;
    const id = window.setInterval(() => {
      setSnapshotState((s) => ({ ...s, busy: true }));
      void invoke("save_snapshot")
        .then(() => {
          setSnapshotState({ busy: false, lastAt: Date.now() });
        })
        .catch(() => {
          setSnapshotState((s) => ({ ...s, busy: false }));
        });
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [autoSaveOn, isDefaultWorkspace]);

  // Lightweight dirty poller for the status pill. Only runs when a
  // real budget is open AND the active view actually shows the pill —
  // launcher views suppress it, so polling twice a second there is
  // wasted IPC + wasted main-thread time.
  useEffect(() => {
    if (isDefaultWorkspace || isLauncherView) {
      setDirty(false);
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const d = await invoke<boolean>("is_dirty");
        if (!cancelled) setDirty(d);
      } catch {
        // ignore — pill just shows last known state
      }
    };
    void tick();
    const id = window.setInterval(() => {
      void tick();
    }, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [dbPath, isDefaultWorkspace, isLauncherView]);

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
    (bucketId: number) => {
      const mv = monthViewRef.current;
      const bucket = mv?.expenseBuckets.find((b) => b.id === bucketId);
      setLineEditConfig({
        mode: "add",
        bucketId,
        bucketName: bucket?.name ?? "this bucket",
      });
    },
    [],
  );

  const onEditRow = useCallback(
    (lineId: number) => {
      const mv = monthViewRef.current;
      if (!mv) return;
      let foundLine: ExpenseLineDto | undefined;
      let foundBucket: string | undefined;
      for (const b of mv.expenseBuckets) {
        const l = b.lines.find((x) => x.id === lineId);
        if (l) {
          foundLine = l;
          foundBucket = b.name;
          break;
        }
      }
      if (!foundLine) return;
      setLineEditConfig({
        mode: "edit",
        lineId,
        bucketName: foundBucket,
        initialName: foundLine.name,
        initialNeutral: foundLine.isNeutralTransfer,
        initialSinking: foundLine.isSinkingFund,
      });
    },
    [],
  );

  const onDeleteRow = useCallback((lineId: number, currentName: string) => {
    setPendingDelete({ lineId, name: currentName });
  }, []);

  const submitLineEdit = useCallback(
    async (payload: {
      name: string;
      isNeutralTransfer: boolean;
      isSinkingFund: boolean;
    }) => {
      const cfg = lineEditConfig;
      if (!cfg) return;
      const monthId = activeMonthId();
      if (monthId == null) return;
      try {
        if (cfg.mode === "add") {
          await invoke("add_expense_line", {
            bucketId: cfg.bucketId,
            name: payload.name,
            isNeutralTransfer: payload.isNeutralTransfer,
            isSinkingFund: payload.isSinkingFund,
          });
        } else {
          if (payload.name !== cfg.initialName) {
            await invoke("rename_expense_line", {
              id: cfg.lineId,
              name: payload.name,
            });
          }
          if (
            payload.isNeutralTransfer !== cfg.initialNeutral ||
            payload.isSinkingFund !== cfg.initialSinking
          ) {
            await invoke("update_expense_line_flags", {
              lineId: cfg.lineId,
              isNeutralTransfer: payload.isNeutralTransfer,
              isSinkingFund: payload.isSinkingFund,
            });
          }
        }
        setLineEditConfig(null);
        await refreshMonthView(monthId);
      } catch (e) {
        setError(String(e));
      }
    },
    [lineEditConfig, refreshMonthView, activeMonthId],
  );

  const confirmDelete = useCallback(async () => {
    const target = pendingDelete;
    if (!target) return;
    const monthId = activeMonthId();
    if (monthId == null) return;
    setDeleteBusy(true);
    try {
      await invoke("delete_expense_line", { id: target.lineId });
      setPendingDelete(null);
      await refreshMonthView(monthId);
    } catch (e) {
      setError(String(e));
    } finally {
      setDeleteBusy(false);
    }
  }, [pendingDelete, refreshMonthView, activeMonthId]);

  // Common downloader used by every export flow. Centralising the Blob/URL
  // dance avoids subtle leaks (forgetting revokeObjectURL) and makes the
  // call sites read like declarative recipes — name in, file out.
  const downloadFile = useCallback(
    (content: string, filename: string, mime: string) => {
      const blob = new Blob([content], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    },
    [],
  );

  const workspaceFilenameStem = useCallback(
    () => (basenameNoExt(dbPath) || "mimo").replace(/\s+/g, "_"),
    [dbPath],
  );

  const monthFilenameStem = useCallback(
    (monthId: number): string => {
      const wsLabel = workspaceFilenameStem();
      const m = months.find((row) => row.id === monthId);
      const monthSlug =
        (m?.yearMonth || m?.tabLabel || `month-${monthId}`).replace(/\s+/g, "_");
      return `${wsLabel}-${monthSlug}`;
    },
    [workspaceFilenameStem, months],
  );

  const runExport = useCallback(
    async (
      command: string,
      args: Record<string, unknown> | undefined,
      filename: string,
      mime: string,
    ) => {
      try {
        const out = await invoke<string>(command, args);
        downloadFile(out, filename, mime);
      } catch (e) {
        setError(String(e));
      }
    },
    [downloadFile],
  );

  const onExportCsv = useCallback(
    () =>
      runExport(
        "export_csv_data",
        undefined,
        `${workspaceFilenameStem()}.csv`,
        "text/csv;charset=utf-8",
      ),
    [runExport, workspaceFilenameStem],
  );

  const onExportJson = useCallback(
    () =>
      runExport(
        "export_workspace_json",
        undefined,
        `${workspaceFilenameStem()}.json`,
        "application/json;charset=utf-8",
      ),
    [runExport, workspaceFilenameStem],
  );

  // Redacted variants share the file naming scheme but get a `-redacted`
  // suffix so a sender can tell at a glance which version they attached.
  const onExportCsvRedacted = useCallback(
    () =>
      runExport(
        "export_workspace_csv_redacted",
        undefined,
        `${workspaceFilenameStem()}-redacted.csv`,
        "text/csv;charset=utf-8",
      ),
    [runExport, workspaceFilenameStem],
  );

  const onExportJsonRedacted = useCallback(
    () =>
      runExport(
        "export_workspace_json_redacted",
        undefined,
        `${workspaceFilenameStem()}-redacted.json`,
        "application/json;charset=utf-8",
      ),
    [runExport, workspaceFilenameStem],
  );

  const onExportYearCsvRedacted = useCallback(
    (yearId: number, yearLabel: string) =>
      runExport(
        "export_year_csv_redacted",
        { yearId },
        `${workspaceFilenameStem()}-${yearLabel || "year"}-redacted.csv`,
        "text/csv;charset=utf-8",
      ),
    [runExport, workspaceFilenameStem],
  );

  const onExportYearJsonRedacted = useCallback(
    (yearId: number, yearLabel: string) =>
      runExport(
        "export_year_json_redacted",
        { yearId },
        `${workspaceFilenameStem()}-${yearLabel || "year"}-redacted.json`,
        "application/json;charset=utf-8",
      ),
    [runExport, workspaceFilenameStem],
  );

  const onExportYearCsv = useCallback(
    async (yearId: number, yearLabel: string) => {
      // No backend "year detailed" export today, so fall back to the
      // workspace-wide detailed CSV with a year-tagged filename. This keeps
      // the picker UX consistent without requiring a new backend command yet.
      try {
        const csv = await invoke<string>("export_csv_data");
        downloadFile(
          csv,
          `${workspaceFilenameStem()}-${yearLabel || "year"}.csv`,
          "text/csv;charset=utf-8",
        );
        void yearId;
      } catch (e) {
        setError(String(e));
      }
    },
    [downloadFile, workspaceFilenameStem],
  );

  const onExportYearJson = useCallback(
    async (yearId: number, yearLabel: string) => {
      try {
        const json = await invoke<string>("export_workspace_json");
        downloadFile(
          json,
          `${workspaceFilenameStem()}-${yearLabel || "year"}.json`,
          "application/json;charset=utf-8",
        );
        void yearId;
      } catch (e) {
        setError(String(e));
      }
    },
    [downloadFile, workspaceFilenameStem],
  );

  const onExportMonthCsv = useCallback(
    (monthId: number) =>
      runExport(
        "export_month_csv",
        { monthId },
        `${monthFilenameStem(monthId)}.csv`,
        "text/csv;charset=utf-8",
      ),
    [runExport, monthFilenameStem],
  );

  const onExportMonthJson = useCallback(
    (monthId: number) =>
      runExport(
        "export_month_json",
        { monthId },
        `${monthFilenameStem(monthId)}.json`,
        "application/json;charset=utf-8",
      ),
    [runExport, monthFilenameStem],
  );

  const onExportMonthCsvRedacted = useCallback(
    (monthId: number) =>
      runExport(
        "export_month_csv_redacted",
        { monthId },
        `${monthFilenameStem(monthId)}-redacted.csv`,
        "text/csv;charset=utf-8",
      ),
    [runExport, monthFilenameStem],
  );

  const onExportMonthJsonRedacted = useCallback(
    (monthId: number) =>
      runExport(
        "export_month_json_redacted",
        { monthId },
        `${monthFilenameStem(monthId)}-redacted.json`,
        "application/json;charset=utf-8",
      ),
    [runExport, monthFilenameStem],
  );

  // Refresh the menu-handler bag every render. Lazy assignment side-steps
  // the temporal-dead-zone for callbacks declared later in this body, and
  // the listener effect (mounted once) reads through this ref so the
  // freshest closures fire without re-subscribing on every render.
  menuHandlersRef.current = {
    cycleMonth,
    onOpenFile,
    onCreateBudget,
    onSaveAs,
    onToggleAutoSave,
    openReorderModal,
    onRevealFolder,
    onExportCsv,
    onExportJson,
    onExportCsvRedacted,
    onExportJsonRedacted,
    onToggleSidebar,
    showOverview,
    showReports,
    showLibrary,
    openDuplicateYearModal,
    openRenameYearModal,
    openDeleteYearModal,
    showSaveToast,
  };

  if (loading) {
    return (
      <div className="app-shell">
        <p className="muted">Loading…</p>
      </div>
    );
  }

  const fileBasename = basenameNoExt(dbPath) || "mimo";
  // Prefer the user-set display name from workspace_meta over the raw file
  // basename. This lets the user give a workspace a friendlier label (e.g.
  // "Family budget") without renaming the underlying file. If display_name is
  // unset OR we're on the default scratch workspace, fall back to the
  // basename so the UI stays accurate.
  const displayNameOverride =
    !isDefaultWorkspace && workspaceMeta?.displayName
      ? workspaceMeta.displayName
      : null;
  const workspaceBasename = displayNameOverride ?? fileBasename;
  const yearLabels = years.map((y) => y.yearLabel);

  // Hide the sidebar whenever the active view doesn't belong to a single
  // budget. Welcome and Library are launcher screens that live "outside"
  // any one budget, so sidebar navigation (year list, months, etc.) has
  // nothing meaningful to point at and only adds visual noise. Once the
  // user opens a budget — by picking a tile in Library, a recent file,
  // creating a new one, etc. — the view transitions to a per-budget
  // kind (years-landing / year-overview / month) and the sidebar
  // reappears with that budget's context.
  const sidebarHidden = isLauncherView;
  const layoutClassName = `app-layout${
    sidebarHidden ? " sidebar-hidden" : sidebarCollapsed ? " sidebar-collapsed" : ""
  }`;

  return (
    <div className={layoutClassName}>
      <BucketReorderModal
        open={reorderModalOpen}
        buckets={monthView?.expenseBuckets ?? []}
        onClose={() => setReorderModalOpen(false)}
        onCommit={(ids) => void reorderBuckets(ids)}
      />
      <PreferencesModal
        open={prefsOpen}
        settings={settings}
        workspaceMeta={workspaceMeta}
        workspaceFileBasename={fileBasename}
        isDefaultWorkspace={isDefaultWorkspace}
        onClose={() => setPrefsOpen(false)}
        onSaved={() => void refreshSettings()}
        onWorkspaceMetaSaved={() => void refreshWorkspaceMeta()}
        onError={(msg) => setError(msg)}
      />
      <PasswordModal
        kind={passwordModal ?? "unlock"}
        open={passwordModal !== null}
        busy={passwordBusy}
        error={passwordError}
        onCancel={() => {
          if (passwordBusy) return;
          setPasswordModal(null);
          setPasswordError(null);
        }}
        onSubmit={(pw) => void onPasswordSubmit(pw)}
      />
      <UnsavedChangesModal
        open={unsavedPromptOpen}
        busy={unsavedBusy}
        mode="close"
        onSave={() => void onUnsavedSave()}
        onDiscard={() => void onUnsavedDiscard()}
        onCancel={onUnsavedCancel}
      />
      <CreateYearModal
        open={createYearOpen}
        mode={createYearMode}
        busy={createYearBusy}
        existingLabels={yearLabels}
        onCancel={() => {
          if (!createYearBusy) setCreateYearOpen(false);
        }}
        onCreate={(label) => void onCreateYearSubmit(label)}
      />
      <RenameYearModal
        open={renameYearTarget !== null}
        initial={renameYearTarget?.yearLabel ?? ""}
        busy={renameYearBusy}
        existingLabels={yearLabels}
        onCancel={() => {
          if (!renameYearBusy) setRenameYearTarget(null);
        }}
        onSubmit={(label) => void onRenameYearSubmit(label)}
      />
      <DeleteYearConfirmModal
        open={deleteYearTarget !== null}
        yearLabel={deleteYearTarget?.yearLabel ?? ""}
        busy={deleteYearBusy}
        onCancel={() => {
          if (!deleteYearBusy) setDeleteYearTarget(null);
        }}
        onConfirm={() => void onDeleteYearConfirm()}
      />
      <DuplicateYearModal
        open={duplicateYearTarget !== null}
        sourceYear={duplicateYearTarget}
        sourceMonths={duplicateYearMonths}
        busy={duplicateYearBusy}
        existingLabels={yearLabels}
        onCancel={() => {
          if (!duplicateYearBusy) setDuplicateYearTarget(null);
        }}
        onSubmit={(args) => void onDuplicateYearSubmit(args)}
      />
      <RenameWorkspaceModal
        open={renameWorkspaceTarget !== null}
        initial={renameWorkspaceTarget ? basename(renameWorkspaceTarget.path) : ""}
        busy={renameWorkspaceBusy}
        onCancel={() => {
          if (!renameWorkspaceBusy) setRenameWorkspaceTarget(null);
        }}
        onSubmit={(name) => void onConfirmRenameWorkspace(name)}
      />
      <DeleteWorkspaceConfirmModal
        open={deleteWorkspaceTarget !== null}
        workspaceName={
          deleteWorkspaceTarget ? basename(deleteWorkspaceTarget.path) : ""
        }
        busy={deleteWorkspaceBusy}
        onCancel={() => {
          if (!deleteWorkspaceBusy) setDeleteWorkspaceTarget(null);
        }}
        onConfirm={() => void onConfirmDeleteWorkspace()}
      />
      <OpenInWindowModal
        open={libraryOpenChoice !== null}
        fileName={libraryOpenChoice ? basenameNoExt(libraryOpenChoice.path) : ""}
        onCancel={() => setLibraryOpenChoice(null)}
        onPick={(where) => void onLibraryOpenChoiceConfirm(where)}
      />
      <ExpenseLineEditModal
        config={lineEditConfig}
        onCancel={() => setLineEditConfig(null)}
        onSubmit={submitLineEdit}
      />
      <ConfirmDeleteRowModal
        open={pendingDelete !== null}
        rowName={pendingDelete?.name ?? ""}
        busy={deleteBusy}
        onCancel={() => {
          if (!deleteBusy) setPendingDelete(null);
        }}
        onConfirm={() => void confirmDelete()}
      />

      {!sidebarHidden && (
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggleCollapsed={onToggleSidebar}
          workspaceTitle={isDefaultWorkspace ? "Untitled budget" : workspaceBasename}
          workspaceTitleIsPlaceholder={isDefaultWorkspace}
          workspacePathTooltip={(() => {
            const parts: string[] = [];
            if (workspaceMeta?.updatedAt) {
              parts.push(`Last edited ${formatRelative(workspaceMeta.updatedAt)}`);
            }
            if (dbPath) parts.push(dbPath);
            const joined = parts.join("\n");
            return joined.length > 0 ? joined : undefined;
          })()}
          years={years}
          months={months}
          view={view}
          sidebarYearId={sidebarYearId}
          monthSections={
            view.kind === "month" && monthView && monthView.monthId === view.monthId
              ? [
                  { id: "section-income", label: "Income" },
                  ...monthView.expenseBuckets.map((b) => ({
                    id: `section-bucket-${b.id}`,
                    label: b.name,
                  })),
                ]
              : undefined
          }
          onSelectYear={(id) => void enterYear(id)}
          onBackToYears={exitYear}
          onShowYearOverview={(id) => {
            void enterYear(id);
          }}
          onActivateMonth={(id) => void activateMonth(id)}
          onScrollToSection={(elementId) => {
            document.getElementById(elementId)?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
        />
      )}

      <div className="app-main">
        <header className="top-bar">
          <button
            type="button"
            className="brand brand-button"
            onClick={showHome}
            title="Go to home"
            aria-label="mimo — go to home"
          >
            <span className="brand-mark" aria-hidden="true">◆</span>
            <span className="brand-name">mimo</span>
            <span className="brand-tagline">Money In, Money Out | Mind the Flow</span>
          </button>
          <div className="top-bar-spacer" />
          {/* Top-bar nav stays put across every view so users always
              have the same orientation. Dashboard + Reports require an
              open budget, so they're disabled (rather than hidden) on
              launcher views — the slot stays put and the affordance
              communicates "this exists, just not here yet". */}
          <button
            type="button"
            className="btn ghost"
            onClick={showHome}
            aria-pressed={view.kind === "welcome"}
          >
            Home
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={exitYear}
            title={
              isLauncherView
                ? "Open a budget to see its dashboard"
                : "Open this budget's dashboard"
            }
            aria-pressed={view.kind === "years-landing"}
            disabled={isLauncherView}
          >
            Dashboard
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={() => void showReports()}
            title={
              isLauncherView
                ? "Open a budget to see its reports"
                : "Calendar reports (⌘⇧R)"
            }
            aria-pressed={view.kind === "reports"}
            disabled={isLauncherView}
          >
            Reports
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={() => void showLibrary()}
            title="Browse all budgets"
            aria-pressed={view.kind === "library"}
          >
            Library
          </button>
          {/* Save / autosave status only makes sense inside an open
              budget. On launcher views there's nothing to save (the
              scratch backend isn't user-visible there), so we suppress
              the pill entirely instead of showing a confusing
              "Unsaved · Save As…" affordance. */}
          {!isLauncherView && (
            <SaveStatusPill
              isDefaultWorkspace={isDefaultWorkspace}
              dirty={dirty}
              autoSaveOn={autoSaveOn}
              snapshotBusy={snapshotState.busy}
              lastSnapshotAt={snapshotState.lastAt}
              onSaveAs={() => void onSaveAs()}
            />
          )}
          {saveToast && !isLauncherView && (
            <span className="saved-flash" role="status" aria-live="polite">
              {saveToast}
            </span>
          )}
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
              onCreateYear={onCreateBudget}
              onOpenFile={() => void onOpenFile()}
              onOpenRecent={(p) => void onOpenRecent(p)}
              onShowLibrary={() => void showLibrary()}
              onRevealFolder={() => void onRevealFolder()}
            />
          )}

          {view.kind === "library" && (
            <LibraryView
              entries={libraryEntries}
              busy={busy}
              onOpen={(p) => void onLibraryOpen(p)}
              onOpenInNewWindow={(p) =>
                void openWorkspaceFromHome(p, { forceNewWindow: true })
              }
              onImport={() => void onImportToLibrary()}
              onRescan={() => void rescanLibrary()}
              onRevealFolder={() => void onRevealFolder()}
              onCreateYear={onCreateBudget}
              defaultFolder={settings?.defaultFolder ?? null}
              onRenameWorkspace={onRequestRenameWorkspace}
              onDeleteWorkspace={onRequestDeleteWorkspace}
            />
          )}

          {view.kind === "years-landing" && (
            <BudgetDashboard
              workspaceTitle={
                isDefaultWorkspace ? "Untitled budget" : workspaceBasename
              }
              years={years}
              crossYear={crossYear}
              crossYearLoading={crossYearLoading}
              snapshot={yearOverview}
              snapshotLoading={dashboardSnapshotLoading}
              selectedYearId={effectiveDashboardYearId}
              onPickYear={setDashboardSelectedYearId}
              onOpenYearOverview={(id) => void enterYear(id)}
              onOpenMonth={(id) => void openMonthFromDashboard(id)}
              onCreateYear={onCreateYear}
              onShowCrossYear={() => void showCrossYear()}
              yearEndNudge={
                yearEndNudge
                  ? {
                      sourceLabel: yearEndNudge.sourceLabel,
                      nextLabel: yearEndNudge.nextLabel,
                    }
                  : null
              }
              onStartYearEndNudge={onStartYearEndNudge}
            />
          )}

          {view.kind === "year-overview" && yearOverview && sidebarYearId != null && (
            <>
              <div className="overview-toolbar">
                <ExportPickerButton
                  label="Export CSV"
                  formatLabel="CSV"
                  onDetailed={() =>
                    void onExportYearCsv(sidebarYearId, yearOverview.yearLabel)
                  }
                  onRedacted={() =>
                    void onExportYearCsvRedacted(
                      sidebarYearId,
                      yearOverview.yearLabel,
                    )
                  }
                />
                <ExportPickerButton
                  label="Export JSON"
                  formatLabel="JSON"
                  onDetailed={() =>
                    void onExportYearJson(sidebarYearId, yearOverview.yearLabel)
                  }
                  onRedacted={() =>
                    void onExportYearJsonRedacted(
                      sidebarYearId,
                      yearOverview.yearLabel,
                    )
                  }
                />
                {sidebarYearId != null && (
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={() => void openDuplicateYearModal()}
                    title="Duplicate this year (custom destination)"
                  >
                    Duplicate year…
                  </button>
                )}
              </div>
              <YearOverviewView
                overview={yearOverview}
                onActivateMonth={(id) => void activateMonth(id)}
                yearEndNudge={
                  yearEndNudge
                    ? {
                        sourceLabel: yearEndNudge.sourceLabel,
                        nextLabel: yearEndNudge.nextLabel,
                      }
                    : null
                }
                onStartYearEndNudge={onStartYearEndNudge}
              />
            </>
          )}

          {/* The pre-split `overview` kind also had a third branch that
              rendered <WelcomeScreen /> on an empty workspace. With the
              scratch DB gone, bootstrap routes empties to `welcome`
              directly, so that fallback is unreachable and was removed. */}

          {view.kind === "year-overview" && !yearOverview && (
            <p className="muted month-loading-banner">Loading overview…</p>
          )}

          {view.kind === "reports" && (
            <ReportsView
              initial={reportsInitial}
              onInitialApplied={onReportsInitialApplied}
              monthRows={months}
            />
          )}

          {view.kind === "cross-year" && (
            <CrossYearView
              data={crossYear}
              loading={crossYearLoading}
              onJumpToYear={(id) => void enterYear(id)}
            />
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
              onEditRow={onEditRow}
              onDeleteRow={onDeleteRow}
              onOpenReorder={openReorderModal}
              onOpenLineYtd={(args) => {
                setYtdDrawer(args);
              }}
              onExportCsv={() => void onExportMonthCsv(monthView.monthId)}
              onExportJson={() => void onExportMonthJson(monthView.monthId)}
              onExportCsvRedacted={() =>
                void onExportMonthCsvRedacted(monthView.monthId)
              }
              onExportJsonRedacted={() =>
                void onExportMonthJsonRedacted(monthView.monthId)
              }
            />
          )}

          {view.kind === "month" && (!monthView || monthView.monthId !== view.monthId) && (
            <p className="muted month-loading-banner">Loading month…</p>
          )}
    </main>
      </div>

      <YtdSlideOver
        open={ytdDrawer !== null}
        lineKind={ytdDrawer?.lineKind ?? "expense"}
        year={ytdDrawer?.year ?? new Date().getFullYear()}
        report={ytdReport}
        loading={ytdLoading}
        onClose={() => setYtdDrawer(null)}
        onYearChange={(y) =>
          setYtdDrawer((d) => (d ? { ...d, year: y } : null))
        }
        onOpenFullReports={() => {
          if (!ytdDrawer) return;
          setReportsInitial({
            year: ytdDrawer.year,
            asOf: ytdDrawer.asOf,
            selected: [
              { lineKind: ytdDrawer.lineKind, lineIdentity: ytdDrawer.lineIdentity },
            ],
          });
          setYtdDrawer(null);
          setView({ kind: "reports" });
        }}
      />
    </div>
  );
}

