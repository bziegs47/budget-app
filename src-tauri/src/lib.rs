mod commands;
mod db;
mod models;
mod period;
mod settings;

use models::{AppSettings, LibraryEntry, RecentFile, WorkspaceMeta, YearOverview};
use rusqlite::Connection;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::menu::{CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder, Window};
use uuid::Uuid;

const MAIN_WINDOW_LABEL: &str = "main";
const AUTOSAVE_DIR_NAME: &str = "autosaves";
const AUTOSAVE_KEEP: usize = 5;

pub struct AppState {
    inner: Mutex<AppStateInner>,
}

struct AppStateInner {
    paths: HashMap<String, PathBuf>,
    conns: HashMap<String, Connection>,
    auto_save: HashMap<String, bool>,
    dirty: HashMap<String, bool>,
}

impl AppState {
    fn new() -> Self {
        Self {
            inner: Mutex::new(AppStateInner {
                paths: HashMap::new(),
                conns: HashMap::new(),
                auto_save: HashMap::new(),
                dirty: HashMap::new(),
            }),
        }
    }

    fn register_path(&self, label: &str, path: PathBuf) -> Result<(), String> {
        let mut inner = self.inner.lock().map_err(|e| e.to_string())?;
        inner.paths.insert(label.to_string(), path);
        Ok(())
    }

    fn label_for_canonical(&self, target: &Path) -> Result<Option<String>, String> {
        let canonical = settings::canonicalize_or_self(target);
        let inner = self.inner.lock().map_err(|e| e.to_string())?;
        for (label, p) in inner.paths.iter() {
            if settings::canonicalize_or_self(p) == canonical {
                return Ok(Some(label.clone()));
            }
        }
        Ok(None)
    }

    fn current_path(&self, label: &str) -> Result<PathBuf, String> {
        let inner = self.inner.lock().map_err(|e| e.to_string())?;
        inner
            .paths
            .get(label)
            .cloned()
            .ok_or_else(|| format!("No file registered for window '{label}'"))
    }

    fn switch_path(&self, label: &str, new_path: PathBuf) -> Result<(), String> {
        let mut inner = self.inner.lock().map_err(|e| e.to_string())?;
        inner.paths.insert(label.to_string(), new_path.clone());
        inner.conns.remove(label);
        let conn = db::open_at_path(&new_path).map_err(|e| e.to_string())?;
        inner.conns.insert(label.to_string(), conn);
        inner.dirty.insert(label.to_string(), false);
        Ok(())
    }

    fn mark_dirty(&self, label: &str) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.dirty.insert(label.to_string(), true);
        }
    }

    fn mark_clean(&self, label: &str) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.dirty.insert(label.to_string(), false);
        }
    }

    fn is_dirty(&self, label: &str) -> Result<bool, String> {
        let inner = self.inner.lock().map_err(|e| e.to_string())?;
        Ok(inner.dirty.get(label).copied().unwrap_or(false))
    }

    fn auto_save_enabled(&self, label: &str) -> Result<bool, String> {
        let inner = self.inner.lock().map_err(|e| e.to_string())?;
        Ok(inner.auto_save.get(label).copied().unwrap_or(false))
    }

    fn set_auto_save(&self, label: &str, on: bool) -> Result<(), String> {
        let mut inner = self.inner.lock().map_err(|e| e.to_string())?;
        inner.auto_save.insert(label.to_string(), on);
        Ok(())
    }

    fn drop_window(&self, label: &str) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.paths.remove(label);
            inner.conns.remove(label);
            inner.auto_save.remove(label);
            inner.dirty.remove(label);
        }
    }

    fn with_conn<R>(
        &self,
        label: &str,
        f: impl FnOnce(&Connection) -> Result<R, String>,
    ) -> Result<R, String> {
        let mut inner = self.inner.lock().map_err(|e| e.to_string())?;
        ensure_conn(&mut inner, label)?;
        let conn = inner.conns.get(label).expect("conn ensured");
        f(conn)
    }

    fn with_conn_mut<R>(
        &self,
        label: &str,
        f: impl FnOnce(&mut Connection) -> Result<R, String>,
    ) -> Result<R, String> {
        let mut inner = self.inner.lock().map_err(|e| e.to_string())?;
        ensure_conn(&mut inner, label)?;
        let conn = inner.conns.get_mut(label).expect("conn ensured");
        f(conn)
    }
}

fn ensure_conn(inner: &mut AppStateInner, label: &str) -> Result<(), String> {
    if inner.conns.contains_key(label) {
        return Ok(());
    }
    let path = inner
        .paths
        .get(label)
        .cloned()
        .ok_or_else(|| format!("No file registered for window '{label}'"))?;
    let conn = db::open_at_path(&path).map_err(|e| e.to_string())?;
    inner.conns.insert(label.to_string(), conn);
    Ok(())
}

fn label_of(window: &Window) -> String {
    window.label().to_string()
}

#[tauri::command]
fn list_months(
    state: tauri::State<AppState>,
    window: Window,
) -> Result<Vec<models::MonthRow>, String> {
    state.with_conn(&label_of(&window), |conn| commands::list_months(conn))
}

#[tauri::command]
fn get_month_view(
    state: tauri::State<AppState>,
    window: Window,
    month_id: i64,
) -> Result<models::MonthView, String> {
    state.with_conn(&label_of(&window), |conn| {
        commands::get_month_view(conn, month_id)
    })
}

#[tauri::command]
fn ensure_month(
    state: tauri::State<AppState>,
    window: Window,
    year_month: String,
) -> Result<i64, String> {
    state.with_conn_mut(&label_of(&window), |conn| {
        commands::ensure_month(conn, &year_month)
    })
}

#[tauri::command]
fn duplicate_period(
    state: tauri::State<AppState>,
    window: Window,
    from_month_id: i64,
    period_start: String,
    period_end: String,
) -> Result<i64, String> {
    let label = label_of(&window);
    let result = state.with_conn_mut(&label, |conn| {
        commands::duplicate_period(conn, from_month_id, &period_start, &period_end)
    });
    if result.is_ok() {
        state.mark_dirty(&label);
    }
    result
}

#[tauri::command]
fn create_period(
    state: tauri::State<AppState>,
    window: Window,
    period_start: String,
    period_end: String,
) -> Result<i64, String> {
    let label = label_of(&window);
    let result = state.with_conn_mut(&label, |conn| {
        commands::create_period(conn, &period_start, &period_end)
    });
    if result.is_ok() {
        state.mark_dirty(&label);
    }
    result
}

#[tauri::command]
fn update_period_range(
    state: tauri::State<AppState>,
    window: Window,
    month_id: i64,
    period_start: String,
    period_end: String,
) -> Result<(), String> {
    let label = label_of(&window);
    let result = state.with_conn(&label, |conn| {
        commands::update_period_range(conn, month_id, &period_start, &period_end)
    });
    if result.is_ok() {
        state.mark_dirty(&label);
    }
    result
}

#[tauri::command]
fn set_income_line_planned(
    state: tauri::State<AppState>,
    window: Window,
    id: i64,
    planned_cents: i64,
) -> Result<(), String> {
    let label = label_of(&window);
    let result = state.with_conn(&label, |conn| {
        commands::set_income_line_planned(conn, id, planned_cents)
    });
    if result.is_ok() {
        state.mark_dirty(&label);
    }
    result
}

#[tauri::command]
fn set_expense_line_planned(
    state: tauri::State<AppState>,
    window: Window,
    id: i64,
    planned_cents: i64,
) -> Result<(), String> {
    let label = label_of(&window);
    let result = state.with_conn(&label, |conn| {
        commands::set_expense_line_planned(conn, id, planned_cents)
    });
    if result.is_ok() {
        state.mark_dirty(&label);
    }
    result
}

#[tauri::command]
fn add_expense_line(
    state: tauri::State<AppState>,
    window: Window,
    bucket_id: i64,
    name: String,
) -> Result<i64, String> {
    let label = label_of(&window);
    let result = state.with_conn(&label, |conn| {
        commands::add_expense_line(conn, bucket_id, &name)
    });
    if result.is_ok() {
        state.mark_dirty(&label);
    }
    result
}

#[tauri::command]
fn rename_expense_line(
    state: tauri::State<AppState>,
    window: Window,
    id: i64,
    name: String,
) -> Result<(), String> {
    let label = label_of(&window);
    let result = state.with_conn(&label, |conn| {
        commands::rename_expense_line(conn, id, &name)
    });
    if result.is_ok() {
        state.mark_dirty(&label);
    }
    result
}

#[tauri::command]
fn delete_expense_line(
    state: tauri::State<AppState>,
    window: Window,
    id: i64,
) -> Result<(), String> {
    let label = label_of(&window);
    let result = state.with_conn(&label, |conn| commands::delete_expense_line(conn, id));
    if result.is_ok() {
        state.mark_dirty(&label);
    }
    result
}

#[tauri::command]
fn reorder_buckets(
    state: tauri::State<AppState>,
    window: Window,
    month_id: i64,
    ordered_ids: Vec<i64>,
) -> Result<(), String> {
    let label = label_of(&window);
    let result = state.with_conn_mut(&label, |conn| {
        commands::reorder_buckets(conn, month_id, &ordered_ids)
    });
    if result.is_ok() {
        state.mark_dirty(&label);
    }
    result
}

#[tauri::command]
fn add_transaction(
    state: tauri::State<AppState>,
    window: Window,
    expense_line_id: i64,
    payee: String,
    amount_cents: i64,
    occurred_on: Option<String>,
) -> Result<i64, String> {
    let label = label_of(&window);
    let result = state.with_conn(&label, |conn| {
        commands::add_transaction(conn, expense_line_id, payee, amount_cents, occurred_on)
    });
    if result.is_ok() {
        state.mark_dirty(&label);
    }
    result
}

#[tauri::command]
fn delete_transaction(
    state: tauri::State<AppState>,
    window: Window,
    id: i64,
) -> Result<(), String> {
    let label = label_of(&window);
    let result = state.with_conn(&label, |conn| commands::delete_transaction(conn, id));
    if result.is_ok() {
        state.mark_dirty(&label);
    }
    result
}

#[tauri::command]
fn add_income_entry(
    state: tauri::State<AppState>,
    window: Window,
    income_line_id: i64,
    label: String,
    amount_cents: i64,
    received_on: Option<String>,
) -> Result<i64, String> {
    let win_label = label_of(&window);
    let result = state.with_conn(&win_label, |conn| {
        commands::add_income_entry(conn, income_line_id, label, amount_cents, received_on)
    });
    if result.is_ok() {
        state.mark_dirty(&win_label);
    }
    result
}

#[tauri::command]
fn delete_income_entry(
    state: tauri::State<AppState>,
    window: Window,
    id: i64,
) -> Result<(), String> {
    let label = label_of(&window);
    let result = state.with_conn(&label, |conn| commands::delete_income_entry(conn, id));
    if result.is_ok() {
        state.mark_dirty(&label);
    }
    result
}

#[tauri::command]
fn export_csv_data(state: tauri::State<AppState>, window: Window) -> Result<String, String> {
    state.with_conn(&label_of(&window), |conn| commands::export_csv(conn))
}

#[tauri::command]
fn get_database_path(
    state: tauri::State<AppState>,
    window: Window,
) -> Result<String, String> {
    let p = state.current_path(&label_of(&window))?;
    Ok(p.to_string_lossy().into_owned())
}

#[tauri::command]
fn is_default_workspace(
    state: tauri::State<AppState>,
    window: Window,
) -> Result<bool, String> {
    let current = state.current_path(&label_of(&window))?;
    Ok(paths_equal(&current, &db::database_path()))
}

#[tauri::command]
fn save_budget_as(
    app_handle: tauri::AppHandle,
    state: tauri::State<AppState>,
    window: Window,
    target_path: String,
) -> Result<String, String> {
    let label = label_of(&window);
    let src = state.current_path(&label)?;
    let mut dest = PathBuf::from(&target_path);
    if dest.extension().is_none() {
        dest.set_extension("budget");
    }
    if let Some(other_label) = state.label_for_canonical(&dest)? {
        if other_label != label {
            return Err(format!(
                "That file is already open in another window — close it first."
            ));
        }
    }
    if paths_equal(&dest, &src) {
        return Ok(dest.to_string_lossy().into_owned());
    }
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::copy(&src, &dest).map_err(|e| format!("Could not write '{}': {e}", dest.display()))?;
    state.switch_path(&label, dest.clone())?;
    state.mark_clean(&label);

    let year_label = state
        .with_conn(&label, |conn| commands::get_workspace_meta(conn))
        .map(|m| m.year_label)
        .unwrap_or_default();
    let _ = settings::upsert_recent(&app_handle, &dest, &year_label);
    let _ = settings::refresh_library_entry(&app_handle, &dest);
    let title = window_title_from_path(&dest);
    let _ = window.set_title(&title);
    Ok(dest.to_string_lossy().into_owned())
}

#[tauri::command]
fn is_dirty(state: tauri::State<AppState>, window: Window) -> Result<bool, String> {
    state.is_dirty(&label_of(&window))
}

#[tauri::command]
fn mark_clean(state: tauri::State<AppState>, window: Window) -> Result<(), String> {
    state.mark_clean(&label_of(&window));
    Ok(())
}

#[tauri::command]
fn open_budget_in_new_window(
    app_handle: tauri::AppHandle,
    state: tauri::State<AppState>,
    file_path: String,
) -> Result<(), String> {
    let path = PathBuf::from(&file_path);
    if !path.exists() {
        return Err(format!("File not found: {}", path.display()));
    }

    if let Some(existing_label) = state.label_for_canonical(&path)? {
        if let Some(existing_window) = app_handle.get_webview_window(&existing_label) {
            let _ = existing_window.set_focus();
            return Ok(());
        }
    }

    let label = format!("budget-{}", &Uuid::new_v4().simple().to_string()[..12]);
    state.register_path(&label, path.clone())?;

    let title = window_title_from_path(&path);
    WebviewWindowBuilder::new(&app_handle, &label, WebviewUrl::default())
        .title(title)
        .inner_size(1180.0, 820.0)
        .build()
        .map_err(|e| e.to_string())?;

    let year_label = state
        .with_conn(&label, |conn| commands::get_workspace_meta(conn))
        .map(|m| m.year_label)
        .unwrap_or_default();
    let _ = settings::upsert_recent(&app_handle, &path, &year_label);
    let _ = settings::refresh_library_entry(&app_handle, &path);

    Ok(())
}

#[tauri::command]
fn save_snapshot(
    state: tauri::State<AppState>,
    window: Window,
) -> Result<String, String> {
    let label = label_of(&window);
    let src = state.current_path(&label)?;
    let parent = src
        .parent()
        .ok_or_else(|| "Working file has no parent directory".to_string())?;
    let stem = src
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "budget".to_string());
    let backups_dir = parent.join(AUTOSAVE_DIR_NAME);
    std::fs::create_dir_all(&backups_dir).map_err(|e| e.to_string())?;

    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let dest = backups_dir.join(format!("{stem}.{stamp}.budget"));
    std::fs::copy(&src, &dest).map_err(|e| e.to_string())?;
    prune_autosaves(&backups_dir, &stem, AUTOSAVE_KEEP);
    Ok(dest.to_string_lossy().into_owned())
}

#[tauri::command]
fn get_auto_save(state: tauri::State<AppState>, window: Window) -> Result<bool, String> {
    state.auto_save_enabled(&label_of(&window))
}

#[tauri::command]
fn set_auto_save(
    state: tauri::State<AppState>,
    window: Window,
    enabled: bool,
) -> Result<(), String> {
    state.set_auto_save(&label_of(&window), enabled)
}

#[tauri::command]
fn get_workspace_meta(
    state: tauri::State<AppState>,
    window: Window,
) -> Result<WorkspaceMeta, String> {
    state.with_conn(&label_of(&window), |conn| commands::get_workspace_meta(conn))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExternalRenameInfo {
    year_label: String,
    file_basename: String,
    is_default_workspace: bool,
    matches: bool,
}

#[tauri::command]
fn check_external_rename(
    state: tauri::State<AppState>,
    window: Window,
) -> Result<ExternalRenameInfo, String> {
    let label = label_of(&window);
    let path = state.current_path(&label)?;
    let is_default = paths_equal(&path, &db::database_path());
    let basename = path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let meta = state.with_conn(&label, |conn| commands::get_workspace_meta(conn))?;
    let matches = meta.year_label.trim() == basename.trim();
    Ok(ExternalRenameInfo {
        year_label: meta.year_label,
        file_basename: basename,
        is_default_workspace: is_default,
        matches,
    })
}

/// Sets the workspace year label, and (if the workspace is linked to a real
/// `.budget` file) renames the file on disk to match. The new path is returned
/// so the frontend can refresh its title/state.
#[tauri::command]
fn set_workspace_year(
    app_handle: tauri::AppHandle,
    state: tauri::State<AppState>,
    window: Window,
    year_label: String,
) -> Result<String, String> {
    let label = label_of(&window);
    let cleaned = state.with_conn(&label, |conn| commands::rename_year_label(conn, &year_label))?;
    state.mark_dirty(&label);

    let current = state.current_path(&label)?;
    if paths_equal(&current, &db::database_path()) {
        return Ok(current.to_string_lossy().into_owned());
    }
    let parent = current
        .parent()
        .ok_or_else(|| "Workspace file has no parent directory".to_string())?;
    let mut new_path = parent.join(&cleaned);
    new_path.set_extension("budget");
    if paths_equal(&new_path, &current) {
        return Ok(current.to_string_lossy().into_owned());
    }
    if new_path.exists() {
        return Err(format!(
            "A file already exists at '{}'. Choose a different year label.",
            new_path.display()
        ));
    }
    if let Some(other_label) = state.label_for_canonical(&new_path)? {
        if other_label != label {
            return Err("That file is already open in another window".into());
        }
    }
    // Drop conn before renaming so SQLite releases the file handle.
    {
        let mut inner = state.inner.lock().map_err(|e| e.to_string())?;
        inner.conns.remove(&label);
    }
    std::fs::rename(&current, &new_path).map_err(|e| e.to_string())?;
    state.switch_path(&label, new_path.clone())?;

    let _ = settings::forget_library_entry(&app_handle, &current);
    let _ = settings::refresh_library_entry(&app_handle, &new_path);
    let _ = settings::upsert_recent(&app_handle, &new_path, &cleaned);
    let _ = window.set_title(&window_title_from_path(&new_path));
    Ok(new_path.to_string_lossy().into_owned())
}

#[tauri::command]
fn scaffold_year(
    state: tauri::State<AppState>,
    window: Window,
    year: i32,
) -> Result<Vec<i64>, String> {
    let label = label_of(&window);
    let result = state.with_conn_mut(&label, |conn| commands::scaffold_year(conn, year));
    if result.is_ok() {
        state.mark_dirty(&label);
    }
    result
}

#[tauri::command]
fn get_year_overview(
    state: tauri::State<AppState>,
    window: Window,
) -> Result<YearOverview, String> {
    state.with_conn(&label_of(&window), |conn| commands::get_year_overview(conn))
}

#[tauri::command]
fn export_workspace_json(
    state: tauri::State<AppState>,
    window: Window,
) -> Result<String, String> {
    state.with_conn(&label_of(&window), |conn| {
        commands::export_workspace_json(conn)
    })
}

#[tauri::command]
fn get_settings(app_handle: tauri::AppHandle) -> Result<AppSettings, String> {
    let mut settings = settings::load_settings(&app_handle)?;
    if settings
        .default_folder
        .as_ref()
        .map(|s| s.trim().is_empty())
        .unwrap_or(true)
    {
        let folder = settings::ensure_default_folder(&app_handle)?;
        settings.default_folder = Some(folder.to_string_lossy().into_owned());
    }
    Ok(settings)
}

#[tauri::command]
fn set_default_folder(
    app_handle: tauri::AppHandle,
    new_path: String,
) -> Result<(), String> {
    let p = PathBuf::from(new_path);
    settings::set_default_folder(&app_handle, &p)
}

#[tauri::command]
fn set_sidebar_collapsed(
    app_handle: tauri::AppHandle,
    collapsed: bool,
) -> Result<(), String> {
    settings::set_sidebar_collapsed(&app_handle, collapsed)
}

#[tauri::command]
fn list_recent_files(app_handle: tauri::AppHandle) -> Result<Vec<RecentFile>, String> {
    settings::list_recent(&app_handle)
}

#[tauri::command]
fn scan_library(app_handle: tauri::AppHandle) -> Result<Vec<LibraryEntry>, String> {
    settings::scan_library(&app_handle)
}

#[tauri::command]
fn get_library_index(app_handle: tauri::AppHandle) -> Result<Vec<LibraryEntry>, String> {
    settings::load_library_index(&app_handle)
}

/// Creates a new `.budget` file inside the default folder, scaffolds Jan-Dec
/// for the requested year, and opens it in a new window. The returned path is
/// the absolute path of the new file.
#[tauri::command]
fn create_year_workspace(
    app_handle: tauri::AppHandle,
    state: tauri::State<AppState>,
    year_label: String,
    scaffold_year_value: Option<i32>,
) -> Result<String, String> {
    let folder = settings::ensure_default_folder(&app_handle)?;
    let cleaned = commands::sanitize_year_label(&year_label)?;
    let mut path = folder.join(&cleaned);
    path.set_extension("budget");
    if path.exists() {
        return Err(format!(
            "A budget file already exists at '{}'.",
            path.display()
        ));
    }
    {
        let conn = db::open_at_path(&path).map_err(|e| e.to_string())?;
        commands::set_workspace_year(&conn, &cleaned)?;
        if let Some(year) = scaffold_year_value {
            // Need a mutable connection for scaffolding; reopen for safety.
            drop(conn);
            let mut conn2 = db::open_at_path(&path).map_err(|e| e.to_string())?;
            let _ = commands::scaffold_year(&mut conn2, year)?;
        }
    }

    if let Some(existing_label) = state.label_for_canonical(&path)? {
        if let Some(win) = app_handle.get_webview_window(&existing_label) {
            let _ = win.set_focus();
            return Ok(path.to_string_lossy().into_owned());
        }
    }
    let label = format!("budget-{}", &Uuid::new_v4().simple().to_string()[..12]);
    state.register_path(&label, path.clone())?;
    WebviewWindowBuilder::new(&app_handle, &label, WebviewUrl::default())
        .title(window_title_from_path(&path))
        .inner_size(1180.0, 820.0)
        .build()
        .map_err(|e| e.to_string())?;

    let _ = settings::upsert_recent(&app_handle, &path, &cleaned);
    let _ = settings::refresh_library_entry(&app_handle, &path);
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
fn reveal_default_folder(app_handle: tauri::AppHandle) -> Result<String, String> {
    use tauri_plugin_opener::OpenerExt;
    let folder = settings::ensure_default_folder(&app_handle)?;
    let folder_str = folder.to_string_lossy().into_owned();
    app_handle
        .opener()
        .open_path(folder_str.clone(), None::<&str>)
        .map_err(|e| e.to_string())?;
    Ok(folder_str)
}

fn prune_autosaves(dir: &Path, stem: &str, keep: usize) {
    let Ok(read) = std::fs::read_dir(dir) else { return };
    let prefix = format!("{stem}.");
    let mut entries: Vec<_> = read
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.file_name()
                .to_string_lossy()
                .starts_with(&prefix)
        })
        .collect();
    entries.sort_by_key(|e| e.file_name());
    while entries.len() > keep {
        let oldest = entries.remove(0);
        let _ = std::fs::remove_file(oldest.path());
    }
}

fn paths_equal(a: &Path, b: &Path) -> bool {
    let canonical = |p: &Path| std::fs::canonicalize(p).ok();
    match (canonical(a), canonical(b)) {
        (Some(ca), Some(cb)) => ca == cb,
        _ => a == b,
    }
}

fn focused_webview_window(app: &tauri::AppHandle) -> Option<tauri::WebviewWindow> {
    for (_label, w) in app.webview_windows() {
        if w.is_focused().unwrap_or(false) {
            return Some(w);
        }
    }
    None
}

fn window_title_from_path(path: &Path) -> String {
    let name = path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Budget".to_string());
    format!("Budget — {name}")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::new())
        .setup(|app| {
            let state = app.state::<AppState>();
            state.register_path(MAIN_WINDOW_LABEL, db::database_path())?;
            // Make sure ~/Documents/Budget exists before the UI asks for it.
            let _ = settings::ensure_default_folder(&app.handle());

            build_menu(app)?;

            let app_handle = app.handle().clone();
            app.on_menu_event(move |_handle, event| {
                let id = event.id().0.as_str();
                let payload: Option<&str> = match id {
                    "next_month" => Some("menu:next-month"),
                    "prev_month" => Some("menu:prev-month"),
                    "open_file" => Some("menu:open-file"),
                    "new_year" => Some("menu:new-year"),
                    "save" => Some("menu:save"),
                    "save_as" => Some("menu:save-as"),
                    "toggle_autosave" => Some("menu:toggle-autosave"),
                    "reorganize" => Some("menu:reorganize"),
                    "show_default_folder" => Some("menu:show-default-folder"),
                    "export_csv" => Some("menu:export-csv"),
                    "export_json" => Some("menu:export-json"),
                    "toggle_sidebar" => Some("menu:toggle-sidebar"),
                    "show_overview" => Some("menu:show-overview"),
                    "show_library" => Some("menu:show-library"),
                    "add_month" => Some("menu:add-month"),
                    "duplicate_month" => Some("menu:duplicate-month"),
                    _ => None,
                };
                if let Some(event_name) = payload {
                    if let Some(focused) = focused_webview_window(&app_handle) {
                        let _ = focused.emit(event_name, ());
                    } else {
                        let _ = app_handle.emit(event_name, ());
                    }
                }
            });

            Ok(())
        })
        .on_window_event(|window, ev| {
            if let tauri::WindowEvent::Destroyed = ev {
                let label = window.label().to_string();
                let state = window.app_handle().state::<AppState>();
                state.drop_window(&label);
            }
        })
        .invoke_handler(tauri::generate_handler![
            list_months,
            get_month_view,
            ensure_month,
            duplicate_period,
            create_period,
            update_period_range,
            set_income_line_planned,
            set_expense_line_planned,
            add_expense_line,
            rename_expense_line,
            delete_expense_line,
            reorder_buckets,
            add_transaction,
            delete_transaction,
            add_income_entry,
            delete_income_entry,
            export_csv_data,
            get_database_path,
            save_budget_as,
            is_default_workspace,
            is_dirty,
            mark_clean,
            open_budget_in_new_window,
            save_snapshot,
            get_auto_save,
            set_auto_save,
            get_workspace_meta,
            set_workspace_year,
            check_external_rename,
            scaffold_year,
            get_year_overview,
            export_workspace_json,
            get_settings,
            set_default_folder,
            set_sidebar_collapsed,
            list_recent_files,
            scan_library,
            get_library_index,
            create_year_workspace,
            reveal_default_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn build_menu(app: &mut tauri::App) -> tauri::Result<()> {
    let new_year = MenuItemBuilder::with_id("new_year", "New Year Budget…")
        .accelerator("Cmd+N")
        .build(app)?;
    let open_file = MenuItemBuilder::with_id("open_file", "Open Budget File…")
        .accelerator("Cmd+O")
        .build(app)?;
    let save = MenuItemBuilder::with_id("save", "Save")
        .accelerator("Cmd+S")
        .build(app)?;
    let save_as = MenuItemBuilder::with_id("save_as", "Save Budget As…")
        .accelerator("Cmd+Shift+S")
        .build(app)?;
    let show_default_folder =
        MenuItemBuilder::with_id("show_default_folder", "Show Default Folder in Finder")
            .build(app)?;
    let export_csv = MenuItemBuilder::with_id("export_csv", "Export as CSV…").build(app)?;
    let export_json = MenuItemBuilder::with_id("export_json", "Export as JSON…").build(app)?;
    let toggle_autosave = CheckMenuItemBuilder::with_id("toggle_autosave", "Auto-save Snapshots")
        .checked(false)
        .build(app)?;

    let toggle_sidebar = MenuItemBuilder::with_id("toggle_sidebar", "Toggle Sidebar")
        .accelerator("Cmd+\\")
        .build(app)?;
    let show_overview = MenuItemBuilder::with_id("show_overview", "Year Overview")
        .accelerator("Cmd+0")
        .build(app)?;
    let show_library = MenuItemBuilder::with_id("show_library", "Show Library")
        .accelerator("Cmd+Shift+L")
        .build(app)?;
    let next_month = MenuItemBuilder::with_id("next_month", "Next Month")
        .accelerator("Cmd+Alt+Right")
        .build(app)?;
    let prev_month = MenuItemBuilder::with_id("prev_month", "Previous Month")
        .accelerator("Cmd+Alt+Left")
        .build(app)?;

    let add_month = MenuItemBuilder::with_id("add_month", "Add Month…").build(app)?;
    let duplicate_month =
        MenuItemBuilder::with_id("duplicate_month", "Duplicate Current Month…").build(app)?;
    let reorganize = MenuItemBuilder::with_id("reorganize", "Reorganize Buckets…")
        .accelerator("Cmd+R")
        .build(app)?;

    let app_submenu = SubmenuBuilder::new(app, "Budget")
        .about(None)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;

    let file_submenu = SubmenuBuilder::new(app, "File")
        .item(&new_year)
        .item(&open_file)
        .separator()
        .item(&save)
        .item(&save_as)
        .separator()
        .item(&show_default_folder)
        .separator()
        .item(&export_csv)
        .item(&export_json)
        .separator()
        .item(&toggle_autosave)
        .build()?;

    let edit_submenu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let view_submenu = SubmenuBuilder::new(app, "View")
        .item(&toggle_sidebar)
        .separator()
        .item(&show_overview)
        .item(&show_library)
        .separator()
        .item(&prev_month)
        .item(&next_month)
        .build()?;

    let budget_submenu = SubmenuBuilder::new(app, "Budget Tools")
        .item(&add_month)
        .item(&duplicate_month)
        .separator()
        .item(&reorganize)
        .build()?;

    let window_submenu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .separator()
        .close_window()
        .build()?;

    let menu = MenuBuilder::new(app)
        .items(&[
            &app_submenu,
            &file_submenu,
            &edit_submenu,
            &view_submenu,
            &budget_submenu,
            &window_submenu,
        ])
        .build()?;

    app.set_menu(menu)?;
    Ok(())
}
