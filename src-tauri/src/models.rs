use serde::Serialize;

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
