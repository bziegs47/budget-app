mod commands;
mod db;
mod models;
mod period;

use rusqlite::Connection;
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
    state: tauri::State<AppState>,
    window: Window,
    target_path: String,
) -> Result<(), String> {
    let label = label_of(&window);
    let src = state.current_path(&label)?;
    let mut dest = PathBuf::from(&target_path);
    if dest.extension().is_none() {
        dest.set_extension("budget");
    }
    if dest == src {
        return Ok(());
    }
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::copy(&src, &dest).map_err(|e| format!("Could not write '{}': {e}", dest.display()))?;
    state.switch_path(&label, dest)?;
    state.mark_clean(&label);
    Ok(())
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
    let label = format!("budget-{}", &Uuid::new_v4().simple().to_string()[..12]);
    state.register_path(&label, path)?;

    let title = window_title_from_path(&PathBuf::from(&file_path));
    WebviewWindowBuilder::new(&app_handle, &label, WebviewUrl::default())
        .title(title)
        .inner_size(1180.0, 820.0)
        .build()
        .map_err(|e| e.to_string())?;

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

            build_menu(app)?;

            let app_handle = app.handle().clone();
            app.on_menu_event(move |_handle, event| {
                let id = event.id().0.as_str();
                let payload: Option<&str> = match id {
                    "next_tab" => Some("menu:next-tab"),
                    "prev_tab" => Some("menu:prev-tab"),
                    "open_file" => Some("menu:open-file"),
                    "save" => Some("menu:save"),
                    "save_as" => Some("menu:save-as"),
                    "toggle_autosave" => Some("menu:toggle-autosave"),
                    "reorganize" => Some("menu:reorganize"),
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn build_menu(app: &mut tauri::App) -> tauri::Result<()> {
    let open_file = MenuItemBuilder::with_id("open_file", "Open Budget File…")
        .accelerator("Cmd+O")
        .build(app)?;
    let save = MenuItemBuilder::with_id("save", "Save")
        .accelerator("Cmd+S")
        .build(app)?;
    let save_as = MenuItemBuilder::with_id("save_as", "Save Budget As…")
        .accelerator("Cmd+Shift+S")
        .build(app)?;
    let toggle_autosave = CheckMenuItemBuilder::with_id("toggle_autosave", "Auto-save Snapshots")
        .checked(false)
        .build(app)?;

    let reorganize = MenuItemBuilder::with_id("reorganize", "Toggle Reorganize Mode")
        .accelerator("Cmd+R")
        .build(app)?;

    let next_tab = MenuItemBuilder::with_id("next_tab", "Select Next Tab")
        .accelerator("Cmd+Alt+Right")
        .build(app)?;
    let prev_tab = MenuItemBuilder::with_id("prev_tab", "Select Previous Tab")
        .accelerator("Cmd+Alt+Left")
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
        .item(&open_file)
        .separator()
        .item(&save)
        .item(&save_as)
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

    let budget_submenu = SubmenuBuilder::new(app, "Budget Tools")
        .item(&reorganize)
        .build()?;

    let window_submenu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .separator()
        .item(&prev_tab)
        .item(&next_tab)
        .separator()
        .close_window()
        .build()?;

    let menu = MenuBuilder::new(app)
        .items(&[
            &app_submenu,
            &file_submenu,
            &edit_submenu,
            &budget_submenu,
            &window_submenu,
        ])
        .build()?;

    app.set_menu(menu)?;
    Ok(())
}
