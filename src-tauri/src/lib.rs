mod commands;
mod db;
mod models;

use std::sync::Mutex;
use tauri::Manager;

pub struct AppState {
    pub db: Mutex<rusqlite::Connection>,
}

#[tauri::command]
fn list_months(state: tauri::State<AppState>) -> Result<Vec<models::MonthRow>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    commands::list_months(&conn)
}

#[tauri::command]
fn get_month_view(
    state: tauri::State<AppState>,
    year_month: String,
) -> Result<models::MonthView, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    commands::get_month_view(&conn, &year_month)
}

#[tauri::command]
fn ensure_month(state: tauri::State<AppState>, year_month: String) -> Result<i64, String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    commands::ensure_month(&mut conn, &year_month)
}

#[tauri::command]
fn duplicate_month(
    state: tauri::State<AppState>,
    from_year_month: String,
    to_year_month: String,
) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    commands::duplicate_month(&mut conn, &from_year_month, &to_year_month)
}

#[tauri::command]
fn set_income_line_planned(
    state: tauri::State<AppState>,
    id: i64,
    planned_cents: i64,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    commands::set_income_line_planned(&conn, id, planned_cents)
}

#[tauri::command]
fn set_expense_line_planned(
    state: tauri::State<AppState>,
    id: i64,
    planned_cents: i64,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    commands::set_expense_line_planned(&conn, id, planned_cents)
}

#[tauri::command]
fn add_transaction(
    state: tauri::State<AppState>,
    expense_line_id: i64,
    payee: String,
    amount_cents: i64,
    occurred_on: Option<String>,
) -> Result<i64, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    commands::add_transaction(&conn, expense_line_id, payee, amount_cents, occurred_on)
}

#[tauri::command]
fn delete_transaction(state: tauri::State<AppState>, id: i64) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    commands::delete_transaction(&conn, id)
}

#[tauri::command]
fn add_income_entry(
    state: tauri::State<AppState>,
    income_line_id: i64,
    label: String,
    amount_cents: i64,
    received_on: Option<String>,
) -> Result<i64, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    commands::add_income_entry(&conn, income_line_id, label, amount_cents, received_on)
}

#[tauri::command]
fn delete_income_entry(state: tauri::State<AppState>, id: i64) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    commands::delete_income_entry(&conn, id)
}

#[tauri::command]
fn export_csv_data(state: tauri::State<AppState>) -> Result<String, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    commands::export_csv(&conn)
}

#[tauri::command]
fn get_database_path() -> String {
    commands::database_file_path()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let conn = db::open_connection().map_err(|e| e.to_string())?;
            app.manage(AppState {
                db: Mutex::new(conn),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_months,
            get_month_view,
            ensure_month,
            duplicate_month,
            set_income_line_planned,
            set_expense_line_planned,
            add_transaction,
            delete_transaction,
            add_income_entry,
            delete_income_entry,
            export_csv_data,
            get_database_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
