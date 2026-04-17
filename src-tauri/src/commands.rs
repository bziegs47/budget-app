use crate::db;
use crate::models::{
    ExpenseBucketDto, ExpenseLineDto, IncomeEntryDto, IncomeLineDto, MonthRow, MonthSummary,
    MonthView, TransactionDto, YtdTotals,
};
use rusqlite::{params, Connection};
use std::collections::HashMap;
use uuid::Uuid;

fn err(e: impl ToString) -> String {
    e.to_string()
}

pub fn list_months(conn: &Connection) -> Result<Vec<MonthRow>, String> {
    let mut stmt = conn
        .prepare("SELECT id, year_month FROM budget_months ORDER BY year_month")
        .map_err(err)?;
    let rows = stmt
        .query_map([], |r| {
            Ok(MonthRow {
                id: r.get(0)?,
                year_month: r.get(1)?,
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

fn compute_ytd(conn: &Connection, year_month: &str) -> Result<YtdTotals, String> {
    let (y, _m): (i32, i32) = parse_ym(year_month)?;
    let year_prefix = format!("{y:04}");

    let income: i64 = conn
        .query_row(
            r#"
            SELECT COALESCE(SUM(ie.amount_cents),0)
            FROM income_entries ie
            JOIN income_lines il ON il.id = ie.income_line_id
            JOIN budget_months bm ON bm.id = il.month_id
            WHERE substr(bm.year_month,1,4) = ?1 AND bm.year_month <= ?2
            "#,
            params![year_prefix, year_month],
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
              AND substr(bm.year_month,1,4) = ?1
              AND bm.year_month <= ?2
            "#,
            params![year_prefix, year_month],
            |r| r.get(0),
        )
        .map_err(err)?;

    Ok(YtdTotals {
        year: y,
        through_month: year_month.to_string(),
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

pub fn get_month_view(conn: &Connection, year_month: &str) -> Result<MonthView, String> {
    let month_id: i64 = conn
        .query_row(
            "SELECT id FROM budget_months WHERE year_month = ?1",
            [year_month],
            |r| r.get(0),
        )
        .map_err(|_| format!("No month {year_month} — create it first"))?;

    let ytd = compute_ytd(conn, year_month)?;

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
        year_month: year_month.to_string(),
        month_id,
        income_lines,
        expense_buckets,
        summary,
        ytd,
    })
}

pub fn ensure_month(conn: &mut Connection, year_month: &str) -> Result<i64, String> {
    parse_ym(year_month)?;
    if let Some(id) = db::month_id_for(conn, year_month).map_err(err)? {
        return Ok(id);
    }
    conn.execute(
        "INSERT INTO budget_months (year_month) VALUES (?1)",
        [year_month],
    )
    .map_err(err)?;
    let id = conn.last_insert_rowid();
    seed_month(conn, id)?;
    Ok(id)
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

pub fn duplicate_month(conn: &mut Connection, from_ym: &str, to_ym: &str) -> Result<(), String> {
    parse_ym(from_ym)?;
    parse_ym(to_ym)?;
    if from_ym == to_ym {
        return Err("Source and target month must differ".into());
    }
    if db::month_id_for(conn, to_ym).map_err(err)?.is_some() {
        return Err(format!("Month {to_ym} already exists"));
    }
    let from_id: i64 = conn
        .query_row(
            "SELECT id FROM budget_months WHERE year_month = ?1",
            [from_ym],
            |r| r.get(0),
        )
        .map_err(|_| format!("Source month {from_ym} not found"))?;

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
    )> = stmt
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
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;

    let mut rollovers: HashMap<i64, i64> = HashMap::new();
    for (old_lid, _, _, _, _, _, is_neutral, _, _, _) in &lines {
        let rv = if *is_neutral != 0 {
            0
        } else {
            expense_line_end_balance(conn, *old_lid)?
        };
        rollovers.insert(*old_lid, rv);
    }

    let tx = conn.transaction().map_err(err)?;

    tx.execute("INSERT INTO budget_months (year_month) VALUES (?1)", [to_ym])
        .map_err(err)?;
    let to_mid = tx.last_insert_rowid();

    let income_rows: Vec<(String, i32, String, i64)> = {
        let mut s = tx
            .prepare("SELECT line_identity, sort_order, name, planned_cents FROM income_lines WHERE month_id = ?1 ORDER BY sort_order")
            .map_err(err)?;
        s.query_map([from_id], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
        })
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?
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
        s.query_map([from_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .map_err(err)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(err)?
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
        old_lid,
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
        let rollover = *rollovers.get(&old_lid).unwrap_or(&0);
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
                rollover,
                is_neutral,
                is_sinking,
                annual_est,
                due_hint
            ],
        )
        .map_err(err)?;
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
        let ym = m.year_month.clone();
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
                ym, ym, id, name.replace('"', "'"), planned
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
                    ym,
                    ym,
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
            WHERE bm.year_month = ?1
            ORDER BY t.id
            "#,
            )
            .map_err(err)?;
        let txs = txq.query_map([&ym], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, i64>(3)?,
                r.get::<_, i64>(4)?,
            ))
        }).map_err(err)?;
        for t in txs {
            let (id, yym, payee, amt, line_id) = t.map_err(err)?;
            w.push_str(&format!(
                "expense_tx,{},{},{},\"{}\",{}\n",
                yym, yym, line_id, payee.replace('"', "'"), amt
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
            WHERE bm.year_month = ?1
            ORDER BY ie.id
            "#,
            )
            .map_err(err)?;
        let ies = ie.query_map([&ym], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, i64>(3)?,
                r.get::<_, i64>(4)?,
            ))
        }).map_err(err)?;
        for row in ies {
            let (_id, yym, label, amt, line_id) = row.map_err(err)?;
            w.push_str(&format!(
                "income_entry,{},{},{},\"{}\",{}\n",
                yym, yym, line_id, label.replace('"', "'"), amt
            ));
        }
    }

    Ok(w)
}

pub fn database_file_path() -> String {
    db::database_path().to_string_lossy().into_owned()
}
