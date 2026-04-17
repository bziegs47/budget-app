use rusqlite::{Connection, OptionalExtension};
use std::path::PathBuf;

pub fn database_path() -> PathBuf {
    let dir = dirs::data_local_dir()
        .unwrap_or_else(|| std::env::temp_dir())
        .join("com.bziegs.budget-app");
    let _ = std::fs::create_dir_all(&dir);
    dir.join("budget.sqlite3")
}

pub fn open_connection() -> rusqlite::Result<Connection> {
    let path = database_path();
    let conn = Connection::open(path)?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    migrate(&conn)?;
    Ok(conn)
}

fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS budget_months (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            year_month TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS income_lines (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            month_id INTEGER NOT NULL REFERENCES budget_months(id) ON DELETE CASCADE,
            line_identity TEXT NOT NULL,
            sort_order INTEGER NOT NULL,
            name TEXT NOT NULL,
            planned_cents INTEGER NOT NULL DEFAULT 0,
            rollover_in_cents INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS income_entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            income_line_id INTEGER NOT NULL REFERENCES income_lines(id) ON DELETE CASCADE,
            received_on TEXT,
            label TEXT NOT NULL,
            amount_cents INTEGER NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS expense_buckets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            month_id INTEGER NOT NULL REFERENCES budget_months(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            sort_order INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS expense_lines (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            bucket_id INTEGER NOT NULL REFERENCES expense_buckets(id) ON DELETE CASCADE,
            line_identity TEXT NOT NULL,
            sort_order INTEGER NOT NULL,
            name TEXT NOT NULL,
            planned_cents INTEGER NOT NULL DEFAULT 0,
            rollover_in_cents INTEGER NOT NULL DEFAULT 0,
            is_neutral_transfer INTEGER NOT NULL DEFAULT 0,
            is_sinking_fund INTEGER NOT NULL DEFAULT 0,
            annual_estimate_cents INTEGER,
            due_month_hint INTEGER
        );

        CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            expense_line_id INTEGER NOT NULL REFERENCES expense_lines(id) ON DELETE CASCADE,
            occurred_on TEXT,
            payee TEXT NOT NULL,
            amount_cents INTEGER NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_income_lines_month ON income_lines(month_id);
        CREATE INDEX IF NOT EXISTS idx_expense_buckets_month ON expense_buckets(month_id);
        CREATE INDEX IF NOT EXISTS idx_expense_lines_bucket ON expense_lines(bucket_id);
        CREATE INDEX IF NOT EXISTS idx_transactions_line ON transactions(expense_line_id);
        CREATE INDEX IF NOT EXISTS idx_income_entries_line ON income_entries(income_line_id);
        "#,
    )?;
    Ok(())
}

pub fn month_id_for(conn: &Connection, year_month: &str) -> rusqlite::Result<Option<i64>> {
    conn.query_row(
        "SELECT id FROM budget_months WHERE year_month = ?1",
        [year_month],
        |r| r.get(0),
    )
    .optional()
}
