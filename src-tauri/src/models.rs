use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonthRow {
    pub id: i64,
    /// Legacy slug / storage key (YYYY-MM or start__end)
    pub year_month: String,
    pub period_start: String,
    pub period_end: String,
    pub tab_label: String,
    /// FK into `years.id`. Optional only because legacy data may still be in flight,
    /// but in practice every row returned by `list_months` will have this set.
    pub year_id: Option<i64>,
    /// Label of the parent year (e.g. "2026"). Empty if the month is orphaned.
    pub year_label: String,
    /// 1-12 for clean calendar months; `None` for any leftover non-calendar
    /// period that survived migration without snapping.
    pub calendar_month: Option<i32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YearRow {
    pub id: i64,
    pub year_label: String,
    pub sort_order: i32,
    pub month_count: i64,
    /// Months that have at least one income entry or one non-neutral transaction.
    /// Mirrors the "months tracked" metric shown on the year overview screen so
    /// the sidebar/landing list reflect actual activity rather than the always-12
    /// scaffolded count.
    pub tracked_month_count: i64,
    pub income_actual_cents: i64,
    pub expense_net_actual_cents: i64,
    pub net_actual_cents: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IncomeEntryDto {
    pub id: i64,
    pub income_line_id: i64,
    pub received_on: Option<String>,
    pub label: String,
    pub amount_cents: i64,
    pub sort_order: i32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IncomeLineDto {
    pub id: i64,
    pub line_identity: String,
    pub name: String,
    pub sort_order: i32,
    pub planned_cents: i64,
    pub actual_cents: i64,
    pub variance_cents: i64,
    pub entries: Vec<IncomeEntryDto>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionDto {
    pub id: i64,
    pub expense_line_id: i64,
    pub occurred_on: Option<String>,
    pub payee: String,
    pub amount_cents: i64,
    pub sort_order: i32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpenseLineDto {
    pub id: i64,
    pub bucket_id: i64,
    pub line_identity: String,
    pub name: String,
    pub sort_order: i32,
    pub planned_cents: i64,
    pub is_neutral_transfer: bool,
    pub is_sinking_fund: bool,
    pub annual_estimate_cents: Option<i64>,
    pub due_month_hint: Option<i32>,
    pub actual_cents: i64,
    pub variance_cents: i64,
    pub transactions: Vec<TransactionDto>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpenseBucketDto {
    pub id: i64,
    pub name: String,
    pub sort_order: i32,
    pub lines: Vec<ExpenseLineDto>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonthSummary {
    pub income_planned_cents: i64,
    pub income_actual_cents: i64,
    pub income_variance_cents: i64,
    pub expense_net_planned_cents: i64,
    pub expense_net_actual_cents: i64,
    pub expense_net_variance_cents: i64,
    pub neutral_expense_planned_cents: i64,
    pub neutral_expense_actual_cents: i64,
    pub net_planned_cents: i64,
    pub net_actual_cents: i64,
    pub net_variance_cents: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YtdTotals {
    pub year: i32,
    /// Display string for the active period in YTD context (tab label)
    pub through_month: String,
    pub income_actual_cents: i64,
    pub expense_net_actual_cents: i64,
    pub net_actual_cents: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonthView {
    pub year_month: String,
    pub month_id: i64,
    pub period_start: String,
    pub period_end: String,
    pub tab_label: String,
    pub income_lines: Vec<IncomeLineDto>,
    pub expense_buckets: Vec<ExpenseBucketDto>,
    pub summary: MonthSummary,
    /// YTD totals aggregated by **budget period** (which periods have closed up to this month).
    pub ytd: YtdTotals,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceMeta {
    pub year_label: String,
    pub display_name: Option<String>,
    pub file_uuid: String,
    pub schema_version: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BucketRollup {
    pub name: String,
    pub planned_cents: i64,
    pub actual_cents: i64,
    pub variance_cents: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonthSummaryRow {
    pub month_id: i64,
    pub label: String,
    pub period_start: String,
    pub period_end: String,
    pub income_planned_cents: i64,
    pub income_actual_cents: i64,
    pub expense_net_planned_cents: i64,
    pub expense_net_actual_cents: i64,
    pub net_planned_cents: i64,
    pub net_actual_cents: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YearOverview {
    pub year_label: String,
    pub income_planned_cents: i64,
    pub income_actual_cents: i64,
    pub expense_net_planned_cents: i64,
    pub expense_net_actual_cents: i64,
    pub net_planned_cents: i64,
    pub net_actual_cents: i64,
    pub buckets: Vec<BucketRollup>,
    pub months: Vec<MonthSummaryRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentFile {
    pub path: String,
    pub year_label: String,
    pub last_opened_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub default_folder: Option<String>,
    pub recent_files: Vec<RecentFile>,
    pub sidebar_collapsed: bool,
}

/// One logical income or expense line across the workspace (for reports / YTD pickers).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceLineCatalogEntry {
    /// `"income"` or `"expense"`
    pub line_kind: String,
    pub line_identity: String,
    pub display_name: String,
    /// Expense bucket name from the latest period that contains this line (informational).
    pub bucket_name: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarMonthBucket {
    pub month: i32,
    pub total_cents: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarReportEntry {
    pub id: i64,
    /// ISO date or null
    pub occurred_on: Option<String>,
    pub label: String,
    pub amount_cents: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LineCalendarReport {
    pub year: i32,
    pub line_kind: String,
    pub line_identity: String,
    pub display_name: String,
    pub range_start: String,
    pub range_end: String,
    pub total_cents: i64,
    pub monthly: Vec<CalendarMonthBucket>,
    pub entries: Vec<CalendarReportEntry>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MultiLineCalendarRow {
    pub line_kind: String,
    pub line_identity: String,
    pub display_name: String,
    pub total_cents: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MultiLineCalendarReport {
    pub year: i32,
    pub range_start: String,
    pub range_end: String,
    pub rows: Vec<MultiLineCalendarRow>,
    pub combined_monthly: Vec<CalendarMonthBucket>,
    pub combined_total_cents: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LineRef {
    pub line_kind: String,
    pub line_identity: String,
}

/// Per-year column header in a cross-year matrix. Grouped totals live alongside
/// the column so the frontend can render a "Year totals" footer without having
/// to re-aggregate the per-row cells.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrossYearColumn {
    pub year_id: i64,
    pub year_label: String,
    pub income_planned_cents: i64,
    pub income_actual_cents: i64,
    pub expense_planned_cents: i64,
    pub expense_actual_cents: i64,
    pub net_planned_cents: i64,
    pub net_actual_cents: i64,
    /// Months with at least one income entry or one non-neutral transaction.
    /// Mirrors the same definition `list_years` and the year-overview header
    /// already use, so the cross-year view never disagrees with them.
    pub tracked_month_count: i64,
}

/// One cell of a cross-year matrix. Both values are `0` when the row didn't
/// touch that year — the frontend uses that to render an em-dash placeholder.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrossYearCell {
    pub planned_cents: i64,
    pub actual_cents: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrossYearBucketRow {
    pub bucket_name: String,
    /// Aligned 1-to-1 with the parent `CrossYearOverview.columns`.
    pub cells: Vec<CrossYearCell>,
    pub total_planned_cents: i64,
    pub total_actual_cents: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrossYearLineRow {
    /// `"income"` or `"expense"`
    pub line_kind: String,
    pub line_identity: String,
    pub display_name: String,
    /// Only set for expense lines, sourced from the latest period that contains
    /// the line (informational; see `list_workspace_line_catalog`).
    pub bucket_name: Option<String>,
    /// Aligned 1-to-1 with the parent `CrossYearOverview.columns`.
    pub cells: Vec<CrossYearCell>,
    pub total_planned_cents: i64,
    pub total_actual_cents: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrossYearOverview {
    pub columns: Vec<CrossYearColumn>,
    /// Expense buckets, grouped by name across years, sorted by display name.
    pub bucket_rows: Vec<CrossYearBucketRow>,
    /// Income + expense lines grouped by `line_identity`. Income rows come
    /// first, then expense rows; both sections are alphabetised within
    /// themselves so the matrix reads top-down naturally.
    pub line_rows: Vec<CrossYearLineRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryEntry {
    pub path: String,
    pub year_label: String,
    pub display_name: Option<String>,
    pub file_uuid: String,
    pub last_modified: String,
    pub size_bytes: u64,
    pub income_actual_cents: i64,
    pub expense_net_actual_cents: i64,
    pub net_actual_cents: i64,
    pub month_count: i64,
    /// Months with at least one income entry or one non-neutral
    /// transaction. Mirrors the per-year "months tracked" metric and
    /// drives the same string on the library tile so a freshly
    /// scaffolded budget reads "0 months tracked" instead of "24
    /// months tracked".
    #[serde(default)]
    pub tracked_month_count: i64,
    /// Distinct calendar years stored in this budget, sorted descending
    /// (most recent first). Empty for legacy / encrypted entries.
    #[serde(default)]
    pub year_labels: Vec<String>,
    /// Convenience count to avoid an extra `.length` plumb in the UI.
    /// Always equal to `year_labels.len()` when `year_labels` is set.
    #[serde(default)]
    pub year_count: i64,
    pub encrypted: bool,
    /// Cloud provider derived from the path prefix (e.g. "iCloud Drive",
    /// "Google Drive"). `None` when the file lives in a local-only folder.
    #[serde(default)]
    pub provider: Option<String>,
    /// `true` when the basename matches a cloud-sync conflict pattern
    /// (e.g. `Foo (conflicted copy 2024-...).mimo`). Pure path heuristic.
    #[serde(default)]
    pub is_conflict_copy: bool,
    /// `workspace_meta.updated_at` snapshot. Distinct from the file mtime
    /// because cloud syncs can touch the file without the user editing it.
    #[serde(default)]
    pub last_edited_at: Option<String>,
}

/// Probe result for a well-known cloud-storage folder. Used by the
/// Preferences > General "detect cloud folders" UI so the user can adopt
/// one with a single click without manually picking a directory.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudFolderProbe {
    pub provider: String,
    pub path: String,
    pub exists: bool,
    pub is_default: bool,
    /// Number of `.mimo` files visible in the candidate folder
    /// (one-level scan). Helps the user pick the folder that already has
    /// their data when several providers are installed.
    pub workspace_count: i64,
}
