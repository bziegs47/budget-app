use crate::db;
use crate::period;
use chrono::{Datelike, Local, NaiveDate};
use crate::models::{
    BucketRollup, CalendarMonthBucket, CalendarReportEntry, CrossYearBucketRow, CrossYearCell,
    CrossYearColumn, CrossYearLineRow, CrossYearOverview, ExpenseBucketDto, ExpenseLineDto,
    IncomeEntryDto, IncomeLineDto, LineCalendarReport, LineRef, MonthRow, MonthSummary,
    MonthSummaryRow, MonthView, MultiLineCalendarReport, MultiLineCalendarRow, TransactionDto,
    WorkspaceLineCatalogEntry, WorkspaceMeta, YearOverview, YearRow, YtdTotals,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::collections::HashMap;
use uuid::Uuid;

fn err(e: impl ToString) -> String {
    e.to_string()
}

pub fn list_months(conn: &Connection) -> Result<Vec<MonthRow>, String> {
    list_months_filtered(conn, None)
}

pub fn list_months_for_year(conn: &Connection, year_id: i64) -> Result<Vec<MonthRow>, String> {
    list_months_filtered(conn, Some(year_id))
}

fn list_months_filtered(
    conn: &Connection,
    year_id: Option<i64>,
) -> Result<Vec<MonthRow>, String> {
    let sql = match year_id {
        Some(_) => r#"
            SELECT bm.id, bm.year_month, bm.period_start, bm.period_end,
                   bm.year_id, COALESCE(y.year_label, '')
            FROM budget_months bm
            LEFT JOIN years y ON y.id = bm.year_id
            WHERE bm.year_id = ?1
            ORDER BY bm.period_start, bm.id
        "#,
        None => r#"
            SELECT bm.id, bm.year_month, bm.period_start, bm.period_end,
                   bm.year_id, COALESCE(y.year_label, '')
            FROM budget_months bm
            LEFT JOIN years y ON y.id = bm.year_id
            ORDER BY bm.period_start, bm.id
        "#,
    };
    let mut stmt = conn.prepare(sql).map_err(err)?;
    let mapper = |r: &rusqlite::Row| -> rusqlite::Result<MonthRow> {
        let ps: String = r.get(2)?;
        let pe: String = r.get(3)?;
        let tab_label = period::format_tab_label(&ps, &pe);
        let calendar_month = match (period::parse_iso(&ps), period::parse_iso(&pe)) {
            (Ok(s), Ok(e)) if period::is_full_calendar_month(s, e) => Some(s.month() as i32),
            _ => None,
        };
        Ok(MonthRow {
            id: r.get(0)?,
            year_month: r.get(1)?,
            period_start: ps,
            period_end: pe,
            tab_label,
            year_id: r.get::<_, Option<i64>>(4)?,
            year_label: r.get(5)?,
            calendar_month,
        })
    };
    let rows: Vec<MonthRow> = match year_id {
        Some(y) => stmt
            .query_map(params![y], mapper)
            .map_err(err)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(err)?,
        None => stmt
            .query_map([], mapper)
            .map_err(err)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(err)?,
    };
    Ok(rows)
}

fn line_actual_expense(conn: &Connection, expense_line_id: i64) -> Result<i64, String> {
    let v: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(amount_cents),0) FROM transactions WHERE expense_line_id = ?1",
            [expense_line_id],
            |r| r.get(0),
        )
        .map_err(err)?;
    Ok(v)
}

fn line_actual_income(conn: &Connection, income_line_id: i64) -> Result<i64, String> {
    let v: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(amount_cents),0) FROM income_entries WHERE income_line_id = ?1",
            [income_line_id],
            |r| r.get(0),
        )
        .map_err(err)?;
    Ok(v)
}

fn compute_ytd(conn: &Connection, active_period_end: &str) -> Result<YtdTotals, String> {
    let pe = period::parse_iso(active_period_end)?;
    let y = pe.year();
    let year_prefix = format!("{y:04}");

    let income: i64 = conn
        .query_row(
            r#"
            SELECT COALESCE(SUM(ie.amount_cents),0)
            FROM income_entries ie
            JOIN income_lines il ON il.id = ie.income_line_id
            JOIN budget_months bm ON bm.id = il.month_id
            WHERE strftime('%Y', bm.period_end) = ?1
              AND date(bm.period_end) <= date(?2)
            "#,
            params![year_prefix, active_period_end],
            |r| r.get(0),
        )
        .map_err(err)?;

    let expense_net: i64 = conn
        .query_row(
            r#"
            SELECT COALESCE(SUM(t.amount_cents),0)
            FROM transactions t
            JOIN expense_lines el ON el.id = t.expense_line_id
            JOIN expense_buckets eb ON eb.id = el.bucket_id
            JOIN budget_months bm ON bm.id = eb.month_id
            WHERE el.is_neutral_transfer = 0
              AND strftime('%Y', bm.period_end) = ?1
              AND date(bm.period_end) <= date(?2)
            "#,
            params![year_prefix, active_period_end],
            |r| r.get(0),
        )
        .map_err(err)?;

    Ok(YtdTotals {
        year: y,
        through_month: active_period_end.to_string(),
        income_actual_cents: income,
        expense_net_actual_cents: expense_net,
        net_actual_cents: income - expense_net,
    })
}

fn parse_ym(s: &str) -> Result<(i32, i32), String> {
    let parts: Vec<&str> = s.split('-').collect();
    if parts.len() != 2 {
        return Err("Invalid year-month (use YYYY-MM)".into());
    }
    let y: i32 = parts[0].parse().map_err(err)?;
    let m: i32 = parts[1].parse().map_err(err)?;
    if !(1..=12).contains(&m) {
        return Err("Month must be 01-12".into());
    }
    Ok((y, m))
}

pub fn get_month_view(conn: &Connection, month_id: i64) -> Result<MonthView, String> {
    let (year_month, period_start, period_end): (String, String, String) = conn
        .query_row(
            "SELECT year_month, period_start, period_end FROM budget_months WHERE id = ?1",
            [month_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(|_| format!("No budget period for id {month_id}"))?;

    let tab_label = period::format_tab_label(&period_start, &period_end);
    let mut ytd = compute_ytd(conn, &period_end)?;
    ytd.through_month = tab_label.clone();

    let mut income_stmt = conn
        .prepare(
            r#"
        SELECT id, line_identity, sort_order, name, planned_cents
        FROM income_lines WHERE month_id = ?1 ORDER BY sort_order
        "#,
        )
        .map_err(err)?;
    let income_rows = income_stmt
        .query_map([month_id], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, i32>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, i64>(4)?,
            ))
        })
        .map_err(err)?;

    let mut income_lines: Vec<IncomeLineDto> = Vec::new();
    for row in income_rows {
        let (id, line_identity, sort_order, name, planned_cents) = row.map_err(err)?;
        let actual_cents = line_actual_income(conn, id)?;
        let variance_cents = actual_cents - planned_cents;

        let mut es = conn
            .prepare(
                "SELECT id, income_line_id, received_on, label, amount_cents, sort_order FROM income_entries WHERE income_line_id = ?1 ORDER BY sort_order, id",
            )
            .map_err(err)?;
        let entries = es
            .query_map([id], |r| {
                Ok(IncomeEntryDto {
                    id: r.get(0)?,
                    income_line_id: r.get(1)?,
                    received_on: r.get(2)?,
                    label: r.get(3)?,
                    amount_cents: r.get(4)?,
                    sort_order: r.get(5)?,
                })
            })
            .map_err(err)?;
        let entries: Vec<IncomeEntryDto> = entries.collect::<Result<Vec<_>, _>>().map_err(err)?;

        income_lines.push(IncomeLineDto {
            id,
            line_identity,
            name,
            sort_order,
            planned_cents,
            actual_cents,
            variance_cents,
            entries,
        });
    }

    let mut buckets_stmt = conn
        .prepare(
            "SELECT id, name, sort_order FROM expense_buckets WHERE month_id = ?1 ORDER BY sort_order, id",
        )
        .map_err(err)?;
    let bucket_rows = buckets_stmt
        .query_map([month_id], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, i32>(2)?))
        })
        .map_err(err)?;

    let mut expense_buckets: Vec<ExpenseBucketDto> = Vec::new();
    for b in bucket_rows {
        let (bucket_id, bname, bsort) = b.map_err(err)?;
        let mut ls = conn
            .prepare(
                r#"
            SELECT id, line_identity, sort_order, name, planned_cents,
                   is_neutral_transfer, is_sinking_fund, annual_estimate_cents, due_month_hint
            FROM expense_lines WHERE bucket_id = ?1 ORDER BY sort_order, id
            "#,
            )
            .map_err(err)?;
        let line_rows = ls
            .query_map([bucket_id], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, i32>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, i64>(4)?,
                    r.get::<_, i64>(5)?,
                    r.get::<_, i64>(6)?,
                    r.get::<_, Option<i64>>(7)?,
                    r.get::<_, Option<i32>>(8)?,
                ))
            })
            .map_err(err)?;

        let mut lines: Vec<ExpenseLineDto> = Vec::new();
        for lr in line_rows {
            let (
                id,
                line_identity,
                sort_order,
                name,
                planned_cents,
                is_neutral,
                is_sinking,
                annual_estimate_cents,
                due_month_hint,
            ) = lr.map_err(err)?;
            let actual_cents = line_actual_expense(conn, id)?;
            let variance_cents = planned_cents - actual_cents;

            let mut ts = conn
                .prepare(
                    "SELECT id, expense_line_id, occurred_on, payee, amount_cents, sort_order FROM transactions WHERE expense_line_id = ?1 ORDER BY sort_order, id",
                )
                .map_err(err)?;
            let txs = ts
                .query_map([id], |r| {
                    Ok(TransactionDto {
                        id: r.get(0)?,
                        expense_line_id: r.get(1)?,
                        occurred_on: r.get(2)?,
                        payee: r.get(3)?,
                        amount_cents: r.get(4)?,
                        sort_order: r.get(5)?,
                    })
                })
                .map_err(err)?;
            let transactions: Vec<TransactionDto> =
                txs.collect::<Result<Vec<_>, _>>().map_err(err)?;

            lines.push(ExpenseLineDto {
                id,
                bucket_id,
                line_identity,
                name,
                sort_order,
                planned_cents,
                is_neutral_transfer: is_neutral != 0,
                is_sinking_fund: is_sinking != 0,
                annual_estimate_cents,
                due_month_hint,
                actual_cents,
                variance_cents,
                transactions,
            });
        }

        expense_buckets.push(ExpenseBucketDto {
            id: bucket_id,
            name: bname,
            sort_order: bsort,
            lines,
        });
    }

    let mut income_planned: i64 = 0;
    let mut income_actual: i64 = 0;
    for l in &income_lines {
        income_planned += l.planned_cents;
        income_actual += l.actual_cents;
    }
    let income_variance = income_actual - income_planned;

    let mut expense_net_planned: i64 = 0;
    let mut expense_net_actual: i64 = 0;
    let mut neutral_planned: i64 = 0;
    let mut neutral_actual: i64 = 0;
    for b in &expense_buckets {
        for l in &b.lines {
            if l.is_neutral_transfer {
                neutral_planned += l.planned_cents;
                neutral_actual += l.actual_cents;
            } else {
                expense_net_planned += l.planned_cents;
                expense_net_actual += l.actual_cents;
            }
        }
    }
    let expense_net_variance = expense_net_planned - expense_net_actual;
    let net_planned = income_planned - expense_net_planned;
    let net_actual = income_actual - expense_net_actual;
    let net_variance = net_planned - net_actual;

    let summary = MonthSummary {
        income_planned_cents: income_planned,
        income_actual_cents: income_actual,
        income_variance_cents: income_variance,
        expense_net_planned_cents: expense_net_planned,
        expense_net_actual_cents: expense_net_actual,
        expense_net_variance_cents: expense_net_variance,
        neutral_expense_planned_cents: neutral_planned,
        neutral_expense_actual_cents: neutral_actual,
        net_planned_cents: net_planned,
        net_actual_cents: net_actual,
        net_variance_cents: net_variance,
    };

    Ok(MonthView {
        year_month,
        month_id,
        period_start,
        period_end,
        tab_label,
        income_lines,
        expense_buckets,
        summary,
        ytd,
    })
}

pub fn ensure_month(conn: &mut Connection, year_month: &str) -> Result<i64, String> {
    let (y, m) = parse_ym(year_month)?;
    if let Some(id) = db::month_id_for(conn, year_month).map_err(err)? {
        return Ok(id);
    }
    let (ps, pe) = period::full_month_bounds(y, m as u32).map_err(err)?;
    let year_id = ensure_year_row(conn, &format!("{y:04}"))?;
    conn.execute(
        "INSERT INTO budget_months (year_month, period_start, period_end, year_id) VALUES (?1, ?2, ?3, ?4)",
        params![year_month, ps, pe, year_id],
    )
    .map_err(err)?;
    let id = conn.last_insert_rowid();
    seed_month(conn, id)?;
    Ok(id)
}

/// Inserts (or finds) a `years` row with the given label and returns its id.
/// Uses the numeric value of the label (when parseable) as `sort_order` so
/// 2025 sorts before 2026 even when labels are typed in arbitrary order.
fn ensure_year_row(conn: &Connection, year_label: &str) -> Result<i64, String> {
    let label = year_label.trim();
    if label.is_empty() {
        return Err("Year label cannot be empty".into());
    }
    if let Some(id) = conn
        .query_row(
            "SELECT id FROM years WHERE year_label = ?1",
            params![label],
            |r| r.get::<_, i64>(0),
        )
        .optional()
        .map_err(err)?
    {
        return Ok(id);
    }
    let sort_order: i32 = label.parse::<i32>().unwrap_or(0);
    conn.execute(
        "INSERT INTO years (year_label, sort_order) VALUES (?1, ?2)",
        params![label, sort_order],
    )
    .map_err(err)?;
    Ok(conn.last_insert_rowid())
}

fn seed_month(conn: &mut Connection, month_id: i64) -> Result<(), String> {
    let tx = conn.transaction().map_err(err)?;

    let income_seed = vec!["Wages", "Interest & dividends", "Other income"];
    for (i, name) in income_seed.iter().enumerate() {
        let uid = Uuid::new_v4().to_string();
        tx.execute(
            "INSERT INTO income_lines (month_id, line_identity, sort_order, name, planned_cents) VALUES (?1,?2,?3,?4,0)",
            params![month_id, uid, i as i32, name],
        )
        .map_err(err)?;
    }

    let buckets: Vec<(&str, i32, Vec<(&str, bool, bool, Option<i64>)>)> = vec![
        (
            "Home expenses",
            0,
            vec![
                ("Rent / mortgage", false, false, None),
                ("Utilities", false, false, None),
                ("Maintenance", false, false, None),
            ],
        ),
        (
            "Transportation",
            1,
            vec![
                ("Fuel", false, false, None),
                ("Insurance", false, false, None),
                ("Maintenance / repairs", false, false, None),
            ],
        ),
        (
            "Health",
            2,
            vec![
                ("Premiums", false, false, None),
                ("Out of pocket", false, false, None),
            ],
        ),
        (
            "Charity / gifts",
            3,
            vec![("Donations", false, false, None)],
        ),
        (
            "Subscriptions",
            4,
            vec![("Streaming & apps", false, false, None)],
        ),
        (
            "Daily living",
            5,
            vec![
                ("Groceries", false, false, None),
                ("Household supplies", false, false, None),
            ],
        ),
        (
            "Entertainment",
            6,
            vec![("Dining out & fun", false, false, None)],
        ),
        (
            "Savings",
            7,
            vec![("Emergency fund", false, false, None)],
        ),
        (
            "Obligations",
            8,
            vec![
                ("Student / other loans", false, false, None),
                ("Taxes", false, false, None),
                ("Credit card payment (tracking)", true, false, None),
            ],
        ),
        (
            "Irregular / sinking",
            9,
            vec![
                ("Gifts & travel", false, true, None),
                ("Annual subscriptions & renewals", false, true, Some(0)),
            ],
        ),
        (
            "Miscellaneous",
            10,
            vec![("Other", false, false, None)],
        ),
    ];

    for (bname, bsort, lines) in buckets {
        tx.execute(
            "INSERT INTO expense_buckets (month_id, name, sort_order) VALUES (?1, ?2, ?3)",
            params![month_id, bname, bsort],
        )
        .map_err(err)?;
        let bid = tx.last_insert_rowid();
        for (i, (lname, neutral, sinking, annual)) in lines.iter().enumerate() {
            let uid = Uuid::new_v4().to_string();
            tx.execute(
                r#"INSERT INTO expense_lines (
                    bucket_id, line_identity, sort_order, name, planned_cents,
                    is_neutral_transfer, is_sinking_fund, annual_estimate_cents, due_month_hint
                ) VALUES (?1,?2,?3,?4,0,?5,?6,?7,NULL)"#,
                params![
                    bid,
                    uid,
                    i as i32,
                    lname,
                    if *neutral { 1 } else { 0 },
                    if *sinking { 1 } else { 0 },
                    annual
                ],
            )
            .map_err(err)?;
        }
    }

    tx.commit().map_err(err)?;
    Ok(())
}

pub fn set_income_line_planned(conn: &Connection, id: i64, planned_cents: i64) -> Result<(), String> {
    conn.execute(
        "UPDATE income_lines SET planned_cents = ?1 WHERE id = ?2",
        params![planned_cents, id],
    )
    .map_err(err)?;
    Ok(())
}

pub fn set_expense_line_planned(conn: &Connection, id: i64, planned_cents: i64) -> Result<(), String> {
    conn.execute(
        "UPDATE expense_lines SET planned_cents = ?1 WHERE id = ?2",
        params![planned_cents, id],
    )
    .map_err(err)?;
    Ok(())
}

pub fn add_expense_line(
    conn: &Connection,
    bucket_id: i64,
    name: &str,
    is_neutral_transfer: bool,
    is_sinking_fund: bool,
) -> Result<i64, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Row name cannot be empty.".into());
    }
    let next_sort: i32 = conn
        .query_row(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM expense_lines WHERE bucket_id = ?1",
            [bucket_id],
            |r| r.get(0),
        )
        .map_err(err)?;
    let uid = Uuid::new_v4().to_string();
    conn.execute(
        r#"INSERT INTO expense_lines (
            bucket_id, line_identity, sort_order, name, planned_cents,
            is_neutral_transfer, is_sinking_fund, annual_estimate_cents, due_month_hint
        ) VALUES (?1, ?2, ?3, ?4, 0, ?5, ?6, NULL, NULL)"#,
        params![
            bucket_id,
            uid,
            next_sort,
            trimmed,
            if is_neutral_transfer { 1 } else { 0 },
            if is_sinking_fund { 1 } else { 0 },
        ],
    )
    .map_err(err)?;
    Ok(conn.last_insert_rowid())
}

pub fn update_expense_line_flags(
    conn: &Connection,
    id: i64,
    is_neutral_transfer: bool,
    is_sinking_fund: bool,
) -> Result<(), String> {
    conn.execute(
        "UPDATE expense_lines SET is_neutral_transfer = ?1, is_sinking_fund = ?2 WHERE id = ?3",
        params![
            if is_neutral_transfer { 1 } else { 0 },
            if is_sinking_fund { 1 } else { 0 },
            id,
        ],
    )
    .map_err(err)?;
    Ok(())
}

pub fn rename_expense_line(conn: &Connection, id: i64, name: &str) -> Result<(), String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Row name cannot be empty.".into());
    }
    conn.execute(
        "UPDATE expense_lines SET name = ?1 WHERE id = ?2",
        params![trimmed, id],
    )
    .map_err(err)?;
    Ok(())
}

pub fn delete_expense_line(conn: &Connection, id: i64) -> Result<(), String> {
    conn.execute("DELETE FROM expense_lines WHERE id = ?1", [id])
        .map_err(err)?;
    Ok(())
}

pub fn reorder_buckets(
    conn: &mut Connection,
    month_id: i64,
    ordered_ids: &[i64],
) -> Result<(), String> {
    let tx = conn.transaction().map_err(err)?;
    for (i, bid) in ordered_ids.iter().enumerate() {
        tx.execute(
            "UPDATE expense_buckets SET sort_order = ?1 WHERE id = ?2 AND month_id = ?3",
            params![i as i32, bid, month_id],
        )
        .map_err(err)?;
    }
    tx.commit().map_err(err)?;
    Ok(())
}

pub fn add_transaction(
    conn: &Connection,
    expense_line_id: i64,
    payee: String,
    amount_cents: i64,
    occurred_on: Option<String>,
) -> Result<i64, String> {
    let sort: i32 = conn
        .query_row(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM transactions WHERE expense_line_id = ?1",
            [expense_line_id],
            |r| r.get(0),
        )
        .map_err(err)?;
    conn.execute(
        "INSERT INTO transactions (expense_line_id, occurred_on, payee, amount_cents, sort_order) VALUES (?1,?2,?3,?4,?5)",
        params![expense_line_id, occurred_on, payee, amount_cents, sort],
    )
    .map_err(err)?;
    Ok(conn.last_insert_rowid())
}

pub fn delete_transaction(conn: &Connection, id: i64) -> Result<(), String> {
    conn.execute("DELETE FROM transactions WHERE id = ?1", [id])
        .map_err(err)?;
    Ok(())
}

pub fn add_income_entry(
    conn: &Connection,
    income_line_id: i64,
    label: String,
    amount_cents: i64,
    received_on: Option<String>,
) -> Result<i64, String> {
    let sort: i32 = conn
        .query_row(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM income_entries WHERE income_line_id = ?1",
            [income_line_id],
            |r| r.get(0),
        )
        .map_err(err)?;
    conn.execute(
        "INSERT INTO income_entries (income_line_id, received_on, label, amount_cents, sort_order) VALUES (?1,?2,?3,?4,?5)",
        params![income_line_id, received_on, label, amount_cents, sort],
    )
    .map_err(err)?;
    Ok(conn.last_insert_rowid())
}

pub fn delete_income_entry(conn: &Connection, id: i64) -> Result<(), String> {
    conn.execute("DELETE FROM income_entries WHERE id = ?1", [id])
        .map_err(err)?;
    Ok(())
}

/// Shared CSV generation for one or more months. The format is designed for
/// human consumption and spreadsheet import:
///
///   type,bucket,name,month,period,planned_cents,actual_cents
///
/// Lines come first (Income / Expense), then detail rows (Income Entry /
/// Transaction) underneath. The `id` column that was previously exposed is
/// dropped — internal DB rowids are meaningless outside the app.
fn cents_to_dollars(cents: i64) -> String {
    let sign = if cents < 0 { "-" } else { "" };
    let abs = cents.unsigned_abs();
    format!("{sign}{}.{:02}", abs / 100, abs % 100)
}

fn write_csv_for_months(conn: &Connection, months: &[MonthRow]) -> Result<String, String> {
    let mut w = String::new();
    append_csv_row(
        &mut w,
        &["type", "bucket", "name", "month", "period", "planned", "actual"],
    );

    for m in months {
        let slug = &m.year_month;
        let label = &m.tab_label;

        // ── Income lines ────────────────────────────────────────────────
        let mut stmt = conn
            .prepare(
                "SELECT id, name, planned_cents FROM income_lines WHERE month_id = ?1 ORDER BY sort_order",
            )
            .map_err(err)?;
        let rows = stmt
            .query_map([m.id], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, i64>(2)?,
                ))
            })
            .map_err(err)?;
        for r in rows {
            let (id, name, planned) = r.map_err(err)?;
            let actual = line_actual_income(conn, id)?;
            append_csv_row(
                &mut w,
                &[
                    "Income",
                    "",
                    &name,
                    label,
                    slug,
                    &cents_to_dollars(planned),
                    &cents_to_dollars(actual),
                ],
            );

            // Income entries (detail rows)
            let mut es = conn
                .prepare(
                    "SELECT label, amount_cents FROM income_entries WHERE income_line_id = ?1 ORDER BY sort_order, id",
                )
                .map_err(err)?;
            let entries = es
                .query_map([id], |r| {
                    Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
                })
                .map_err(err)?;
            for entry in entries {
                let (entry_label, amt) = entry.map_err(err)?;
                append_csv_row(
                    &mut w,
                    &["Income Entry", "", &entry_label, label, slug, "", &cents_to_dollars(amt)],
                );
            }
        }

        // ── Expense buckets & lines ─────────────────────────────────────
        let mut bs = conn
            .prepare(
                "SELECT id, name FROM expense_buckets WHERE month_id = ?1 ORDER BY sort_order, id",
            )
            .map_err(err)?;
        let bucket_rows = bs
            .query_map([m.id], |r| {
                Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
            })
            .map_err(err)?;
        let buckets: Vec<(i64, String)> = bucket_rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(err)?;

        for (bucket_id, bucket_name) in &buckets {
            let mut ls = conn
                .prepare(
                    "SELECT id, name, planned_cents FROM expense_lines WHERE bucket_id = ?1 ORDER BY sort_order, id",
                )
                .map_err(err)?;
            let lrows = ls
                .query_map([bucket_id], |r| {
                    Ok((
                        r.get::<_, i64>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, i64>(2)?,
                    ))
                })
                .map_err(err)?;
            for lr in lrows {
                let (line_id, line_name, planned) = lr.map_err(err)?;
                let actual = line_actual_expense(conn, line_id)?;
                append_csv_row(
                    &mut w,
                    &[
                        "Expense",
                        bucket_name,
                        &line_name,
                        label,
                        slug,
                        &cents_to_dollars(planned),
                        &cents_to_dollars(actual),
                    ],
                );

                // Transactions (detail rows)
                let mut ts = conn
                    .prepare(
                        "SELECT payee, amount_cents FROM transactions WHERE expense_line_id = ?1 ORDER BY sort_order, id",
                    )
                    .map_err(err)?;
                let txs = ts
                    .query_map([line_id], |r| {
                        Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
                    })
                    .map_err(err)?;
                for tx in txs {
                    let (payee, amt) = tx.map_err(err)?;
                    append_csv_row(
                        &mut w,
                        &[
                            "Transaction",
                            bucket_name,
                            &payee,
                            label,
                            slug,
                            "",
                            &cents_to_dollars(amt),
                        ],
                    );
                }
            }
        }
    }

    Ok(w)
}

/// Shared JSON generation for one or more months.
fn write_json_for_months(conn: &Connection, months: &[MonthRow]) -> Result<String, String> {
    let meta = get_workspace_meta(conn)?;
    let mut month_views: Vec<MonthView> = Vec::with_capacity(months.len());
    for m in months {
        month_views.push(get_month_view(conn, m.id)?);
    }
    let payload = serde_json::json!({
        "schemaVersion": meta.schema_version,
        "exportedAt": chrono::Utc::now().to_rfc3339(),
        "workspace": meta,
        "months": month_views,
    });
    serde_json::to_string_pretty(&payload).map_err(err)
}

pub fn export_csv(conn: &Connection) -> Result<String, String> {
    let months = list_months(conn)?;
    write_csv_for_months(conn, &months)
}

pub fn export_year_csv(conn: &Connection, year_id: i64) -> Result<String, String> {
    let months = list_months_for_year(conn, year_id)?;
    write_csv_for_months(conn, &months)
}

pub fn export_year_json(conn: &Connection, year_id: i64) -> Result<String, String> {
    let months = list_months_for_year(conn, year_id)?;
    write_json_for_months(conn, &months)
}

pub fn get_workspace_meta(conn: &Connection) -> Result<WorkspaceMeta, String> {
    conn.query_row(
        r#"SELECT year_label, display_name, file_uuid, schema_version, created_at, updated_at
           FROM workspace_meta WHERE id = 1"#,
        [],
        |r| {
            Ok(WorkspaceMeta {
                year_label: r.get(0)?,
                display_name: r.get(1)?,
                file_uuid: r.get(2)?,
                schema_version: r.get(3)?,
                created_at: r.get(4)?,
                updated_at: r.get(5)?,
            })
        },
    )
    .map_err(err)
}

pub fn set_workspace_year(conn: &Connection, year_label: &str) -> Result<(), String> {
    let trimmed = sanitize_year_label(year_label)?;
    conn.execute(
        "UPDATE workspace_meta SET year_label = ?1, updated_at = datetime('now') WHERE id = 1",
        params![trimmed],
    )
    .map_err(err)?;
    Ok(())
}

/// Stores a user-chosen display name on the workspace_meta row. Pass `None`
/// (or an all-whitespace string) to clear it. The display name is purely a UI
/// override — file rename / save-as flows continue to drive the basename — so
/// callers should treat this as cosmetic metadata.
pub fn set_workspace_display_name(
    conn: &Connection,
    display_name: Option<&str>,
) -> Result<Option<String>, String> {
    let cleaned = display_name
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    conn.execute(
        "UPDATE workspace_meta SET display_name = ?1, updated_at = datetime('now') WHERE id = 1",
        params![cleaned],
    )
    .map_err(err)?;
    Ok(cleaned)
}

pub fn sanitize_year_label(input: &str) -> Result<String, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("Year label cannot be empty".into());
    }
    // Strip filesystem-hostile characters; keep ASCII + spaces + simple punctuation.
    let cleaned: String = trimmed
        .chars()
        .filter(|c| {
            !matches!(
                c,
                '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\0'
            )
        })
        .collect();
    let cleaned = cleaned.trim().to_string();
    if cleaned.is_empty() {
        return Err("Year label cannot be only special characters".into());
    }
    if cleaned.len() > 64 {
        return Err("Year label is too long (max 64 characters)".into());
    }
    Ok(cleaned)
}

/// Returns every year row in the workspace with rolled-up actuals so the
/// sidebar can render a quick at-a-glance summary in the year list.
pub fn list_years(conn: &Connection) -> Result<Vec<YearRow>, String> {
    let mut stmt = conn
        .prepare(
            r#"
            SELECT y.id, y.year_label, y.sort_order,
                   (SELECT COUNT(*) FROM budget_months bm WHERE bm.year_id = y.id) AS month_count
            FROM years y
            ORDER BY y.sort_order, y.year_label
            "#,
        )
        .map_err(err)?;
    let rows: Vec<(i64, String, i32, i64)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;

    let mut out: Vec<YearRow> = Vec::with_capacity(rows.len());
    for (id, year_label, sort_order, month_count) in rows {
        let income_actual: i64 = conn
            .query_row(
                r#"
                SELECT COALESCE(SUM(ie.amount_cents), 0)
                FROM income_entries ie
                JOIN income_lines il ON il.id = ie.income_line_id
                JOIN budget_months bm ON bm.id = il.month_id
                WHERE bm.year_id = ?1
                "#,
                params![id],
                |r| r.get(0),
            )
            .map_err(err)?;
        let expense_net: i64 = conn
            .query_row(
                r#"
                SELECT COALESCE(SUM(t.amount_cents), 0)
                FROM transactions t
                JOIN expense_lines el ON el.id = t.expense_line_id
                JOIN expense_buckets eb ON eb.id = el.bucket_id
                JOIN budget_months bm ON bm.id = eb.month_id
                WHERE bm.year_id = ?1 AND el.is_neutral_transfer = 0
                "#,
                params![id],
                |r| r.get(0),
            )
            .map_err(err)?;
        // A month counts as "tracked" if any income entry exists OR any
        // non-neutral expense transaction exists for it. Same definition the
        // year overview header uses.
        let tracked_month_count: i64 = conn
            .query_row(
                r#"
                SELECT COUNT(*) FROM budget_months bm
                WHERE bm.year_id = ?1 AND (
                  EXISTS (
                    SELECT 1 FROM income_entries ie
                    JOIN income_lines il ON il.id = ie.income_line_id
                    WHERE il.month_id = bm.id
                  )
                  OR EXISTS (
                    SELECT 1 FROM transactions t
                    JOIN expense_lines el ON el.id = t.expense_line_id
                    JOIN expense_buckets eb ON eb.id = el.bucket_id
                    WHERE eb.month_id = bm.id AND el.is_neutral_transfer = 0
                  )
                )
                "#,
                params![id],
                |r| r.get(0),
            )
            .map_err(err)?;
        out.push(YearRow {
            id,
            year_label,
            sort_order,
            month_count,
            tracked_month_count,
            income_actual_cents: income_actual,
            expense_net_actual_cents: expense_net,
            net_actual_cents: income_actual - expense_net,
        });
    }
    Ok(out)
}

/// Validates a year label as a 4-digit year (1900-2999), creates the year row
/// if it doesn't exist, then ensures all 12 calendar months are present.
pub fn create_year(conn: &mut Connection, year_label: &str) -> Result<i64, String> {
    let year = parse_year_label(year_label)?;
    let label = format!("{year:04}");
    let year_id = ensure_year_row(conn, &label)?;
    ensure_year_months(conn, year_id)?;
    Ok(year_id)
}

pub fn rename_year(conn: &Connection, year_id: i64, year_label: &str) -> Result<String, String> {
    let year = parse_year_label(year_label)?;
    let label = format!("{year:04}");
    let conflict: Option<i64> = conn
        .query_row(
            "SELECT id FROM years WHERE year_label = ?1 AND id != ?2",
            params![label, year_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;
    if conflict.is_some() {
        return Err(format!("Year {label} already exists in this budget."));
    }
    let sort_order: i32 = label.parse::<i32>().unwrap_or(0);
    let updated = conn
        .execute(
            "UPDATE years SET year_label = ?1, sort_order = ?2 WHERE id = ?3",
            params![label, sort_order, year_id],
        )
        .map_err(err)?;
    if updated == 0 {
        return Err("Year not found".into());
    }
    // Re-stamp budget_months.year_month so the slug stays in sync with the new year.
    let months: Vec<(i64, String, String)> = {
        let mut stmt = conn
            .prepare(
                "SELECT id, period_start, period_end FROM budget_months WHERE year_id = ?1",
            )
            .map_err(err)?;
        let rows = stmt
            .query_map(params![year_id], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })
            .map_err(err)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(err)?
    };
    for (mid, ps, pe) in months {
        let s = period::parse_iso(&ps)?;
        let e = period::parse_iso(&pe)?;
        let new_year = year;
        let new_ps = chrono::NaiveDate::from_ymd_opt(new_year, s.month(), s.day())
            .ok_or_else(|| "Invalid date during year rename".to_string())?;
        let new_pe = chrono::NaiveDate::from_ymd_opt(new_year, e.month(), e.day())
            .ok_or_else(|| "Invalid date during year rename".to_string())?;
        let new_ps_iso = new_ps.format("%Y-%m-%d").to_string();
        let new_pe_iso = new_pe.format("%Y-%m-%d").to_string();
        let new_slug = period::period_slug(&new_ps_iso, &new_pe_iso);
        conn.execute(
            "UPDATE budget_months SET year_month = ?1, period_start = ?2, period_end = ?3 WHERE id = ?4",
            params![new_slug, new_ps_iso, new_pe_iso, mid],
        )
        .map_err(err)?;
    }
    Ok(label)
}

pub fn delete_year(conn: &mut Connection, year_id: i64) -> Result<(), String> {
    let tx = conn.transaction().map_err(err)?;
    tx.execute(
        "DELETE FROM budget_months WHERE year_id = ?1",
        params![year_id],
    )
    .map_err(err)?;
    let n = tx
        .execute("DELETE FROM years WHERE id = ?1", params![year_id])
        .map_err(err)?;
    if n == 0 {
        return Err("Year not found".into());
    }
    tx.commit().map_err(err)?;
    Ok(())
}

/// Ensures all 12 calendar months exist for the given year, seeding any newly
/// created ones with default buckets/lines via `seed_month`.
pub fn ensure_year_months(conn: &mut Connection, year_id: i64) -> Result<Vec<i64>, String> {
    let label: String = conn
        .query_row(
            "SELECT year_label FROM years WHERE id = ?1",
            params![year_id],
            |r| r.get(0),
        )
        .map_err(|_| "Year not found".to_string())?;
    let year = parse_year_label(&label)?;
    let mut ids: Vec<i64> = Vec::with_capacity(12);
    for m in 1u32..=12 {
        let (ps, pe) = period::full_month_bounds(year, m).map_err(err)?;
        let existing: Option<i64> = conn
            .query_row(
                r#"SELECT id FROM budget_months
                   WHERE year_id = ?1 AND period_start = ?2 AND period_end = ?3"#,
                params![year_id, ps, pe],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?;
        if let Some(id) = existing {
            ids.push(id);
            continue;
        }
        let slug = period::period_slug(&ps, &pe);
        conn.execute(
            "INSERT INTO budget_months (year_month, period_start, period_end, year_id) VALUES (?1, ?2, ?3, ?4)",
            params![slug, ps, pe, year_id],
        )
        .map_err(err)?;
        let new_id = conn.last_insert_rowid();
        seed_month(conn, new_id)?;
        ids.push(new_id);
    }
    Ok(ids)
}

/// Snapshots the source year's structure (buckets/lines + planned amounts) into
/// a brand-new destination year. Per `mode`, planned amounts come from each
/// source month one-to-one (`perMonth`) or from a single source month copied to
/// every destination month (`singleSource`).
pub fn duplicate_year(
    conn: &mut Connection,
    source_year_id: i64,
    dest_year_label: &str,
    mode: &str,
    source_month_id: Option<i64>,
) -> Result<i64, String> {
    let dest_year = parse_year_label(dest_year_label)?;
    let dest_label = format!("{dest_year:04}");
    let already: Option<i64> = conn
        .query_row(
            "SELECT id FROM years WHERE year_label = ?1",
            params![dest_label],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;
    if already.is_some() {
        return Err(format!("Year {dest_label} already exists in this budget."));
    }

    let source_label: String = conn
        .query_row(
            "SELECT year_label FROM years WHERE id = ?1",
            params![source_year_id],
            |r| r.get(0),
        )
        .map_err(|_| "Source year not found".to_string())?;
    let _source_year = parse_year_label(&source_label)?;

    let source_months: Vec<(i64, String, String)> = {
        let mut stmt = conn
            .prepare(
                r#"SELECT id, period_start, period_end FROM budget_months
                   WHERE year_id = ?1 ORDER BY period_start, id"#,
            )
            .map_err(err)?;
        let rows = stmt
            .query_map(params![source_year_id], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })
            .map_err(err)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(err)?
    };
    if source_months.is_empty() {
        return Err("Source year has no months to copy.".into());
    }

    let template_month_id: Option<i64> = if mode == "singleSource" {
        let id = source_month_id.ok_or_else(|| {
            "A template month is required when copy mode is 'singleSource'.".to_string()
        })?;
        if !source_months.iter().any(|(mid, _, _)| *mid == id) {
            return Err("Template month is not part of the source year.".into());
        }
        Some(id)
    } else if mode == "perMonth" {
        None
    } else {
        return Err(format!("Unknown copy mode '{mode}'."));
    };

    let dest_year_id = ensure_year_row(conn, &dest_label)?;
    ensure_year_months(conn, dest_year_id)?;

    let dest_months: Vec<(i64, String, String)> = {
        let mut stmt = conn
            .prepare(
                r#"SELECT id, period_start, period_end FROM budget_months
                   WHERE year_id = ?1 ORDER BY period_start, id"#,
            )
            .map_err(err)?;
        let rows = stmt
            .query_map(params![dest_year_id], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })
            .map_err(err)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(err)?
    };

    let tx = conn.transaction().map_err(err)?;
    for (dest_id, dest_ps, _dest_pe) in &dest_months {
        let dest_month_num = period::parse_iso(dest_ps)?.month() as i32;
        let src_id = match template_month_id {
            Some(id) => id,
            None => {
                let mut found: Option<i64> = None;
                for (mid, ps, _pe) in &source_months {
                    if let Ok(d) = period::parse_iso(ps) {
                        if d.month() as i32 == dest_month_num {
                            found = Some(*mid);
                            break;
                        }
                    }
                }
                match found {
                    Some(v) => v,
                    None => continue,
                }
            }
        };

        // Wipe the seeded defaults from the destination month so we land on the source's structure.
        tx.execute(
            "DELETE FROM income_lines WHERE month_id = ?1",
            params![dest_id],
        )
        .map_err(err)?;
        tx.execute(
            "DELETE FROM expense_buckets WHERE month_id = ?1",
            params![dest_id],
        )
        .map_err(err)?;

        let income_rows: Vec<(String, i32, String, i64)> = {
            let mut s = tx
                .prepare(
                    "SELECT line_identity, sort_order, name, planned_cents FROM income_lines WHERE month_id = ?1 ORDER BY sort_order",
                )
                .map_err(err)?;
            let rows = s
                .query_map(params![src_id], |r| {
                    Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
                })
                .map_err(err)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(err)?
        };
        for (line_identity, sort_order, name, planned_cents) in income_rows {
            tx.execute(
                "INSERT INTO income_lines (month_id, line_identity, sort_order, name, planned_cents) VALUES (?1,?2,?3,?4,?5)",
                params![dest_id, line_identity, sort_order, name, planned_cents],
            )
            .map_err(err)?;
        }

        let buckets: Vec<(i64, String, i32)> = {
            let mut s = tx
                .prepare("SELECT id, name, sort_order FROM expense_buckets WHERE month_id = ?1 ORDER BY sort_order, id")
                .map_err(err)?;
            let rows = s
                .query_map(params![src_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
                .map_err(err)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(err)?
        };
        let mut bucket_map: HashMap<i64, i64> = HashMap::new();
        for (old_bid, name, sort_order) in buckets {
            tx.execute(
                "INSERT INTO expense_buckets (month_id, name, sort_order) VALUES (?1,?2,?3)",
                params![dest_id, name, sort_order],
            )
            .map_err(err)?;
            bucket_map.insert(old_bid, tx.last_insert_rowid());
        }

        let lines: Vec<(
            i64,
            String,
            i32,
            String,
            i64,
            i64,
            i64,
            Option<i64>,
            Option<i32>,
        )> = {
            let mut s = tx
                .prepare(
                    r#"SELECT el.bucket_id, el.line_identity, el.sort_order, el.name, el.planned_cents,
                              el.is_neutral_transfer, el.is_sinking_fund, el.annual_estimate_cents, el.due_month_hint
                       FROM expense_lines el
                       JOIN expense_buckets eb ON eb.id = el.bucket_id
                       WHERE eb.month_id = ?1
                       ORDER BY eb.sort_order, el.sort_order"#,
                )
                .map_err(err)?;
            let rows = s
                .query_map(params![src_id], |r| {
                    Ok((
                        r.get(0)?,
                        r.get(1)?,
                        r.get(2)?,
                        r.get(3)?,
                        r.get(4)?,
                        r.get(5)?,
                        r.get(6)?,
                        r.get(7)?,
                        r.get(8)?,
                    ))
                })
                .map_err(err)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(err)?
        };
        for (
            old_bid,
            line_identity,
            sort_order,
            name,
            planned_cents,
            is_neutral,
            is_sinking,
            annual_est,
            due_hint,
        ) in lines
        {
            let new_bid = *bucket_map
                .get(&old_bid)
                .ok_or_else(|| "Bucket mapping missing during duplicate_year".to_string())?;
            tx.execute(
                r#"INSERT INTO expense_lines (
                    bucket_id, line_identity, sort_order, name, planned_cents,
                    is_neutral_transfer, is_sinking_fund, annual_estimate_cents, due_month_hint
                ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)"#,
                params![
                    new_bid,
                    line_identity,
                    sort_order,
                    name,
                    planned_cents,
                    is_neutral,
                    is_sinking,
                    annual_est,
                    due_hint,
                ],
            )
            .map_err(err)?;
        }
    }
    tx.commit().map_err(err)?;
    Ok(dest_year_id)
}

fn parse_year_label(input: &str) -> Result<i32, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("Year cannot be empty".into());
    }
    let year: i32 = trimmed
        .parse()
        .map_err(|_| format!("'{trimmed}' is not a valid 4-digit year"))?;
    if !(1900..=2999).contains(&year) {
        return Err("Year must be between 1900 and 2999".into());
    }
    Ok(year)
}

/// Creates Jan-Dec months for the given calendar year, skipping any that already
/// exist (matched by full-month period bounds). Returns the resulting month ids
/// in calendar order.
pub fn scaffold_year(conn: &mut Connection, year: i32) -> Result<Vec<i64>, String> {
    if !(1900..=2999).contains(&year) {
        return Err("Year out of supported range".into());
    }
    let mut ids: Vec<i64> = Vec::with_capacity(12);
    for m in 1u32..=12 {
        let (ps, pe) = period::full_month_bounds(year, m).map_err(err)?;
        // Use .optional()? so a real DB error (lock contention, missing
        // table, etc.) propagates instead of being silently coerced into
        // "row not found" by the previous .ok() call.
        let existing: Option<i64> = conn
            .query_row(
                "SELECT id FROM budget_months WHERE period_start = ?1 AND period_end = ?2",
                params![ps, pe],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?;
        if let Some(id) = existing {
            ids.push(id);
            continue;
        }
        let ym = format!("{year:04}-{:02}", m);
        let new_id = ensure_month(conn, &ym)?;
        ids.push(new_id);
    }
    Ok(ids)
}

pub fn get_year_overview(conn: &Connection, year_id: Option<i64>) -> Result<YearOverview, String> {
    let (year_label, months) = match year_id {
        Some(yid) => {
            let label: String = conn
                .query_row(
                    "SELECT year_label FROM years WHERE id = ?1",
                    params![yid],
                    |r| r.get(0),
                )
                .map_err(|_| "Year not found".to_string())?;
            (label, list_months_for_year(conn, yid)?)
        }
        None => {
            let meta = get_workspace_meta(conn)?;
            (meta.year_label, list_months(conn)?)
        }
    };

    let mut bucket_totals: HashMap<String, (i64, i64, i32)> = HashMap::new();
    let mut month_rows: Vec<MonthSummaryRow> = Vec::with_capacity(months.len());
    let mut year_income_planned = 0i64;
    let mut year_income_actual = 0i64;
    let mut year_expense_planned = 0i64;
    let mut year_expense_actual = 0i64;

    for m in months {
        let view = get_month_view(conn, m.id)?;
        year_income_planned += view.summary.income_planned_cents;
        year_income_actual += view.summary.income_actual_cents;
        year_expense_planned += view.summary.expense_net_planned_cents;
        year_expense_actual += view.summary.expense_net_actual_cents;

        for bucket in &view.expense_buckets {
            let mut planned = 0i64;
            let mut actual = 0i64;
            for line in &bucket.lines {
                if line.is_neutral_transfer {
                    continue;
                }
                planned += line.planned_cents;
                actual += line.actual_cents;
            }
            let entry = bucket_totals
                .entry(bucket.name.clone())
                .or_insert((0, 0, bucket.sort_order));
            entry.0 += planned;
            entry.1 += actual;
        }

        month_rows.push(MonthSummaryRow {
            month_id: m.id,
            label: m.tab_label,
            period_start: m.period_start,
            period_end: m.period_end,
            income_planned_cents: view.summary.income_planned_cents,
            income_actual_cents: view.summary.income_actual_cents,
            expense_net_planned_cents: view.summary.expense_net_planned_cents,
            expense_net_actual_cents: view.summary.expense_net_actual_cents,
            net_planned_cents: view.summary.net_planned_cents,
            net_actual_cents: view.summary.net_actual_cents,
        });
    }

    let mut bucket_list: Vec<(String, i64, i64, i32)> = bucket_totals
        .into_iter()
        .map(|(name, (p, a, s))| (name, p, a, s))
        .collect();
    bucket_list.sort_by(|a, b| a.3.cmp(&b.3).then_with(|| a.0.cmp(&b.0)));
    let buckets: Vec<BucketRollup> = bucket_list
        .into_iter()
        .map(|(name, planned, actual, _)| BucketRollup {
            name,
            planned_cents: planned,
            actual_cents: actual,
            variance_cents: planned - actual,
        })
        .collect();

    Ok(YearOverview {
        year_label,
        income_planned_cents: year_income_planned,
        income_actual_cents: year_income_actual,
        expense_net_planned_cents: year_expense_planned,
        expense_net_actual_cents: year_expense_actual,
        net_planned_cents: year_income_planned - year_expense_planned,
        net_actual_cents: year_income_actual - year_expense_actual,
        buckets,
        months: month_rows,
    })
}

pub fn export_workspace_json(conn: &Connection) -> Result<String, String> {
    let months = list_months(conn)?;
    write_json_for_months(conn, &months)
}

/// Export a single month as CSV. Same column layout as `export_csv` so a single-month
/// file is a strict subset of the workspace export.
pub fn export_month_csv(conn: &Connection, month_id: i64) -> Result<String, String> {
    let m = list_months(conn)?
        .into_iter()
        .find(|m| m.id == month_id)
        .ok_or_else(|| format!("Month {month_id} not found"))?;
    write_csv_for_months(conn, std::slice::from_ref(&m))
}

/// Export a single month as JSON. Mirrors `export_workspace_json` but with a
/// single-element `months` array, so consumers can use the same parser.
pub fn export_month_json(conn: &Connection, month_id: i64) -> Result<String, String> {
    let m = list_months(conn)?
        .into_iter()
        .find(|m| m.id == month_id)
        .ok_or_else(|| format!("Month {month_id} not found"))?;
    write_json_for_months(conn, std::slice::from_ref(&m))
}

// ─────────────────────────────────────────────────────────────────────────────
// Redacted exports
// ─────────────────────────────────────────────────────────────────────────────
// Produces the same per-bucket / per-line structure the user sees in-app, but
// strips every payee, transaction row, entry label, and sortable identifier so
// the file can be safely shared with an accountant or spouse without leaking
// who you paid or what you bought. The redacted shape is intentionally simple:
//
//   workspace
//     └── years
//           └── months
//                 ├── incomeLines       (name + planned/actual/variance)
//                 └── expenseBuckets    (name, totals, lines [name + cents])
//
// Both CSV and JSON are derived from the same intermediate structs so the two
// formats can never drift.

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RedactedLine {
    name: String,
    planned_cents: i64,
    actual_cents: i64,
    variance_cents: i64,
    /// Only meaningful for expense lines; always `false` for income lines.
    /// Kept on the wire for both kinds so consumers don't have to branch.
    is_neutral_transfer: bool,
    is_sinking_fund: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RedactedBucket {
    name: String,
    /// Sum across all lines, including neutral transfers — useful for cross-
    /// checking against the workspace totals.
    planned_cents: i64,
    actual_cents: i64,
    variance_cents: i64,
    /// Subset of the totals above that came from neutral-transfer lines, so a
    /// reader can derive "real" spend without keeping a separate flag per row.
    neutral_planned_cents: i64,
    neutral_actual_cents: i64,
    lines: Vec<RedactedLine>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RedactedMonth {
    label: String,
    period_start: String,
    period_end: String,
    summary: MonthSummary,
    income_lines: Vec<RedactedLine>,
    expense_buckets: Vec<RedactedBucket>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RedactedYear {
    year_label: String,
    months: Vec<RedactedMonth>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RedactedWorkspace {
    /// "workspace" | "year" | "month" so consumers know how much they're holding.
    scope: &'static str,
    schema_version: i64,
    exported_at: String,
    workspace_label: String,
    workspace_display_name: Option<String>,
    workspace_uuid: String,
    years: Vec<RedactedYear>,
}

fn redact_line_from_income(line: &IncomeLineDto) -> RedactedLine {
    RedactedLine {
        name: line.name.clone(),
        planned_cents: line.planned_cents,
        actual_cents: line.actual_cents,
        variance_cents: line.variance_cents,
        is_neutral_transfer: false,
        is_sinking_fund: false,
    }
}

fn redact_line_from_expense(line: &ExpenseLineDto) -> RedactedLine {
    RedactedLine {
        name: line.name.clone(),
        planned_cents: line.planned_cents,
        actual_cents: line.actual_cents,
        variance_cents: line.variance_cents,
        is_neutral_transfer: line.is_neutral_transfer,
        is_sinking_fund: line.is_sinking_fund,
    }
}

fn redact_bucket(bucket: &ExpenseBucketDto) -> RedactedBucket {
    let mut planned = 0i64;
    let mut actual = 0i64;
    let mut neutral_planned = 0i64;
    let mut neutral_actual = 0i64;
    let lines: Vec<RedactedLine> = bucket
        .lines
        .iter()
        .map(|l| {
            planned += l.planned_cents;
            actual += l.actual_cents;
            if l.is_neutral_transfer {
                neutral_planned += l.planned_cents;
                neutral_actual += l.actual_cents;
            }
            redact_line_from_expense(l)
        })
        .collect();
    RedactedBucket {
        name: bucket.name.clone(),
        planned_cents: planned,
        actual_cents: actual,
        variance_cents: planned - actual,
        neutral_planned_cents: neutral_planned,
        neutral_actual_cents: neutral_actual,
        lines,
    }
}

fn redact_month(view: &MonthView) -> RedactedMonth {
    RedactedMonth {
        label: view.tab_label.clone(),
        period_start: view.period_start.clone(),
        period_end: view.period_end.clone(),
        summary: MonthSummary {
            income_planned_cents: view.summary.income_planned_cents,
            income_actual_cents: view.summary.income_actual_cents,
            income_variance_cents: view.summary.income_variance_cents,
            expense_net_planned_cents: view.summary.expense_net_planned_cents,
            expense_net_actual_cents: view.summary.expense_net_actual_cents,
            expense_net_variance_cents: view.summary.expense_net_variance_cents,
            neutral_expense_planned_cents: view.summary.neutral_expense_planned_cents,
            neutral_expense_actual_cents: view.summary.neutral_expense_actual_cents,
            net_planned_cents: view.summary.net_planned_cents,
            net_actual_cents: view.summary.net_actual_cents,
            net_variance_cents: view.summary.net_variance_cents,
        },
        income_lines: view.income_lines.iter().map(redact_line_from_income).collect(),
        expense_buckets: view.expense_buckets.iter().map(redact_bucket).collect(),
    }
}

fn build_redacted_workspace(
    conn: &Connection,
    scope: &'static str,
    months: &[MonthRow],
) -> Result<RedactedWorkspace, String> {
    let meta = get_workspace_meta(conn)?;
    // Group months by year_label so the export keeps the natural hierarchy
    // (years -> months) even when called with a flat month list. Months with
    // a blank year_label fall under an "Unassigned" bucket.
    let mut by_year: Vec<(String, Vec<RedactedMonth>)> = Vec::new();
    for m in months {
        let view = get_month_view(conn, m.id)?;
        let bucket_label = if m.year_label.trim().is_empty() {
            "Unassigned".to_string()
        } else {
            m.year_label.clone()
        };
        let redacted = redact_month(&view);
        if let Some(existing) = by_year.iter_mut().find(|(label, _)| label == &bucket_label) {
            existing.1.push(redacted);
        } else {
            by_year.push((bucket_label, vec![redacted]));
        }
    }
    let years = by_year
        .into_iter()
        .map(|(year_label, months)| RedactedYear { year_label, months })
        .collect();
    Ok(RedactedWorkspace {
        scope,
        schema_version: meta.schema_version,
        exported_at: chrono::Utc::now().to_rfc3339(),
        workspace_label: meta.year_label,
        workspace_display_name: meta.display_name,
        workspace_uuid: meta.file_uuid,
        years,
    })
}

fn write_csv_field(buf: &mut String, value: &str) {
    // Quote any field that contains the delimiter, quote, or newline. Always
    // quoting names is also fine and keeps the output predictable.
    let needs_quoting = value
        .chars()
        .any(|c| c == ',' || c == '"' || c == '\n' || c == '\r');
    if needs_quoting {
        buf.push('"');
        for c in value.chars() {
            if c == '"' {
                buf.push_str("\"\"");
            } else {
                buf.push(c);
            }
        }
        buf.push('"');
    } else {
        buf.push_str(value);
    }
}

fn append_csv_row(buf: &mut String, fields: &[&str]) {
    for (i, f) in fields.iter().enumerate() {
        if i > 0 {
            buf.push(',');
        }
        write_csv_field(buf, f);
    }
    buf.push('\n');
}

fn redacted_csv_from(report: &RedactedWorkspace) -> String {
    let mut w = String::new();
    append_csv_row(
        &mut w,
        &[
            "section",
            "year",
            "month",
            "bucket",
            "line",
            "planned_cents",
            "actual_cents",
            "variance_cents",
        ],
    );
    for year in &report.years {
        // Year-scoped running totals so the CSV carries totals at each level.
        let mut yr_income_p = 0i64;
        let mut yr_income_a = 0i64;
        let mut yr_expense_p = 0i64;
        let mut yr_expense_a = 0i64;
        let mut yr_neutral_p = 0i64;
        let mut yr_neutral_a = 0i64;
        let mut yr_net_p = 0i64;
        let mut yr_net_a = 0i64;
        for month in &year.months {
            for line in &month.income_lines {
                append_csv_row(
                    &mut w,
                    &[
                        "income_line",
                        &year.year_label,
                        &month.label,
                        "",
                        &line.name,
                        &line.planned_cents.to_string(),
                        &line.actual_cents.to_string(),
                        &line.variance_cents.to_string(),
                    ],
                );
            }
            for bucket in &month.expense_buckets {
                for line in &bucket.lines {
                    let label = if line.is_neutral_transfer {
                        "expense_line_neutral"
                    } else {
                        "expense_line"
                    };
                    append_csv_row(
                        &mut w,
                        &[
                            label,
                            &year.year_label,
                            &month.label,
                            &bucket.name,
                            &line.name,
                            &line.planned_cents.to_string(),
                            &line.actual_cents.to_string(),
                            &line.variance_cents.to_string(),
                        ],
                    );
                }
                append_csv_row(
                    &mut w,
                    &[
                        "bucket_total",
                        &year.year_label,
                        &month.label,
                        &bucket.name,
                        "",
                        &bucket.planned_cents.to_string(),
                        &bucket.actual_cents.to_string(),
                        &bucket.variance_cents.to_string(),
                    ],
                );
            }
            // Per-month totals (real spend, neutral spend, income, net).
            append_csv_row(
                &mut w,
                &[
                    "month_total_income",
                    &year.year_label,
                    &month.label,
                    "",
                    "",
                    &month.summary.income_planned_cents.to_string(),
                    &month.summary.income_actual_cents.to_string(),
                    &month.summary.income_variance_cents.to_string(),
                ],
            );
            append_csv_row(
                &mut w,
                &[
                    "month_total_expense_real",
                    &year.year_label,
                    &month.label,
                    "",
                    "",
                    &month.summary.expense_net_planned_cents.to_string(),
                    &month.summary.expense_net_actual_cents.to_string(),
                    &month.summary.expense_net_variance_cents.to_string(),
                ],
            );
            append_csv_row(
                &mut w,
                &[
                    "month_total_expense_neutral",
                    &year.year_label,
                    &month.label,
                    "",
                    "",
                    &month.summary.neutral_expense_planned_cents.to_string(),
                    &month.summary.neutral_expense_actual_cents.to_string(),
                    "0",
                ],
            );
            append_csv_row(
                &mut w,
                &[
                    "month_total_net",
                    &year.year_label,
                    &month.label,
                    "",
                    "",
                    &month.summary.net_planned_cents.to_string(),
                    &month.summary.net_actual_cents.to_string(),
                    &month.summary.net_variance_cents.to_string(),
                ],
            );
            yr_income_p += month.summary.income_planned_cents;
            yr_income_a += month.summary.income_actual_cents;
            yr_expense_p += month.summary.expense_net_planned_cents;
            yr_expense_a += month.summary.expense_net_actual_cents;
            yr_neutral_p += month.summary.neutral_expense_planned_cents;
            yr_neutral_a += month.summary.neutral_expense_actual_cents;
            yr_net_p += month.summary.net_planned_cents;
            yr_net_a += month.summary.net_actual_cents;
        }
        append_csv_row(
            &mut w,
            &[
                "year_total_income",
                &year.year_label,
                "",
                "",
                "",
                &yr_income_p.to_string(),
                &yr_income_a.to_string(),
                &(yr_income_p - yr_income_a).to_string(),
            ],
        );
        append_csv_row(
            &mut w,
            &[
                "year_total_expense_real",
                &year.year_label,
                "",
                "",
                "",
                &yr_expense_p.to_string(),
                &yr_expense_a.to_string(),
                &(yr_expense_p - yr_expense_a).to_string(),
            ],
        );
        append_csv_row(
            &mut w,
            &[
                "year_total_expense_neutral",
                &year.year_label,
                "",
                "",
                "",
                &yr_neutral_p.to_string(),
                &yr_neutral_a.to_string(),
                "0",
            ],
        );
        append_csv_row(
            &mut w,
            &[
                "year_total_net",
                &year.year_label,
                "",
                "",
                "",
                &yr_net_p.to_string(),
                &yr_net_a.to_string(),
                &(yr_net_p - yr_net_a).to_string(),
            ],
        );
    }
    w
}

fn redacted_json_from(report: &RedactedWorkspace) -> Result<String, String> {
    serde_json::to_string_pretty(report).map_err(err)
}

pub fn export_workspace_csv_redacted(conn: &Connection) -> Result<String, String> {
    let months = list_months(conn)?;
    let report = build_redacted_workspace(conn, "workspace", &months)?;
    Ok(redacted_csv_from(&report))
}

pub fn export_workspace_json_redacted(conn: &Connection) -> Result<String, String> {
    let months = list_months(conn)?;
    let report = build_redacted_workspace(conn, "workspace", &months)?;
    redacted_json_from(&report)
}

pub fn export_year_csv_redacted(conn: &Connection, year_id: i64) -> Result<String, String> {
    let months = list_months_for_year(conn, year_id)?;
    let report = build_redacted_workspace(conn, "year", &months)?;
    Ok(redacted_csv_from(&report))
}

pub fn export_year_json_redacted(conn: &Connection, year_id: i64) -> Result<String, String> {
    let months = list_months_for_year(conn, year_id)?;
    let report = build_redacted_workspace(conn, "year", &months)?;
    redacted_json_from(&report)
}

pub fn export_month_csv_redacted(conn: &Connection, month_id: i64) -> Result<String, String> {
    let m = list_months(conn)?
        .into_iter()
        .find(|m| m.id == month_id)
        .ok_or_else(|| format!("Month {month_id} not found"))?;
    let report = build_redacted_workspace(conn, "month", std::slice::from_ref(&m))?;
    Ok(redacted_csv_from(&report))
}

pub fn export_month_json_redacted(conn: &Connection, month_id: i64) -> Result<String, String> {
    let m = list_months(conn)?
        .into_iter()
        .find(|m| m.id == month_id)
        .ok_or_else(|| format!("Month {month_id} not found"))?;
    let report = build_redacted_workspace(conn, "month", std::slice::from_ref(&m))?;
    redacted_json_from(&report)
}

pub fn rename_year_label(conn: &Connection, year_label: &str) -> Result<String, String> {
    let cleaned = sanitize_year_label(year_label)?;
    conn.execute(
        "UPDATE workspace_meta SET year_label = ?1, updated_at = datetime('now') WHERE id = 1",
        params![cleaned],
    )
    .map_err(err)?;
    Ok(cleaned)
}

/// Calendar year range [start, end] inclusive, using transaction/entry dates. `as_of` caps the end
/// (e.g. active period end); if omitted, uses today capped to the year's last day.
fn calendar_range_bounds(year: i32, as_of: Option<&str>) -> Result<(String, String), String> {
    let start = NaiveDate::from_ymd_opt(year, 1, 1).ok_or_else(|| "Invalid year".to_string())?;
    let year_end = NaiveDate::from_ymd_opt(year, 12, 31).ok_or_else(|| "Invalid year".to_string())?;
    let today = Local::now().date_naive();
    let cap = year_end.min(today);
    let end = if let Some(s) = as_of {
        let d = period::parse_iso(s)?;
        d.min(cap).min(year_end)
    } else {
        cap.min(year_end)
    };
    let end = if end < start { start } else { end };
    Ok((start.format("%Y-%m-%d").to_string(), end.format("%Y-%m-%d").to_string()))
}

fn latest_expense_line_label(
    conn: &Connection,
    line_identity: &str,
) -> Result<(String, Option<String>), String> {
    let row: Option<(String, String)> = conn
        .query_row(
            r#"
            SELECT el.name, eb.name
            FROM expense_lines el
            JOIN expense_buckets eb ON eb.id = el.bucket_id
            JOIN budget_months bm ON bm.id = eb.month_id
            WHERE el.line_identity = ?1
            ORDER BY bm.period_end DESC, el.id DESC
            LIMIT 1
            "#,
            [line_identity],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(err)?;
    Ok(row.map(|(a, b)| (a, Some(b))).unwrap_or_else(|| (line_identity.to_string(), None)))
}

fn latest_income_line_label(conn: &Connection, line_identity: &str) -> Result<String, String> {
    let name: Option<String> = conn
        .query_row(
            r#"
            SELECT il.name
            FROM income_lines il
            JOIN budget_months bm ON bm.id = il.month_id
            WHERE il.line_identity = ?1
            ORDER BY bm.period_end DESC, il.id DESC
            LIMIT 1
            "#,
            [line_identity],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;
    Ok(name.unwrap_or_else(|| line_identity.to_string()))
}

pub fn list_workspace_line_catalog(conn: &Connection) -> Result<Vec<WorkspaceLineCatalogEntry>, String> {
    let mut out: Vec<WorkspaceLineCatalogEntry> = Vec::new();

    let mut inc = conn
        .prepare(
            r#"
            SELECT il.line_identity, il.name
            FROM income_lines il
            INNER JOIN budget_months bm ON bm.id = il.month_id
            INNER JOIN (
                SELECT il2.line_identity AS lid, MAX(bm2.period_end) AS max_end
                FROM income_lines il2
                INNER JOIN budget_months bm2 ON bm2.id = il2.month_id
                GROUP BY il2.line_identity
            ) latest ON latest.lid = il.line_identity AND bm.period_end = latest.max_end
            ORDER BY il.name COLLATE NOCASE, il.line_identity
            "#,
        )
        .map_err(err)?;
    let inc_rows = inc
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
            ))
        })
        .map_err(err)?;
    for row in inc_rows {
        let (line_identity, display_name) = row.map_err(err)?;
        out.push(WorkspaceLineCatalogEntry {
            line_kind: "income".to_string(),
            line_identity,
            display_name,
            bucket_name: None,
        });
    }

    let mut exp = conn
        .prepare(
            r#"
            SELECT el.line_identity, el.name, eb.name
            FROM expense_lines el
            INNER JOIN expense_buckets eb ON eb.id = el.bucket_id
            INNER JOIN budget_months bm ON bm.id = eb.month_id
            INNER JOIN (
                SELECT el2.line_identity AS lid, MAX(bm2.period_end) AS max_end
                FROM expense_lines el2
                INNER JOIN expense_buckets eb2 ON eb2.id = el2.bucket_id
                INNER JOIN budget_months bm2 ON bm2.id = eb2.month_id
                GROUP BY el2.line_identity
            ) latest ON latest.lid = el.line_identity AND bm.period_end = latest.max_end
            ORDER BY eb.name COLLATE NOCASE, el.name COLLATE NOCASE, el.line_identity
            "#,
        )
        .map_err(err)?;
    let exp_rows = exp
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })
        .map_err(err)?;
    for row in exp_rows {
        let (line_identity, display_name, bucket_name) = row.map_err(err)?;
        out.push(WorkspaceLineCatalogEntry {
            line_kind: "expense".to_string(),
            line_identity,
            display_name,
            bucket_name: Some(bucket_name),
        });
    }

    Ok(out)
}

/// Per-(year, bucket-name) and per-(year, line-identity) planned/actual rollups
/// across the active workspace. Used by the cross-year view and by the
/// Reports view's year-axis toggle. Stays inside one file — no cross-file
/// aggregation, which is intentionally deferred.
pub fn get_cross_year_overview(conn: &Connection) -> Result<CrossYearOverview, String> {
    let years = list_years(conn)?;
    let year_index: HashMap<i64, usize> = years
        .iter()
        .enumerate()
        .map(|(i, y)| (y.id, i))
        .collect();
    let n = years.len();
    let blank_row = || -> Vec<CrossYearCell> {
        (0..n)
            .map(|_| CrossYearCell {
                planned_cents: 0,
                actual_cents: 0,
            })
            .collect()
    };

    // Year columns: reuse `list_years` totals (income actual, expense actual)
    // and pair them with planned totals computed below in a single sweep.
    // We need planned totals separately from the income/expense actuals so
    // the column footer can show planned vs actual side by side.
    let mut income_planned_per_year: HashMap<i64, i64> = HashMap::new();
    {
        let mut stmt = conn
            .prepare(
                r#"
                SELECT bm.year_id, COALESCE(SUM(il.planned_cents), 0)
                FROM income_lines il
                JOIN budget_months bm ON bm.id = il.month_id
                WHERE bm.year_id IS NOT NULL
                GROUP BY bm.year_id
                "#,
            )
            .map_err(err)?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)))
            .map_err(err)?;
        for row in rows {
            let (yid, planned) = row.map_err(err)?;
            income_planned_per_year.insert(yid, planned);
        }
    }
    let mut expense_planned_per_year: HashMap<i64, i64> = HashMap::new();
    {
        let mut stmt = conn
            .prepare(
                r#"
                SELECT bm.year_id, COALESCE(SUM(el.planned_cents), 0)
                FROM expense_lines el
                JOIN expense_buckets eb ON eb.id = el.bucket_id
                JOIN budget_months bm ON bm.id = eb.month_id
                WHERE bm.year_id IS NOT NULL AND el.is_neutral_transfer = 0
                GROUP BY bm.year_id
                "#,
            )
            .map_err(err)?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)))
            .map_err(err)?;
        for row in rows {
            let (yid, planned) = row.map_err(err)?;
            expense_planned_per_year.insert(yid, planned);
        }
    }

    let columns: Vec<CrossYearColumn> = years
        .iter()
        .map(|y| {
            let income_planned = *income_planned_per_year.get(&y.id).unwrap_or(&0);
            let expense_planned = *expense_planned_per_year.get(&y.id).unwrap_or(&0);
            CrossYearColumn {
                year_id: y.id,
                year_label: y.year_label.clone(),
                income_planned_cents: income_planned,
                income_actual_cents: y.income_actual_cents,
                expense_planned_cents: expense_planned,
                expense_actual_cents: y.expense_net_actual_cents,
                net_planned_cents: income_planned - expense_planned,
                net_actual_cents: y.net_actual_cents,
                tracked_month_count: y.tracked_month_count,
            }
        })
        .collect();

    // ── Bucket rows (grouped by bucket name across years) ──────────────────
    // A bucket's "identity" across years is its display name. Two buckets in
    // different years that happen to share a name are intentionally folded
    // into one row — this is the same convention the workspace UI uses, and
    // keeps the matrix readable.
    let mut bucket_rows: HashMap<String, Vec<CrossYearCell>> = HashMap::new();
    {
        let mut stmt = conn
            .prepare(
                r#"
                SELECT bm.year_id, eb.name, COALESCE(SUM(el.planned_cents), 0)
                FROM expense_lines el
                JOIN expense_buckets eb ON eb.id = el.bucket_id
                JOIN budget_months bm ON bm.id = eb.month_id
                WHERE bm.year_id IS NOT NULL AND el.is_neutral_transfer = 0
                GROUP BY bm.year_id, eb.name
                "#,
            )
            .map_err(err)?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, i64>(2)?,
                ))
            })
            .map_err(err)?;
        for row in rows {
            let (yid, name, planned) = row.map_err(err)?;
            if let Some(&col) = year_index.get(&yid) {
                let entry = bucket_rows.entry(name).or_insert_with(blank_row);
                entry[col].planned_cents += planned;
            }
        }
    }
    {
        let mut stmt = conn
            .prepare(
                r#"
                SELECT bm.year_id, eb.name, COALESCE(SUM(t.amount_cents), 0)
                FROM transactions t
                JOIN expense_lines el ON el.id = t.expense_line_id
                JOIN expense_buckets eb ON eb.id = el.bucket_id
                JOIN budget_months bm ON bm.id = eb.month_id
                WHERE bm.year_id IS NOT NULL AND el.is_neutral_transfer = 0
                GROUP BY bm.year_id, eb.name
                "#,
            )
            .map_err(err)?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, i64>(2)?,
                ))
            })
            .map_err(err)?;
        for row in rows {
            let (yid, name, actual) = row.map_err(err)?;
            if let Some(&col) = year_index.get(&yid) {
                let entry = bucket_rows.entry(name).or_insert_with(blank_row);
                entry[col].actual_cents += actual;
            }
        }
    }
    let mut bucket_rows: Vec<CrossYearBucketRow> = bucket_rows
        .into_iter()
        .map(|(bucket_name, cells)| {
            let total_planned = cells.iter().map(|c| c.planned_cents).sum();
            let total_actual = cells.iter().map(|c| c.actual_cents).sum();
            CrossYearBucketRow {
                bucket_name,
                cells,
                total_planned_cents: total_planned,
                total_actual_cents: total_actual,
            }
        })
        .collect();
    bucket_rows.sort_by(|a, b| {
        a.bucket_name
            .to_lowercase()
            .cmp(&b.bucket_name.to_lowercase())
    });

    // ── Line rows (income + expense, grouped by line_identity) ─────────────
    // Display name and bucket name are sourced from the latest period that
    // contains the line, mirroring `list_workspace_line_catalog`. That keeps
    // labels consistent across the two views.
    let catalog = list_workspace_line_catalog(conn)?;

    fn fold_line_rows(
        cells_planned: &mut HashMap<String, Vec<CrossYearCell>>,
        cells_actual: &mut HashMap<String, Vec<CrossYearCell>>,
        identity: String,
        col: usize,
        planned: i64,
        actual: i64,
        n: usize,
    ) {
        let blank = || -> Vec<CrossYearCell> {
            (0..n)
                .map(|_| CrossYearCell {
                    planned_cents: 0,
                    actual_cents: 0,
                })
                .collect()
        };
        cells_planned
            .entry(identity.clone())
            .or_insert_with(blank)
            [col]
            .planned_cents += planned;
        cells_actual.entry(identity).or_insert_with(blank)[col].actual_cents += actual;
    }

    let mut line_planned: HashMap<String, Vec<CrossYearCell>> = HashMap::new();
    let mut line_actual: HashMap<String, Vec<CrossYearCell>> = HashMap::new();
    let mut line_kinds: HashMap<String, &'static str> = HashMap::new();

    {
        let mut stmt = conn
            .prepare(
                r#"
                SELECT bm.year_id, il.line_identity, COALESCE(SUM(il.planned_cents), 0)
                FROM income_lines il
                JOIN budget_months bm ON bm.id = il.month_id
                WHERE bm.year_id IS NOT NULL
                GROUP BY bm.year_id, il.line_identity
                "#,
            )
            .map_err(err)?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, i64>(2)?,
                ))
            })
            .map_err(err)?;
        for row in rows {
            let (yid, ident, planned) = row.map_err(err)?;
            if let Some(&col) = year_index.get(&yid) {
                let key = format!("income::{}", ident);
                fold_line_rows(&mut line_planned, &mut line_actual, key.clone(), col, planned, 0, n);
                line_kinds.insert(key, "income");
            }
        }
    }
    {
        let mut stmt = conn
            .prepare(
                r#"
                SELECT bm.year_id, il.line_identity, COALESCE(SUM(ie.amount_cents), 0)
                FROM income_entries ie
                JOIN income_lines il ON il.id = ie.income_line_id
                JOIN budget_months bm ON bm.id = il.month_id
                WHERE bm.year_id IS NOT NULL
                GROUP BY bm.year_id, il.line_identity
                "#,
            )
            .map_err(err)?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, i64>(2)?,
                ))
            })
            .map_err(err)?;
        for row in rows {
            let (yid, ident, actual) = row.map_err(err)?;
            if let Some(&col) = year_index.get(&yid) {
                let key = format!("income::{}", ident);
                fold_line_rows(&mut line_planned, &mut line_actual, key.clone(), col, 0, actual, n);
                line_kinds.insert(key, "income");
            }
        }
    }
    {
        let mut stmt = conn
            .prepare(
                r#"
                SELECT bm.year_id, el.line_identity, COALESCE(SUM(el.planned_cents), 0)
                FROM expense_lines el
                JOIN expense_buckets eb ON eb.id = el.bucket_id
                JOIN budget_months bm ON bm.id = eb.month_id
                WHERE bm.year_id IS NOT NULL AND el.is_neutral_transfer = 0
                GROUP BY bm.year_id, el.line_identity
                "#,
            )
            .map_err(err)?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, i64>(2)?,
                ))
            })
            .map_err(err)?;
        for row in rows {
            let (yid, ident, planned) = row.map_err(err)?;
            if let Some(&col) = year_index.get(&yid) {
                let key = format!("expense::{}", ident);
                fold_line_rows(&mut line_planned, &mut line_actual, key.clone(), col, planned, 0, n);
                line_kinds.insert(key, "expense");
            }
        }
    }
    {
        let mut stmt = conn
            .prepare(
                r#"
                SELECT bm.year_id, el.line_identity, COALESCE(SUM(t.amount_cents), 0)
                FROM transactions t
                JOIN expense_lines el ON el.id = t.expense_line_id
                JOIN expense_buckets eb ON eb.id = el.bucket_id
                JOIN budget_months bm ON bm.id = eb.month_id
                WHERE bm.year_id IS NOT NULL AND el.is_neutral_transfer = 0
                GROUP BY bm.year_id, el.line_identity
                "#,
            )
            .map_err(err)?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, i64>(2)?,
                ))
            })
            .map_err(err)?;
        for row in rows {
            let (yid, ident, actual) = row.map_err(err)?;
            if let Some(&col) = year_index.get(&yid) {
                let key = format!("expense::{}", ident);
                fold_line_rows(&mut line_planned, &mut line_actual, key.clone(), col, 0, actual, n);
                line_kinds.insert(key, "expense");
            }
        }
    }

    // Merge planned + actual per-key into a single CrossYearCell row, then
    // hydrate display name / bucket name from the workspace catalog so the
    // labels stay in sync with the rest of the app.
    let catalog_index: HashMap<String, &WorkspaceLineCatalogEntry> = catalog
        .iter()
        .map(|c| (format!("{}::{}", c.line_kind, c.line_identity), c))
        .collect();

    let mut line_rows: Vec<CrossYearLineRow> = line_planned
        .keys()
        .chain(line_actual.keys())
        .cloned()
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .filter_map(|key| {
            let (kind, ident) = key.split_once("::")?;
            let mut cells = blank_row();
            if let Some(planned) = line_planned.get(&key) {
                for (i, c) in planned.iter().enumerate() {
                    cells[i].planned_cents = c.planned_cents;
                }
            }
            if let Some(actual) = line_actual.get(&key) {
                for (i, c) in actual.iter().enumerate() {
                    cells[i].actual_cents = c.actual_cents;
                }
            }
            let total_planned = cells.iter().map(|c| c.planned_cents).sum();
            let total_actual = cells.iter().map(|c| c.actual_cents).sum();
            let cat = catalog_index.get(&key);
            Some(CrossYearLineRow {
                line_kind: kind.to_string(),
                line_identity: ident.to_string(),
                display_name: cat.map(|c| c.display_name.clone()).unwrap_or_else(|| ident.to_string()),
                bucket_name: cat.and_then(|c| c.bucket_name.clone()),
                cells,
                total_planned_cents: total_planned,
                total_actual_cents: total_actual,
            })
        })
        .collect();
    line_rows.sort_by(|a, b| {
        // Income above expenses, then by display name (case-insensitive).
        // Custom kind ordering — income (0) < expense (1) — so the natural
        // alpha ordering of the strings ("expense" < "income") doesn't flip
        // the sections.
        let kind_order = |k: &str| match k {
            "income" => 0u8,
            "expense" => 1,
            _ => 2,
        };
        kind_order(&a.line_kind)
            .cmp(&kind_order(&b.line_kind))
            .then_with(|| {
                a.display_name
                    .to_lowercase()
                    .cmp(&b.display_name.to_lowercase())
            })
            .then_with(|| a.line_identity.cmp(&b.line_identity))
    });

    let _ = line_kinds; // line_kind is sourced via the key prefix; map kept for clarity.

    Ok(CrossYearOverview {
        columns,
        bucket_rows,
        line_rows,
    })
}

fn expense_monthly_and_entries(
    conn: &Connection,
    line_identity: &str,
    range_start: &str,
    range_end: &str,
) -> Result<(i64, Vec<CalendarMonthBucket>, Vec<CalendarReportEntry>), String> {
    let total: i64 = conn
        .query_row(
            r#"
            SELECT COALESCE(SUM(t.amount_cents), 0)
            FROM transactions t
            JOIN expense_lines el ON el.id = t.expense_line_id
            WHERE el.line_identity = ?1
              AND el.is_neutral_transfer = 0
              AND t.occurred_on IS NOT NULL
              AND date(t.occurred_on) >= date(?2)
              AND date(t.occurred_on) <= date(?3)
            "#,
            params![line_identity, range_start, range_end],
            |r| r.get(0),
        )
        .map_err(err)?;

    let mut mstmt = conn
        .prepare(
            r#"
            SELECT CAST(strftime('%m', t.occurred_on) AS INTEGER), COALESCE(SUM(t.amount_cents), 0)
            FROM transactions t
            JOIN expense_lines el ON el.id = t.expense_line_id
            WHERE el.line_identity = ?1
              AND el.is_neutral_transfer = 0
              AND t.occurred_on IS NOT NULL
              AND date(t.occurred_on) >= date(?2)
              AND date(t.occurred_on) <= date(?3)
            GROUP BY 1
            ORDER BY 1
            "#,
        )
        .map_err(err)?;
    let monthly: Vec<CalendarMonthBucket> = mstmt
        .query_map(params![line_identity, range_start, range_end], |r| {
            Ok(CalendarMonthBucket {
                month: r.get(0)?,
                total_cents: r.get(1)?,
            })
        })
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;

    let mut estmt = conn
        .prepare(
            r#"
            SELECT t.id, t.occurred_on, t.payee, t.amount_cents
            FROM transactions t
            JOIN expense_lines el ON el.id = t.expense_line_id
            WHERE el.line_identity = ?1
              AND el.is_neutral_transfer = 0
              AND t.occurred_on IS NOT NULL
              AND date(t.occurred_on) >= date(?2)
              AND date(t.occurred_on) <= date(?3)
            ORDER BY date(t.occurred_on) DESC, t.id DESC
            LIMIT 500
            "#,
        )
        .map_err(err)?;
    let entries: Vec<CalendarReportEntry> = estmt
        .query_map(params![line_identity, range_start, range_end], |r| {
            Ok(CalendarReportEntry {
                id: r.get(0)?,
                occurred_on: r.get(1)?,
                label: r.get::<_, String>(2)?,
                amount_cents: r.get(3)?,
            })
        })
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;

    Ok((total, monthly, entries))
}

fn income_monthly_and_entries(
    conn: &Connection,
    line_identity: &str,
    range_start: &str,
    range_end: &str,
) -> Result<(i64, Vec<CalendarMonthBucket>, Vec<CalendarReportEntry>), String> {
    let total: i64 = conn
        .query_row(
            r#"
            SELECT COALESCE(SUM(ie.amount_cents), 0)
            FROM income_entries ie
            JOIN income_lines il ON il.id = ie.income_line_id
            WHERE il.line_identity = ?1
              AND ie.received_on IS NOT NULL
              AND date(ie.received_on) >= date(?2)
              AND date(ie.received_on) <= date(?3)
            "#,
            params![line_identity, range_start, range_end],
            |r| r.get(0),
        )
        .map_err(err)?;

    let mut mstmt = conn
        .prepare(
            r#"
            SELECT CAST(strftime('%m', ie.received_on) AS INTEGER), COALESCE(SUM(ie.amount_cents), 0)
            FROM income_entries ie
            JOIN income_lines il ON il.id = ie.income_line_id
            WHERE il.line_identity = ?1
              AND ie.received_on IS NOT NULL
              AND date(ie.received_on) >= date(?2)
              AND date(ie.received_on) <= date(?3)
            GROUP BY 1
            ORDER BY 1
            "#,
        )
        .map_err(err)?;
    let monthly: Vec<CalendarMonthBucket> = mstmt
        .query_map(params![line_identity, range_start, range_end], |r| {
            Ok(CalendarMonthBucket {
                month: r.get(0)?,
                total_cents: r.get(1)?,
            })
        })
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;

    let mut estmt = conn
        .prepare(
            r#"
            SELECT ie.id, ie.received_on, ie.label, ie.amount_cents
            FROM income_entries ie
            JOIN income_lines il ON il.id = ie.income_line_id
            WHERE il.line_identity = ?1
              AND ie.received_on IS NOT NULL
              AND date(ie.received_on) >= date(?2)
              AND date(ie.received_on) <= date(?3)
            ORDER BY date(ie.received_on) DESC, ie.id DESC
            LIMIT 500
            "#,
        )
        .map_err(err)?;
    let entries: Vec<CalendarReportEntry> = estmt
        .query_map(params![line_identity, range_start, range_end], |r| {
            Ok(CalendarReportEntry {
                id: r.get(0)?,
                occurred_on: r.get(1)?,
                label: r.get::<_, String>(2)?,
                amount_cents: r.get(3)?,
            })
        })
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;

    Ok((total, monthly, entries))
}

pub fn get_line_calendar_report(
    conn: &Connection,
    year: i32,
    line_kind: &str,
    line_identity: &str,
    as_of: Option<&str>,
) -> Result<LineCalendarReport, String> {
    let (range_start, range_end) = calendar_range_bounds(year, as_of)?;
    let (display_name, total_cents, monthly, entries) = match line_kind {
        "expense" => {
            let (n, _) = latest_expense_line_label(conn, line_identity)?;
            let (t, m, e) = expense_monthly_and_entries(conn, line_identity, &range_start, &range_end)?;
            (n, t, m, e)
        }
        "income" => {
            let n = latest_income_line_label(conn, line_identity)?;
            let (t, m, e) = income_monthly_and_entries(conn, line_identity, &range_start, &range_end)?;
            (n, t, m, e)
        }
        _ => return Err("line_kind must be 'income' or 'expense'".into()),
    };

    Ok(LineCalendarReport {
        year,
        line_kind: line_kind.to_string(),
        line_identity: line_identity.to_string(),
        display_name,
        range_start,
        range_end,
        total_cents,
        monthly,
        entries,
    })
}

pub fn get_multi_line_calendar_report(
    conn: &Connection,
    year: i32,
    lines: Vec<LineRef>,
    as_of: Option<&str>,
) -> Result<MultiLineCalendarReport, String> {
    let (range_start, range_end) = calendar_range_bounds(year, as_of)?;
    let mut rows: Vec<MultiLineCalendarRow> = Vec::with_capacity(lines.len());
    let mut combined: HashMap<i32, i64> = HashMap::new();

    for pref in lines {
        let kind = pref.line_kind.as_str();
        let id = pref.line_identity.as_str();
        let (name, total) = match kind {
            "expense" => {
                let (n, _) = latest_expense_line_label(conn, id)?;
                let (t, m, _) = expense_monthly_and_entries(conn, id, &range_start, &range_end)?;
                for b in m {
                    *combined.entry(b.month).or_insert(0) += b.total_cents;
                }
                (n, t)
            }
            "income" => {
                let n = latest_income_line_label(conn, id)?;
                let (t, m, _) = income_monthly_and_entries(conn, id, &range_start, &range_end)?;
                for b in m {
                    *combined.entry(b.month).or_insert(0) += b.total_cents;
                }
                (n, t)
            }
            _ => return Err("line_kind must be 'income' or 'expense'".into()),
        };
        rows.push(MultiLineCalendarRow {
            line_kind: kind.to_string(),
            line_identity: id.to_string(),
            display_name: name,
            total_cents: total,
        });
    }

    let mut months: Vec<i32> = combined.keys().copied().collect();
    months.sort_unstable();
    let combined_monthly: Vec<CalendarMonthBucket> = months
        .into_iter()
        .map(|m| CalendarMonthBucket {
            month: m,
            total_cents: *combined.get(&m).unwrap_or(&0),
        })
        .collect();
    let combined_total_cents: i64 = rows.iter().map(|r| r.total_cents).sum();

    Ok(MultiLineCalendarReport {
        year,
        range_start,
        range_end,
        rows,
        combined_monthly,
        combined_total_cents,
    })
}

