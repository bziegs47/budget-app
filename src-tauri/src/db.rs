use rusqlite::{Connection, OptionalExtension};
use std::path::{Path, PathBuf};

pub fn database_path() -> PathBuf {
    let dir = dirs::data_local_dir()
        .unwrap_or_else(|| std::env::temp_dir())
        .join("com.bziegs.mimo");
    let _ = std::fs::create_dir_all(&dir);
    dir.join("budget.sqlite3")
}

pub fn open_at_path(path: &Path) -> rusqlite::Result<Connection> {
    open_with_optional_key(path, None)
}

/// Opens a workspace database, optionally applying a SQLCipher key. When
/// `key` is `Some`, the connection issues `PRAGMA key = ...` before
/// touching schema; otherwise it behaves exactly like the legacy
/// unencrypted opener. Callers should always pass the key when they
/// already know the file is encrypted; for the discovery case (file
/// might or might not be encrypted) prefer `try_open_unkeyed_then_keyed`
/// so the user sees one consistent error if everything fails.
pub fn open_with_optional_key(
    path: &Path,
    key: Option<&str>,
) -> rusqlite::Result<Connection> {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let conn = Connection::open(path)?;
    if let Some(k) = key {
        apply_key(&conn, k)?;
    }
    // Pin rollback journaling so the workspace stays a single-file
    // artifact. WAL would leave -wal/-shm sidecars next to the .mimo,
    // which breaks snapshot copies and atomic-rename saves.
    conn.pragma_update(None, "journal_mode", &"DELETE")?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    // Probe schema access early. On an encrypted DB without the right key
    // (or on any DB with a wrong key) this returns SQLITE_NOTADB so
    // callers can route to the password modal cleanly.
    conn.query_row("SELECT count(*) FROM sqlite_master", [], |r| {
        r.get::<_, i64>(0)
    })?;
    migrate(&conn)?;
    Ok(conn)
}

#[cfg(feature = "encryption")]
fn apply_key(conn: &Connection, key: &str) -> rusqlite::Result<()> {
    let escaped = key.replace('\'', "''");
    conn.execute_batch(&format!("PRAGMA key = '{}';", escaped))
}

#[cfg(not(feature = "encryption"))]
fn apply_key(_conn: &Connection, _key: &str) -> rusqlite::Result<()> {
    // Without the encryption feature compiled in, applying a key is a
    // no-op at the SQL level - any subsequent schema query against an
    // encrypted file will fail with SQLITE_NOTADB, which `try_open` maps
    // to a friendly "this build doesn't support encrypted workspaces"
    // error for the user.
    Ok(())
}

/// Heuristic for "is this file an encrypted SQLCipher database?". Tries
/// to open it without a key and read the schema; an encrypted file fails
/// with `SQLITE_NOTADB`. Returns `false` for both unencrypted databases
/// and for files that don't exist (the latter is a caller bug, but we
/// stay conservative). Cheap enough to call from `scan_library`.
pub fn is_encrypted_at_path(path: &Path) -> bool {
    let conn = match Connection::open(path) {
        Ok(c) => c,
        Err(_) => return false,
    };
    match conn.query_row("SELECT count(*) FROM sqlite_master", [], |r| {
        r.get::<_, i64>(0)
    }) {
        Ok(_) => false,
        Err(rusqlite::Error::SqliteFailure(err, _))
            if err.code == rusqlite::ErrorCode::NotADatabase =>
        {
            true
        }
        Err(_) => false,
    }
}

/// Rotates the SQLCipher key on an already-open connection. Pass `None`
/// to remove encryption (decrypts in place). Requires the `encryption`
/// feature to be compiled in; otherwise returns an `Unsupported` error.
#[cfg(feature = "encryption")]
pub fn rekey(conn: &Connection, new_key: Option<&str>) -> rusqlite::Result<()> {
    match new_key {
        Some(k) => {
            let escaped = k.replace('\'', "''");
            conn.execute_batch(&format!("PRAGMA rekey = '{}';", escaped))
        }
        None => conn.execute_batch("PRAGMA rekey = '';"),
    }
}

#[cfg(not(feature = "encryption"))]
pub fn rekey(_conn: &Connection, _new_key: Option<&str>) -> rusqlite::Result<()> {
    Err(rusqlite::Error::SqliteFailure(
        rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_AUTH),
        Some("encryption feature is not enabled in this build".to_string()),
    ))
}

/// Returns whether the running binary was compiled with SQLCipher
/// support. The frontend uses this to decide whether to show the
/// "Set password..." menu items at all, vs. greying them out with an
/// explanatory tooltip.
pub fn encryption_supported() -> bool {
    cfg!(feature = "encryption")
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
            planned_cents INTEGER NOT NULL DEFAULT 0
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
    migrate_v2_workspace_meta(conn)?;
    migrate_v3_years_table(conn)?;
    migrate_v4_updated_at_columns(conn)?;
    migrate_v5_drop_rollover_in(conn)?;
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

/// Adds the `years` table and a `year_id` column on `budget_months`. Each existing
/// month is mapped to a year row derived from the YYYY of its `period_start`. New
/// year rows are inserted in ascending label order. Filling each year out to all
/// 12 calendar months happens lazily on first open of an existing year via
/// `commands::ensure_year_months`, which is also used by `commands::scaffold_year`
/// when a brand-new year is created. That keeps the seeding logic in the commands
/// layer where it can use the same period helpers as the rest of the app.
fn migrate_v3_years_table(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS years (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            year_label TEXT NOT NULL UNIQUE,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        "#,
    )?;

    let cols = column_names(conn, "budget_months")?;
    if !cols.iter().any(|c| c == "year_id") {
        conn.execute_batch("ALTER TABLE budget_months ADD COLUMN year_id INTEGER;")?;
        conn.execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_budget_months_year ON budget_months(year_id);",
        )?;
    }

    // Backfill: for each distinct YYYY found in `period_start`, ensure a year row
    // exists, then point any month with NULL year_id at it.
    let mut years_stmt = conn.prepare(
        r#"SELECT DISTINCT strftime('%Y', period_start) AS y
           FROM budget_months
           WHERE period_start IS NOT NULL AND period_start != ''
           ORDER BY y"#,
    )?;
    let labels: Vec<String> = years_stmt
        .query_map([], |r| r.get::<_, Option<String>>(0))?
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .flatten()
        .collect();
    drop(years_stmt);

    for label in &labels {
        conn.execute(
            "INSERT OR IGNORE INTO years (year_label, sort_order) VALUES (?1, CAST(?1 AS INTEGER))",
            rusqlite::params![label],
        )?;
    }
    conn.execute(
        r#"UPDATE budget_months
              SET year_id = (
                  SELECT y.id FROM years y
                  WHERE y.year_label = strftime('%Y', budget_months.period_start)
              )
              WHERE year_id IS NULL"#,
        [],
    )?;

    Ok(())
}

/// Adds `updated_at TEXT` to high-churn tables and an `AFTER UPDATE` trigger per
/// table that auto-bumps the column. This is a foundation for sync-readiness UI
/// (e.g. "last edited" tooltips) and for any future merge tooling — it is never
/// surfaced as a column the user can edit. Each trigger uses a `WHEN` guard that
/// compares OLD vs NEW so the trigger's own UPDATE doesn't recurse forever.
///
/// Tables covered: `years`, `budget_months`, `expense_buckets`, `expense_lines`,
/// `income_lines`, `transactions`, `income_entries`. Tables that already carry a
/// `created_at` use it as the backfill seed; the rest fall back to "now".
fn migrate_v4_updated_at_columns(conn: &Connection) -> rusqlite::Result<()> {
    // (table_name, has_created_at)
    const TABLES: &[(&str, bool)] = &[
        ("years", true),
        ("budget_months", true),
        ("expense_buckets", false),
        ("expense_lines", false),
        ("income_lines", false),
        ("transactions", true),
        ("income_entries", true),
    ];

    for (table, has_created_at) in TABLES {
        let cols = column_names(conn, table)?;
        if !cols.iter().any(|c| c == "updated_at") {
            conn.execute_batch(&format!(
                "ALTER TABLE {table} ADD COLUMN updated_at TEXT;",
                table = table
            ))?;
        }
        let backfill = if *has_created_at {
            format!(
                "UPDATE {table} SET updated_at = COALESCE(updated_at, created_at, datetime('now')) WHERE updated_at IS NULL OR updated_at = '';"
            )
        } else {
            format!(
                "UPDATE {table} SET updated_at = COALESCE(updated_at, datetime('now')) WHERE updated_at IS NULL OR updated_at = '';"
            )
        };
        conn.execute_batch(&backfill)?;

        // Drop and recreate the trigger so callers always get the current shape
        // even if the trigger definition evolves in a future migration.
        let trigger = format!("trg_{table}_updated_at");
        conn.execute_batch(&format!("DROP TRIGGER IF EXISTS {trigger};"))?;
        conn.execute_batch(&format!(
            r#"
            CREATE TRIGGER {trigger}
            AFTER UPDATE ON {table}
            FOR EACH ROW
            WHEN OLD.updated_at IS NEW.updated_at
            BEGIN
                UPDATE {table} SET updated_at = datetime('now') WHERE rowid = NEW.rowid;
            END;
            "#
        ))?;
    }

    // Stamp the workspace meta with the new schema version so the frontend can
    // surface "version 4" in diagnostics. Using MAX so a forward-migrated file
    // never gets downgraded if it somehow already declares a higher version.
    conn.execute(
        "UPDATE workspace_meta SET schema_version = MAX(schema_version, 4) WHERE id = 1",
        [],
    )?;

    Ok(())
}

/// Drops the legacy `rollover_in_cents` column from `income_lines` and
/// `expense_lines`. The column was only ever an input field in the
/// per-line UI; nothing in the variance / actual / YTD / export
/// pipelines ever consumed it, and the only Rust function that referenced
/// it (`expense_line_end_balance`) was dead code. SQLite ≥ 3.35 supports
/// `ALTER TABLE ... DROP COLUMN` directly, which is what bundled
/// rusqlite ships, so this is a single statement per table. The check
/// guards against running on schemas that already lost the column (new
/// files created post-v5, or files already migrated once).
fn migrate_v5_drop_rollover_in(conn: &Connection) -> rusqlite::Result<()> {
    for table in ["income_lines", "expense_lines"] {
        let cols = column_names(conn, table)?;
        if cols.iter().any(|c| c == "rollover_in_cents") {
            conn.execute_batch(&format!(
                "ALTER TABLE {table} DROP COLUMN rollover_in_cents;"
            ))?;
        }
    }
    conn.execute(
        "UPDATE workspace_meta SET schema_version = MAX(schema_version, 5) WHERE id = 1",
        [],
    )?;
    Ok(())
}

fn column_names(conn: &Connection, table: &str) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let cols: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(cols)
}

pub fn month_id_for(conn: &Connection, year_month: &str) -> rusqlite::Result<Option<i64>> {
    conn.query_row(
        "SELECT id FROM budget_months WHERE year_month = ?1",
        [year_month],
        |r| r.get(0),
    )
    .optional()
}

/// Adds workspace_meta singleton table; auto-derives year_label from period_start values.
fn migrate_v2_workspace_meta(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS workspace_meta (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            year_label TEXT NOT NULL DEFAULT '',
            display_name TEXT,
            file_uuid TEXT NOT NULL DEFAULT '',
            schema_version INTEGER NOT NULL DEFAULT 2,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        "#,
    )?;

    let exists: i64 = conn.query_row("SELECT COUNT(*) FROM workspace_meta", [], |r| r.get(0))?;
    if exists == 0 {
        // Derive year_label from the most common YYYY in period_start values, if any.
        let derived: Option<String> = conn
            .query_row(
                r#"
                SELECT strftime('%Y', period_start) AS y
                FROM budget_months
                WHERE period_start IS NOT NULL AND period_start != ''
                GROUP BY y
                ORDER BY COUNT(*) DESC, y DESC
                LIMIT 1
                "#,
                [],
                |r| r.get::<_, Option<String>>(0),
            )
            .optional()?
            .flatten();
        let year_label = derived.unwrap_or_default();
        let uuid = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO workspace_meta (id, year_label, file_uuid) VALUES (1, ?1, ?2)",
            rusqlite::params![year_label, uuid],
        )?;
    } else {
        // Backfill file_uuid for older rows that may have been created with the empty default.
        let needs_uuid: i64 = conn.query_row(
            "SELECT COUNT(*) FROM workspace_meta WHERE id = 1 AND (file_uuid IS NULL OR file_uuid = '')",
            [],
            |r| r.get(0),
        )?;
        if needs_uuid > 0 {
            let uuid = uuid::Uuid::new_v4().to_string();
            conn.execute(
                "UPDATE workspace_meta SET file_uuid = ?1 WHERE id = 1",
                rusqlite::params![uuid],
            )?;
        }
    }
    Ok(())
}
