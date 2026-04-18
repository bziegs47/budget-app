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
    pub rollover_in_cents: i64,
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
    pub rollover_in_cents: i64,
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
    pub encrypted: bool,
}
