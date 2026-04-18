//! App-level configuration and library index living under `app_config_dir`.
//!
//! - `settings.json` holds user preferences: default folder, sidebar state, and
//!   the recent-files list.
//! - `library-index.json` holds a cached snapshot of every `.budget` discovered
//!   under the default folder so the Library view is instant (and so encrypted
//!   workspaces - Phase 3 - can show their last-known summary while locked).

use crate::db;
use crate::models::{AppSettings, LibraryEntry, RecentFile};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

const SETTINGS_FILE: &str = "settings.json";
const LIBRARY_INDEX_FILE: &str = "library-index.json";
pub const RECENT_LIMIT: usize = 24;

fn config_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Could not resolve app config dir: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(config_dir(app)?.join(SETTINGS_FILE))
}

fn library_index_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(config_dir(app)?.join(LIBRARY_INDEX_FILE))
}

pub fn default_folder_default(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let docs = app
        .path()
        .document_dir()
        .map_err(|e| format!("Could not resolve Documents dir: {e}"))?;
    Ok(docs.join("Budget"))
}

pub fn load_settings(app: &tauri::AppHandle) -> Result<AppSettings, String> {
    let path = settings_path(app)?;
    if !path.exists() {
        return Ok(AppSettings::default());
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str::<AppSettings>(&raw).map_err(|e| e.to_string())
}

pub fn save_settings(app: &tauri::AppHandle, settings: &AppSettings) -> Result<(), String> {
    let path = settings_path(app)?;
    let raw = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    write_atomic(&path, raw.as_bytes())
}

/// Returns the default folder, creating it on disk if missing. If the user has
/// never set one, falls back to `~/Documents/Budget/` and persists the choice.
pub fn ensure_default_folder(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let mut settings = load_settings(app)?;
    let folder = match settings.default_folder.as_ref().filter(|s| !s.trim().is_empty()) {
        Some(p) => PathBuf::from(p),
        None => {
            let p = default_folder_default(app)?;
            settings.default_folder = Some(p.to_string_lossy().into_owned());
            save_settings(app, &settings)?;
            p
        }
    };
    fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    Ok(folder)
}

pub fn set_default_folder(app: &tauri::AppHandle, new_path: &Path) -> Result<(), String> {
    fs::create_dir_all(new_path).map_err(|e| e.to_string())?;
    let mut settings = load_settings(app)?;
    settings.default_folder = Some(new_path.to_string_lossy().into_owned());
    save_settings(app, &settings)
}

pub fn upsert_recent(
    app: &tauri::AppHandle,
    path: &Path,
    year_label: &str,
) -> Result<(), String> {
    let mut settings = load_settings(app)?;
    let canonical = canonicalize_or_self(path);
    let path_str = canonical.to_string_lossy().into_owned();
    settings.recent_files.retain(|r| r.path != path_str);
    settings.recent_files.insert(
        0,
        RecentFile {
            path: path_str,
            year_label: year_label.to_string(),
            last_opened_at: Utc::now().to_rfc3339(),
        },
    );
    settings.recent_files.truncate(RECENT_LIMIT);
    save_settings(app, &settings)
}

pub fn list_recent(app: &tauri::AppHandle) -> Result<Vec<RecentFile>, String> {
    let settings = load_settings(app)?;
    Ok(settings.recent_files)
}

pub fn set_sidebar_collapsed(app: &tauri::AppHandle, collapsed: bool) -> Result<(), String> {
    let mut settings = load_settings(app)?;
    settings.sidebar_collapsed = collapsed;
    save_settings(app, &settings)
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct LibraryIndex {
    entries: Vec<LibraryEntry>,
}

pub fn load_library_index(app: &tauri::AppHandle) -> Result<Vec<LibraryEntry>, String> {
    let path = library_index_path(app)?;
    if !path.exists() {
        return Ok(vec![]);
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let idx: LibraryIndex = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    Ok(idx.entries)
}

pub fn save_library_index(
    app: &tauri::AppHandle,
    entries: &[LibraryEntry],
) -> Result<(), String> {
    let path = library_index_path(app)?;
    let idx = LibraryIndex {
        entries: entries.to_vec(),
    };
    let raw = serde_json::to_string_pretty(&idx).map_err(|e| e.to_string())?;
    write_atomic(&path, raw.as_bytes())
}

/// Probe a single `.budget` file and return its index entry. Opens the SQLite
/// database read-only briefly to read the workspace meta and per-line totals.
pub fn read_library_entry(path: &Path) -> Result<LibraryEntry, String> {
    let canonical = canonicalize_or_self(path);
    let metadata = fs::metadata(&canonical).map_err(|e| e.to_string())?;
    let last_modified = metadata
        .modified()
        .map_err(|e| e.to_string())
        .ok()
        .and_then(|t| chrono::DateTime::<Utc>::from(t).to_rfc3339().into())
        .unwrap_or_else(|| Utc::now().to_rfc3339());
    let size_bytes = metadata.len();

    let conn = db::open_at_path(&canonical).map_err(|e| e.to_string())?;
    let (year_label, display_name, file_uuid): (String, Option<String>, String) = conn
        .query_row(
            "SELECT year_label, display_name, file_uuid FROM workspace_meta WHERE id = 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(|e| e.to_string())?;
    let income_actual: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(amount_cents), 0) FROM income_entries",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let expense_net_actual: i64 = conn
        .query_row(
            r#"
            SELECT COALESCE(SUM(t.amount_cents), 0)
            FROM transactions t
            JOIN expense_lines el ON el.id = t.expense_line_id
            WHERE el.is_neutral_transfer = 0
            "#,
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let month_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM budget_months", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;

    Ok(LibraryEntry {
        path: canonical.to_string_lossy().into_owned(),
        year_label,
        display_name,
        file_uuid,
        last_modified,
        size_bytes,
        income_actual_cents: income_actual,
        expense_net_actual_cents: expense_net_actual,
        net_actual_cents: income_actual - expense_net_actual,
        month_count,
        encrypted: false,
    })
}

/// Walks the default folder for `.budget` files and rebuilds the cached library.
/// Subdirectories are scanned shallowly (one level) so users can group years.
pub fn scan_library(app: &tauri::AppHandle) -> Result<Vec<LibraryEntry>, String> {
    let folder = ensure_default_folder(app)?;
    let mut entries: Vec<LibraryEntry> = Vec::new();
    if let Ok(read) = fs::read_dir(&folder) {
        for dirent in read.flatten() {
            let p = dirent.path();
            if p.is_file() {
                if matches_budget_extension(&p) {
                    if let Ok(e) = read_library_entry(&p) {
                        entries.push(e);
                    }
                }
            } else if p.is_dir() {
                if p.file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .as_deref()
                    == Some("autosaves")
                {
                    continue;
                }
                if let Ok(read2) = fs::read_dir(&p) {
                    for sub in read2.flatten() {
                        let sp = sub.path();
                        if sp.is_file() && matches_budget_extension(&sp) {
                            if let Ok(e) = read_library_entry(&sp) {
                                entries.push(e);
                            }
                        }
                    }
                }
            }
        }
    }
    entries.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    save_library_index(app, &entries)?;
    Ok(entries)
}

/// Updates (or inserts) a single library entry by re-probing the file. Cheaper
/// than a full scan; called after Save / Save As / Open.
pub fn refresh_library_entry(app: &tauri::AppHandle, path: &Path) -> Result<(), String> {
    if !matches_budget_extension(path) {
        return Ok(());
    }
    let entry = read_library_entry(path)?;
    let mut entries = load_library_index(app)?;
    entries.retain(|e| !same_path(&e.path, &entry.path));
    entries.insert(0, entry);
    entries.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    save_library_index(app, &entries)
}

pub fn forget_library_entry(app: &tauri::AppHandle, path: &Path) -> Result<(), String> {
    let target = path.to_string_lossy().into_owned();
    let mut entries = load_library_index(app)?;
    entries.retain(|e| !same_path(&e.path, &target));
    save_library_index(app, &entries)
}

fn matches_budget_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|s| s.eq_ignore_ascii_case("budget"))
        .unwrap_or(false)
}

fn same_path(a: &str, b: &str) -> bool {
    let pa = canonicalize_or_self(Path::new(a));
    let pb = canonicalize_or_self(Path::new(b));
    pa == pb
}

pub fn canonicalize_or_self(p: &Path) -> PathBuf {
    fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf())
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())?;
    Ok(())
}
