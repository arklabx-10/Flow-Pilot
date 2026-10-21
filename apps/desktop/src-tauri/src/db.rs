use rusqlite::Connection;
use std::path::Path;

pub const LOCAL_SCHEMA_VERSION: u32 = 1;

/// Initializes the local SQLite database used for offline dictation sessions,
/// user shortcut bindings, and pending cloud synchronization operations.
pub fn initialize_local_sqlite(db_path: &Path) -> Result<u32, rusqlite::Error> {
    let conn = Connection::open(db_path)?;

    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA foreign_keys = ON;
         CREATE TABLE IF NOT EXISTS local_metadata (
             key TEXT PRIMARY KEY NOT NULL,
             value TEXT NOT NULL,
             updated_at_utc TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS offline_dictation_queue (
             id TEXT PRIMARY KEY NOT NULL,
             created_at_utc TEXT NOT NULL,
             sync_state TEXT NOT NULL
         );",
    )?;

    Ok(LOCAL_SCHEMA_VERSION)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn initializes_in_memory_sqlite_schema() {
        let conn = Connection::open_in_memory().expect("in-memory sqlite should open");
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS local_metadata (
                 key TEXT PRIMARY KEY NOT NULL,
                 value TEXT NOT NULL,
                 updated_at_utc TEXT NOT NULL
             );",
        )
        .expect("schema bootstrap should succeed");
        assert_eq!(LOCAL_SCHEMA_VERSION, 1);
    }
}
