pub mod db;

use db::DictationHistoryRecord;
use rusqlite::Connection;
use serde::Serialize;
use std::path::PathBuf;
use tauri::Manager;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopStorageStatus {
    pub runtime: String,
    pub sqlite_engine: String,
    pub offline_ready: bool,
    pub schema_version: u32,
}

fn resolve_sqlite_path(app_handle: &tauri::AppHandle) -> PathBuf {
    let app_dir = app_handle
        .path()
        .app_local_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir());
    let _ = std::fs::create_dir_all(&app_dir);
    app_dir.join("flowpilot_local.db")
}

#[tauri::command]
fn get_desktop_storage_status(app_handle: tauri::AppHandle) -> DesktopStorageStatus {
    let db_path = resolve_sqlite_path(&app_handle);
    let offline_ready = db::initialize_local_sqlite(&db_path).is_ok();

    DesktopStorageStatus {
        runtime: "tauri-native".to_string(),
        sqlite_engine: "rusqlite (bundled SQLite)".to_string(),
        offline_ready,
        schema_version: db::LOCAL_SCHEMA_VERSION,
    }
}

#[tauri::command]
fn save_dictation_entry(
    app_handle: tauri::AppHandle,
    entry: DictationHistoryRecord,
) -> Result<(), String> {
    let db_path = resolve_sqlite_path(&app_handle);
    db::initialize_local_sqlite(&db_path).map_err(|e| e.to_string())?;
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    db::insert_history_entry(&conn, &entry).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_dictation_history(
    app_handle: tauri::AppHandle,
    search_query: Option<String>,
) -> Result<Vec<DictationHistoryRecord>, String> {
    let db_path = resolve_sqlite_path(&app_handle);
    db::initialize_local_sqlite(&db_path).map_err(|e| e.to_string())?;
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    db::query_history_entries(&conn, search_query.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_dictation_entry(app_handle: tauri::AppHandle, id: String) -> Result<(), String> {
    let db_path = resolve_sqlite_path(&app_handle);
    db::initialize_local_sqlite(&db_path).map_err(|e| e.to_string())?;
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    db::remove_history_entry(&conn, &id).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_desktop_storage_status,
            save_dictation_entry,
            list_dictation_history,
            delete_dictation_entry
        ])
        .run(tauri::generate_context!())
        .expect("error while running FlowPilot Tauri desktop application");
}
