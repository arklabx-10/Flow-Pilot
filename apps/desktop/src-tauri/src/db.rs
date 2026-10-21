use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;

pub const LOCAL_SCHEMA_VERSION: u32 = 2;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DictationHistoryRecord {
    pub id: String,
    pub original_transcript: String,
    pub refined_transcript: String,
    pub edited_text: String,
    pub output_mode: String,
    pub provider_id: String,
    pub duration_ms: u64,
    pub created_at_utc: String,
}

/// Initializes the local SQLite database used for offline dictation sessions,
/// user shortcut bindings, and searchable transcript history.
/// Raw audio is intentionally never persisted.
pub fn initialize_local_sqlite(db_path: &Path) -> Result<u32, rusqlite::Error> {
    let conn = Connection::open(db_path)?;
    initialize_connection(&conn)?;
    Ok(LOCAL_SCHEMA_VERSION)
}

pub fn initialize_connection(conn: &Connection) -> Result<(), rusqlite::Error> {
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
         );
         CREATE TABLE IF NOT EXISTS dictation_history (
             id TEXT PRIMARY KEY NOT NULL,
             original_transcript TEXT NOT NULL,
             refined_transcript TEXT NOT NULL,
             edited_text TEXT NOT NULL,
             output_mode TEXT NOT NULL,
             provider_id TEXT NOT NULL,
             duration_ms INTEGER NOT NULL,
             created_at_utc TEXT NOT NULL
         );",
    )?;
    Ok(())
}

pub fn insert_history_entry(
    conn: &Connection,
    entry: &DictationHistoryRecord,
) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT OR REPLACE INTO dictation_history (
            id,
            original_transcript,
            refined_transcript,
            edited_text,
            output_mode,
            provider_id,
            duration_ms,
            created_at_utc
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            entry.id,
            entry.original_transcript,
            entry.refined_transcript,
            entry.edited_text,
            entry.output_mode,
            entry.provider_id,
            entry.duration_ms as i64,
            entry.created_at_utc,
        ],
    )?;
    Ok(())
}

pub fn query_history_entries(
    conn: &Connection,
    search_query: Option<&str>,
) -> Result<Vec<DictationHistoryRecord>, rusqlite::Error> {
    let pattern = search_query
        .map(str::trim)
        .filter(|q| !q.is_empty())
        .map(|q| format!("%{}%", q.to_lowercase()));

    let mut stmt = conn.prepare(
        "SELECT
            id,
            original_transcript,
            refined_transcript,
            edited_text,
            output_mode,
            provider_id,
            duration_ms,
            created_at_utc
         FROM dictation_history
         WHERE (?1 IS NULL
            OR LOWER(original_transcript) LIKE ?1
            OR LOWER(refined_transcript) LIKE ?1
            OR LOWER(edited_text) LIKE ?1
            OR LOWER(output_mode) LIKE ?1)
         ORDER BY created_at_utc DESC",
    )?;

    let rows = stmt.query_map(params![pattern], |row| {
        let duration: i64 = row.get(6)?;
        Ok(DictationHistoryRecord {
            id: row.get(0)?,
            original_transcript: row.get(1)?,
            refined_transcript: row.get(2)?,
            edited_text: row.get(3)?,
            output_mode: row.get(4)?,
            provider_id: row.get(5)?,
            duration_ms: duration.max(0) as u64,
            created_at_utc: row.get(7)?,
        })
    })?;

    let mut results = Vec::new();
    for item in rows {
        results.push(item?);
    }
    Ok(results)
}

pub fn remove_history_entry(conn: &Connection, id: &str) -> Result<(), rusqlite::Error> {
    conn.execute("DELETE FROM dictation_history WHERE id = ?1", params![id])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saves_searches_and_deletes_dictation_history_in_sqlite() {
        let conn = Connection::open_in_memory().expect("in-memory sqlite should open");
        initialize_connection(&conn).expect("schema bootstrap should succeed");

        let record = DictationHistoryRecord {
            id: "entry-1".to_string(),
            original_transcript: "um test sqlite persistence".to_string(),
            refined_transcript: "Test sqlite persistence.".to_string(),
            edited_text: "Test SQLite persistence on Windows.".to_string(),
            output_mode: "clean".to_string(),
            provider_id: "openai-whisper".to_string(),
            duration_ms: 1900,
            created_at_utc: "2026-10-21T18:00:00Z".to_string(),
        };

        insert_history_entry(&conn, &record).expect("insert should succeed");

        let found = query_history_entries(&conn, Some("windows")).expect("query should succeed");
        assert_eq!(found.len(), 1);
        assert_eq!(found[0], record);

        remove_history_entry(&conn, "entry-1").expect("delete should succeed");
        let after_delete = query_history_entries(&conn, None).expect("query should succeed");
        assert!(after_delete.is_empty());
    }
}
