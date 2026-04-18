use crate::db;
use crate::period;
use chrono::{Datelike, Local, NaiveDate};
use crate::models::{
    BucketRollup, CalendarMonthBucket, CalendarReportEntry, ExpenseBucketDto, ExpenseLineDto,
    IncomeEntryDto, IncomeLineDto, LineCalendarReport, LineRef, MonthRow, MonthSummary,
    MonthSummaryRow, MonthView, MultiLineCalendarReport, MultiLineCalendarRow, TransactionDto,
    WorkspaceLineCatalogEntry, WorkspaceMeta, YearOverview, YtdTotals,
};
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::HashMap;
use uuid::Uuid;

fn err(e: impl ToString) -> String {
    e.to_string()
}

pub fn list_months(conn: &Connection) -> Result<Vec<MonthRow>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, year_month, period_start, period_end FROM budget_months ORDER BY period_start, id",
        )
        .map_err(err)?;
    let rows = stmt
        .query_map([], |r| {
            let ps: String = r.get(2)?;
            let pe: String = r.get(3)?;
            let tab_label = period::format_tab_label(&ps, &pe);
            Ok(MonthRow {
                id: r.get(0)?,
                year_month: r.get(1)?,
                period_start: ps,
                period_end: pe,
                tab_label,
            })
        })
        .map_err(err)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(err)
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

fn expense_line_end_balance(conn: &Connection, expense_line_id: i64) -> Result<i64, String> {
    let row: (i64, i64, i64) = conn
        .query_row(
            "SELECT rollover_in_cents, planned_cents, is_neutral_transfer FROM expense_lines WHERE id = ?1",
            [expense_line_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(err)?;
    if row.2 != 0 {
        return Ok(0);
    }
    let actual = line_actual_expense(conn, expense_line_id)?;
    Ok(row.0 + row.1 - actual)
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
        SELECT id, line_identity, sort_order, name, planned_cents, rollover_in_cents
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
                r.get::<_, i64>(5)?,
            ))
        })
        .map_err(err)?;

    let mut income_lines: Vec<IncomeLineDto> = Vec::new();
    for row in income_rows {
        let (id, line_identity, sort_order, name, planned_cents, rollover_in_cents) =
            row.map_err(err)?;
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
            rollover_in_cents,
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
            SELECT id, line_identity, sort_order, name, planned_cents, rollover_in_cents,
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
                    r.get::<_, i64>(7)?,
                    r.get::<_, Option<i64>>(8)?,
                    r.get::<_, Option<i32>>(9)?,
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
                rollover_in_cents,
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
                rollover_in_cents,
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
    conn.execute(
        "INSERT INTO budget_months (year_month, period_start, period_end) VALUES (?1, ?2, ?3)",
        params![year_month, ps, pe],
    )
    .map_err(err)?;
    let id = conn.last_insert_rowid();
    seed_month(conn, id)?;
    Ok(id)
}

pub fn create_period(
    conn: &mut Connection,
    period_start: &str,
    period_end: &str,
) -> Result<i64, String> {
    period::parse_iso(period_start)?;
    period::parse_iso(period_end)?;
    if period_end < period_start {
        return Err("End date must be on or after start date".into());
    }
    let n: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM budget_months WHERE period_start = ?1 AND period_end = ?2",
            params![period_start, period_end],
            |r| r.get(0),
        )
        .map_err(err)?;
    if n > 0 {
        return Err("A budget with this date range already exists.".into());
    }
    let slug = period::period_slug(period_start, period_end);
    conn.execute(
        "INSERT INTO budget_months (year_month, period_start, period_end) VALUES (?1, ?2, ?3)",
        params![slug, period_start, period_end],
    )
    .map_err(err)?;
    let id = conn.last_insert_rowid();
    seed_month(conn, id)?;
    Ok(id)
}

pub fn update_period_range(
    conn: &Connection,
    month_id: i64,
    period_start: &str,
    period_end: &str,
) -> Result<(), String> {
    period::parse_iso(period_start)?;
    period::parse_iso(period_end)?;
    if period_end < period_start {
        return Err("End date must be on or after start date".into());
    }
    let n: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM budget_months WHERE period_start = ?1 AND period_end = ?2 AND id != ?3",
            params![period_start, period_end, month_id],
            |r| r.get(0),
        )
        .map_err(err)?;
    if n > 0 {
        return Err("Another budget already uses this date range.".into());
    }
    let slug = period::period_slug(period_start, period_end);
    conn.execute(
        "UPDATE budget_months SET year_month = ?1, period_start = ?2, period_end = ?3 WHERE id = ?4",
        params![slug, period_start, period_end, month_id],
    )
    .map_err(err)?;
    Ok(())
}

fn seed_month(conn: &mut Connection, month_id: i64) -> Result<(), String> {
    let tx = conn.transaction().map_err(err)?;

    let income_seed = vec!["Wages", "Interest & dividends", "Other income"];
    for (i, name) in income_seed.iter().enumerate() {
        let uid = Uuid::new_v4().to_string();
        tx.execute(
            "INSERT INTO income_lines (month_id, line_identity, sort_order, name, planned_cents, rollover_in_cents) VALUES (?1,?2,?3,?4,0,0)",
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
                    bucket_id, line_identity, sort_order, name, planned_cents, rollover_in_cents,
                    is_neutral_transfer, is_sinking_fund, annual_estimate_cents, due_month_hint
                ) VALUES (?1,?2,?3,?4,0,0,?5,?6,?7,NULL)"#,
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

pub fn duplicate_period(
    conn: &mut Connection,
    from_month_id: i64,
    period_start: &str,
    period_end: &str,
) -> Result<i64, String> {
    period::parse_iso(period_start)?;
    period::parse_iso(period_end)?;
    if period_end < period_start {
        return Err("End date must be on or after start date".into());
    }
    let n: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM budget_months WHERE period_start = ?1 AND period_end = ?2",
            params![period_start, period_end],
            |r| r.get(0),
        )
        .map_err(err)?;
    if n > 0 {
        return Err("A budget with this date range already exists.".into());
    }
    let from_id = from_month_id;
    conn.query_row(
        "SELECT 1 FROM budget_months WHERE id = ?1",
        [from_id],
        |_| Ok(()),
    )
    .map_err(|_| "Source budget not found".to_string())?;

    let lines: Vec<(
        i64,
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
        let mut stmt = conn
            .prepare(
                r#"
        SELECT el.id, el.bucket_id, el.line_identity, el.sort_order, el.name, el.planned_cents,
               el.is_neutral_transfer, el.is_sinking_fund, el.annual_estimate_cents, el.due_month_hint
        FROM expense_lines el
        JOIN expense_buckets eb ON eb.id = el.bucket_id
        WHERE eb.month_id = ?1
        ORDER BY eb.sort_order, el.sort_order
        "#,
            )
            .map_err(err)?;
        let rows = stmt
            .query_map([from_id], |r| {
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
                    r.get(9)?,
                ))
            })
            .map_err(err)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(err)?
    };

    // New month starts with planned amounts only — no rolled balances from source actuals
    let rollover_in_for_duplicate: i64 = 0;
    let slug = period::period_slug(period_start, period_end);

    let tx = conn.transaction().map_err(err)?;

    tx.execute(
        "INSERT INTO budget_months (year_month, period_start, period_end) VALUES (?1, ?2, ?3)",
        params![slug, period_start, period_end],
    )
    .map_err(err)?;
    let to_mid = tx.last_insert_rowid();

    let income_rows: Vec<(String, i32, String, i64)> = {
        let mut s = tx
            .prepare("SELECT line_identity, sort_order, name, planned_cents FROM income_lines WHERE month_id = ?1 ORDER BY sort_order")
            .map_err(err)?;
        let rows = s
            .query_map([from_id], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
            })
            .map_err(err)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(err)?
    };
    for (line_identity, sort_order, name, planned_cents) in income_rows {
        tx.execute(
            "INSERT INTO income_lines (month_id, line_identity, sort_order, name, planned_cents, rollover_in_cents) VALUES (?1,?2,?3,?4,?5,0)",
            params![to_mid, line_identity, sort_order, name, planned_cents],
        )
        .map_err(err)?;
    }

    let mut bucket_map: HashMap<i64, i64> = HashMap::new();
    let buckets: Vec<(i64, String, i32)> = {
        let mut s = tx
            .prepare("SELECT id, name, sort_order FROM expense_buckets WHERE month_id = ?1 ORDER BY sort_order, id")
            .map_err(err)?;
        let rows = s
            .query_map([from_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .map_err(err)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(err)?
    };
    for (old_bid, name, sort_order) in buckets {
        tx.execute(
            "INSERT INTO expense_buckets (month_id, name, sort_order) VALUES (?1,?2,?3)",
            params![to_mid, name, sort_order],
        )
        .map_err(err)?;
        bucket_map.insert(old_bid, tx.last_insert_rowid());
    }

    for (
        _old_lid,
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
            .ok_or_else(|| "Bucket mapping missing".to_string())?;
        tx.execute(
            r#"INSERT INTO expense_lines (
                bucket_id, line_identity, sort_order, name, planned_cents, rollover_in_cents,
                is_neutral_transfer, is_sinking_fund, annual_estimate_cents, due_month_hint
            ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)"#,
            params![
                new_bid,
                line_identity,
                sort_order,
                name,
                planned_cents,
                rollover_in_for_duplicate,
                is_neutral,
                is_sinking,
                annual_est,
                due_hint
            ],
        )
        .map_err(err)?;
    }

    tx.commit().map_err(err)?;
    Ok(to_mid)
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

pub fn add_expense_line(conn: &Connection, bucket_id: i64, name: &str) -> Result<i64, String> {
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
            bucket_id, line_identity, sort_order, name, planned_cents, rollover_in_cents,
            is_neutral_transfer, is_sinking_fund, annual_estimate_cents, due_month_hint
        ) VALUES (?1, ?2, ?3, ?4, 0, 0, 0, 0, NULL, NULL)"#,
        params![bucket_id, uid, next_sort, trimmed],
    )
    .map_err(err)?;
    Ok(conn.last_insert_rowid())
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

pub fn export_csv(conn: &Connection) -> Result<String, String> {
    let mut w = String::new();
    w.push_str("section,month,year_month,id,detail,amount_cents\n");

    let months = list_months(conn)?;
    for m in months {
        let slug = m.year_month.clone();
        let label = m.tab_label.clone();
        let mut stmt = conn
            .prepare("SELECT id, name, planned_cents FROM income_lines WHERE month_id = ?1 ORDER BY sort_order")
            .map_err(err)?;
        let rows = stmt
            .query_map([m.id], |r| {
                Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?))
            })
            .map_err(err)?;
        for r in rows {
            let (id, name, planned) = r.map_err(err)?;
            w.push_str(&format!(
                "income_line,{},{},{},\"{}\",{}\n",
                label, slug, id, name.replace('"', "'"), planned
            ));
        }

        let mut bs = conn
            .prepare("SELECT id FROM expense_buckets WHERE month_id = ?1 ORDER BY sort_order")
            .map_err(err)?;
        let bids = bs
            .query_map([m.id], |r| r.get::<_, i64>(0))
            .map_err(err)?;
        for bid in bids {
            let bid = bid.map_err(err)?;
            let mut ls = conn
                .prepare(
                    r#"SELECT id, name, planned_cents, is_neutral_transfer FROM expense_lines WHERE bucket_id = ?1 ORDER BY sort_order"#,
                )
                .map_err(err)?;
            let lrows = ls
                .query_map([bid], |r| {
                    Ok((
                        r.get::<_, i64>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, i64>(2)?,
                        r.get::<_, i64>(3)?,
                    ))
                })
                .map_err(err)?;
            for lr in lrows {
                let (lid, lname, planned, neutral) = lr.map_err(err)?;
                w.push_str(&format!(
                    "expense_line,{},{},{},\"{}\" (neutral={}),{}\n",
                    label,
                    slug,
                    lid,
                    lname.replace('"', "'"),
                    neutral,
                    planned
                ));
            }
        }

        let mut txq = conn
            .prepare(
                r#"
            SELECT t.id, bm.year_month, t.payee, t.amount_cents, el.id
            FROM transactions t
            JOIN expense_lines el ON el.id = t.expense_line_id
            JOIN expense_buckets eb ON eb.id = el.bucket_id
            JOIN budget_months bm ON bm.id = eb.month_id
            WHERE bm.id = ?1
            ORDER BY t.id
            "#,
            )
            .map_err(err)?;
        let txs = txq.query_map([m.id], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, i64>(3)?,
                r.get::<_, i64>(4)?,
            ))
        }).map_err(err)?;
        for t in txs {
            let (id, _yym, payee, amt, line_id) = t.map_err(err)?;
            w.push_str(&format!(
                "expense_tx,{},{},{},\"{}\",{}\n",
                label, slug, line_id, payee.replace('"', "'"), amt
            ));
            let _ = id;
        }

        let mut ie = conn
            .prepare(
                r#"
            SELECT ie.id, bm.year_month, ie.label, ie.amount_cents, il.id
            FROM income_entries ie
            JOIN income_lines il ON il.id = ie.income_line_id
            JOIN budget_months bm ON bm.id = il.month_id
            WHERE bm.id = ?1
            ORDER BY ie.id
            "#,
            )
            .map_err(err)?;
        let ies = ie.query_map([m.id], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, i64>(3)?,
                r.get::<_, i64>(4)?,
            ))
        }).map_err(err)?;
        for row in ies {
            let (_id, _ym, entry_label, amt, line_id) = row.map_err(err)?;
            w.push_str(&format!(
                "income_entry,{},{},{},\"{}\",{}\n",
                label, slug, line_id, entry_label.replace('"', "'"), amt
            ));
        }
    }

    Ok(w)
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
        let existing: Option<i64> = conn
            .query_row(
                "SELECT id FROM budget_months WHERE period_start = ?1 AND period_end = ?2",
                params![ps, pe],
                |r| r.get(0),
            )
            .ok();
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

pub fn get_year_overview(conn: &Connection) -> Result<YearOverview, String> {
    let meta = get_workspace_meta(conn)?;
    let months = list_months(conn)?;

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
        year_label: meta.year_label,
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
    let meta = get_workspace_meta(conn)?;
    let months = list_months(conn)?;
    let mut month_views: Vec<MonthView> = Vec::with_capacity(months.len());
    for m in &months {
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

