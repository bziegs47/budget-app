use rusqlite::{Connection, OptionalExtension};
use std::path::{Path, PathBuf};

pub fn database_path() -> PathBuf {
    let dir = dirs::data_local_dir()
        .unwrap_or_else(|| std::env::temp_dir())
        .join("com.bziegs.budget-app");
    let _ = std::fs::create_dir_all(&dir);
    dir.join("budget.sqlite3")
}

pub fn open_at_path(path: &Path) -> rusqlite::Result<Connection> {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
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
    migrate_v1_budget_months_periods(conn)?;
    Ok(())
}

/// Adds period range columns and drops UNIQUE on year_month so multiple custom ranges can exist.
fn migrate_v1_budget_months_periods(conn: &Connection) -> rusqlite::Result<()> {
    let mut stmt = conn.prepare("PRAGMA table_info(budget_months)")?;
    let cols: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<Vec<_>, _>>()?;
    if cols.iter().any(|c| c == "period_start") {
        return Ok(());
    }
    conn.execute_batch(
        r#"
      PRAGMA foreign_keys = OFF;
      BEGIN IMMEDIATE;
      CREATE TABLE budget_months_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        year_month TEXT NOT NULL,
        period_start TEXT NOT NULL,
        period_end TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO budget_months_new (id, year_month, period_start, period_end, created_at)
      SELECT id, year_month,
        year_month || '-01',
        date(year_month || '-01', '+1 month', '-1 day'),
        created_at
      FROM budget_months;
      DROP TABLE budget_months;
      ALTER TABLE budget_months_new RENAME TO budget_months;
      CREATE INDEX IF NOT EXISTS idx_budget_months_period_end ON budget_months(period_end);
      COMMIT;
      PRAGMA foreign_keys = ON;
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
