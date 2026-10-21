pub mod db;

use serde::Serialize;
use tauri::Manager;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopStorageStatus {
    pub runtime: String,
    pub sqlite_engine: String,
    pub offline_ready: bool,
    pub schema_version: u32,
}

#[tauri::command]
fn get_desktop_storage_status(app_handle: tauri::AppHandle) -> DesktopStorageStatus {
    let app_dir = app_handle
        .path()
        .app_local_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir());

    let _ = std::fs::create_dir_all(&app_dir);
    let db_path = app_dir.join("flowpilot_local.db");
    let offline_ready = db::initialize_local_sqlite(&db_path).is_ok();

    DesktopStorageStatus {
        runtime: "tauri-native".to_string(),
        sqlite_engine: "rusqlite (bundled SQLite)".to_string(),
        offline_ready,
        schema_version: db::LOCAL_SCHEMA_VERSION,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![get_desktop_storage_status])
        .run(tauri::generate_context!())
        .expect("error while running FlowPilot Tauri desktop application");
}
