import { invoke } from "@tauri-apps/api/core";
import type {
  AppSettings,
  CloudFolderProbe,
  CrossYearOverview,
  LibraryEntry,
  LineCalendarReport,
  LineRef,
  MonthRow,
  MonthView,
  MultiLineCalendarReport,
  WorkspaceLineCatalogEntry,
  WorkspaceMeta,
  YearOverview,
  YearRow,
} from "../../types";

// ---------------------------------------------------------------------------
// Query commands
// ---------------------------------------------------------------------------

export function getSettings(): Promise<AppSettings> {
  return invoke<AppSettings>("get_settings");
}

export function getDatabasePath(): Promise<string> {
  return invoke<string>("get_database_path");
}

export function hasOpenBudget(): Promise<boolean> {
  return invoke<boolean>("has_open_budget");
}

export function isDirty(): Promise<boolean> {
  return invoke<boolean>("is_dirty");
}

export function getWorkspaceMeta(): Promise<WorkspaceMeta> {
  return invoke<WorkspaceMeta>("get_workspace_meta");
}

export function listYears(): Promise<YearRow[]> {
  return invoke<YearRow[]>("list_years");
}

export function listMonths(): Promise<MonthRow[]> {
  return invoke<MonthRow[]>("list_months");
}

export function listMonthsForYear(yearId: number): Promise<MonthRow[]> {
  return invoke<MonthRow[]>("list_months_for_year", { yearId });
}

export function getMonthView(monthId: number): Promise<MonthView> {
  return invoke<MonthView>("get_month_view", { monthId });
}

export function getYearOverview(yearId: number | null): Promise<YearOverview> {
  return invoke<YearOverview>("get_year_overview", { yearId });
}

export function getCrossYearOverview(): Promise<CrossYearOverview> {
  return invoke<CrossYearOverview>("get_cross_year_overview");
}

export function listWorkspaceLineCatalog(): Promise<WorkspaceLineCatalogEntry[]> {
  return invoke<WorkspaceLineCatalogEntry[]>("list_workspace_line_catalog");
}

export function getLineCalendarReport(
  year: number,
  lineKind: string,
  lineIdentity: string,
  asOf: string | null,
): Promise<LineCalendarReport> {
  return invoke<LineCalendarReport>("get_line_calendar_report", {
    year,
    lineKind,
    lineIdentity,
    asOf,
  });
}

export function getMultiLineCalendarReport(
  year: number,
  lines: LineRef[],
  asOf: string | null,
): Promise<MultiLineCalendarReport> {
  return invoke<MultiLineCalendarReport>("get_multi_line_calendar_report", {
    year,
    lines,
    asOf,
  });
}

export function getLibraryIndex(): Promise<LibraryEntry[]> {
  return invoke<LibraryEntry[]>("get_library_index");
}

export function scanLibrary(): Promise<LibraryEntry[]> {
  return invoke<LibraryEntry[]>("scan_library");
}

export function encryptionSupported(): Promise<boolean> {
  return invoke<boolean>("encryption_supported");
}

export function workspaceIsEncrypted(path: string): Promise<boolean> {
  return invoke<boolean>("workspace_is_encrypted", { path });
}

export function getAutoSave(): Promise<boolean> {
  return invoke<boolean>("get_auto_save");
}

export function detectCloudFolders(): Promise<CloudFolderProbe[]> {
  return invoke<CloudFolderProbe[]>("detect_cloud_folders");
}

// ---------------------------------------------------------------------------
// Mutation commands
// ---------------------------------------------------------------------------

export function createYear(yearLabel: string): Promise<number> {
  return invoke<number>("create_year", { yearLabel });
}

export function renameYear(yearId: number, yearLabel: string): Promise<string> {
  return invoke<string>("rename_year", { yearId, yearLabel });
}

export function deleteYear(yearId: number): Promise<void> {
  return invoke<void>("delete_year", { yearId });
}

export function duplicateYear(
  sourceYearId: number,
  destYearLabel: string,
  mode: string,
  sourceMonthId: number | undefined,
): Promise<number> {
  return invoke<number>("duplicate_year", {
    sourceYearId,
    destYearLabel,
    mode,
    sourceMonthId: sourceMonthId ?? null,
  });
}

export function ensureYearMonths(yearId: number): Promise<number[]> {
  return invoke<number[]>("ensure_year_months", { yearId });
}

export function createYearWorkspace(
  yearLabel: string,
  scaffoldYearValue: number | undefined,
  reuseCurrentWindow: boolean | undefined,
): Promise<string> {
  return invoke<string>("create_year_workspace", {
    yearLabel,
    scaffoldYearValue: scaffoldYearValue ?? null,
    reuseCurrentWindow: reuseCurrentWindow ?? null,
  });
}

export function setIncomeLinePlanned(id: number, plannedCents: number): Promise<void> {
  return invoke<void>("set_income_line_planned", { id, plannedCents });
}

export function setExpenseLinePlanned(id: number, plannedCents: number): Promise<void> {
  return invoke<void>("set_expense_line_planned", { id, plannedCents });
}

export function addExpenseLine(
  bucketId: number,
  name: string,
  isNeutralTransfer: boolean,
  isSinkingFund: boolean,
): Promise<number> {
  return invoke<number>("add_expense_line", {
    bucketId,
    name,
    isNeutralTransfer,
    isSinkingFund,
  });
}

export function renameExpenseLine(id: number, name: string): Promise<void> {
  return invoke<void>("rename_expense_line", { id, name });
}

export function deleteExpenseLine(id: number): Promise<void> {
  return invoke<void>("delete_expense_line", { id });
}

export function updateExpenseLineFlags(
  lineId: number,
  isNeutralTransfer: boolean,
  isSinkingFund: boolean,
): Promise<void> {
  return invoke<void>("update_expense_line_flags", {
    lineId,
    isNeutralTransfer,
    isSinkingFund,
  });
}

export function addTransaction(
  expenseLineId: number,
  payee: string,
  amountCents: number,
  occurredOn: string | null,
): Promise<number> {
  return invoke<number>("add_transaction", {
    expenseLineId,
    payee,
    amountCents,
    occurredOn,
  });
}

export function deleteTransaction(id: number): Promise<void> {
  return invoke<void>("delete_transaction", { id });
}

export function addIncomeEntry(
  incomeLineId: number,
  label: string,
  amountCents: number,
  receivedOn: string | null,
): Promise<number> {
  return invoke<number>("add_income_entry", {
    incomeLineId,
    label,
    amountCents,
    receivedOn,
  });
}

export function deleteIncomeEntry(id: number): Promise<void> {
  return invoke<void>("delete_income_entry", { id });
}

export function reorderBuckets(monthId: number, orderedIds: number[]): Promise<void> {
  return invoke<void>("reorder_buckets", { monthId, orderedIds });
}

export function saveBudgetAs(targetPath: string): Promise<string> {
  return invoke<string>("save_budget_as", { targetPath });
}

export function saveSnapshot(): Promise<string> {
  return invoke<string>("save_snapshot");
}

export function markClean(): Promise<void> {
  return invoke<void>("mark_clean");
}

export function setAutoSave(enabled: boolean): Promise<void> {
  return invoke<void>("set_auto_save", { enabled });
}

export function setMenuContext(hasBudget: boolean, onLibrary: boolean): Promise<void> {
  return invoke<void>("set_menu_context", { hasBudget, onLibrary });
}

export function setSidebarCollapsed(collapsed: boolean): Promise<void> {
  return invoke<void>("set_sidebar_collapsed", { collapsed });
}

export function setDefaultFolder(newPath: string): Promise<void> {
  return invoke<void>("set_default_folder", { newPath });
}

export function setWorkspaceDisplayName(
  displayName: string | null,
): Promise<string | null> {
  return invoke<string | null>("set_workspace_display_name", { displayName });
}

export function adoptDefaultFolder(
  newPath: string,
  migrate: boolean,
): Promise<[number, string]> {
  return invoke<[number, string]>("adopt_default_folder", { newPath, migrate });
}

export function openBudgetInNewWindow(filePath: string): Promise<void> {
  return invoke<void>("open_budget_in_new_window", { filePath });
}

export function openBudgetInCurrentWindow(filePath: string): Promise<void> {
  return invoke<void>("open_budget_in_current_window", { filePath });
}

export function importWorkspace(sourcePath: string): Promise<string> {
  return invoke<string>("import_workspace", { sourcePath });
}

export function renameWorkspaceFile(path: string, newName: string): Promise<string> {
  return invoke<string>("rename_workspace_file", { path, newName });
}

export function deleteWorkspaceFile(path: string): Promise<void> {
  return invoke<void>("delete_workspace_file", { path });
}

export function revealDefaultFolder(): Promise<string> {
  return invoke<string>("reveal_default_folder");
}

export function unlockWorkspace(password: string): Promise<boolean> {
  return invoke<boolean>("unlock_workspace", { password });
}

export function lockWorkspace(): Promise<void> {
  return invoke<void>("lock_workspace");
}

export function encryptWorkspace(password: string): Promise<void> {
  return invoke<void>("encrypt_workspace", { password });
}

export function changeWorkspacePassword(newPassword: string): Promise<void> {
  return invoke<void>("change_workspace_password", { newPassword });
}

export function decryptWorkspace(): Promise<void> {
  return invoke<void>("decrypt_workspace");
}

// ---------------------------------------------------------------------------
// Export commands
// ---------------------------------------------------------------------------

export function exportCsvData(): Promise<string> {
  return invoke<string>("export_csv_data");
}

export function exportWorkspaceJson(): Promise<string> {
  return invoke<string>("export_workspace_json");
}

export function exportMonthCsv(monthId: number): Promise<string> {
  return invoke<string>("export_month_csv", { monthId });
}

export function exportMonthJson(monthId: number): Promise<string> {
  return invoke<string>("export_month_json", { monthId });
}

export function exportWorkspaceCsvRedacted(): Promise<string> {
  return invoke<string>("export_workspace_csv_redacted");
}

export function exportWorkspaceJsonRedacted(): Promise<string> {
  return invoke<string>("export_workspace_json_redacted");
}

export function exportYearCsvRedacted(yearId: number): Promise<string> {
  return invoke<string>("export_year_csv_redacted", { yearId });
}

export function exportYearJsonRedacted(yearId: number): Promise<string> {
  return invoke<string>("export_year_json_redacted", { yearId });
}

export function exportMonthCsvRedacted(monthId: number): Promise<string> {
  return invoke<string>("export_month_csv_redacted", { monthId });
}

export function exportMonthJsonRedacted(monthId: number): Promise<string> {
  return invoke<string>("export_month_json_redacted", { monthId });
}
