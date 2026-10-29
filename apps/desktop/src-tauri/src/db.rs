use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;

pub const LOCAL_SCHEMA_VERSION: u32 = 4;

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
    #[serde(default)]
    pub version: i32,
    #[serde(default = "default_sync_state")]
    pub sync_state: String,
}

fn default_sync_state() -> String {
    "local-only".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OfflineSyncQueueRecord {
    pub id: String,
    pub entity_type: String,
    pub entity_id: String,
    pub operation_type: String,
    pub idempotency_key: String,
    pub expected_version: i32,
    pub payload_json: String,
    pub sync_state: String,
    pub attempt_count: i32,
    pub next_retry_at_utc: Option<String>,
    pub last_error: Option<String>,
    pub conflict_server_json: Option<String>,
    pub created_at_utc: String,
    pub updated_at_utc: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SyncedNoteRecord {
    pub id: String,
    pub title: String,
    pub content: String,
    pub folder: String,
    pub tags_json: String,
    pub source_transcript_id: Option<String>,
    pub version: i32,
    pub updated_at_utc: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalVocabularyRecord {
    pub id: String,
    pub spoken_phrase: String,
    pub replacement_term: String,
    pub category: String,
    pub updated_at_utc: String,
}

/// Initializes the local SQLite database used for offline dictation sessions,
/// user shortcut bindings, offline sync queue, and searchable transcript history.
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
             entity_type TEXT NOT NULL DEFAULT 'transcript',
             entity_id TEXT NOT NULL DEFAULT '',
             operation_type TEXT NOT NULL DEFAULT 'upsert',
             idempotency_key TEXT NOT NULL DEFAULT '',
             expected_version INTEGER NOT NULL DEFAULT 0,
             payload_json TEXT NOT NULL DEFAULT '{}',
             sync_state TEXT NOT NULL,
             attempt_count INTEGER NOT NULL DEFAULT 0,
             next_retry_at_utc TEXT NULL,
             last_error TEXT NULL,
             conflict_server_json TEXT NULL,
             created_at_utc TEXT NOT NULL,
             updated_at_utc TEXT NOT NULL DEFAULT ''
         );
         CREATE TABLE IF NOT EXISTS dictation_history (
             id TEXT PRIMARY KEY NOT NULL,
             original_transcript TEXT NOT NULL,
             refined_transcript TEXT NOT NULL,
             edited_text TEXT NOT NULL,
             output_mode TEXT NOT NULL,
             provider_id TEXT NOT NULL,
             duration_ms INTEGER NOT NULL,
             created_at_utc TEXT NOT NULL,
             version INTEGER NOT NULL DEFAULT 0,
             sync_state TEXT NOT NULL DEFAULT 'local-only'
         );
         CREATE TABLE IF NOT EXISTS synced_notes (
             id TEXT PRIMARY KEY NOT NULL,
             title TEXT NOT NULL,
             content TEXT NOT NULL,
             folder TEXT NOT NULL,
             tags_json TEXT NOT NULL,
             source_transcript_id TEXT NULL,
             version INTEGER NOT NULL DEFAULT 1,
             updated_at_utc TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS custom_vocabulary (
             id TEXT PRIMARY KEY NOT NULL,
             spoken_phrase TEXT NOT NULL,
             replacement_term TEXT NOT NULL,
             category TEXT NOT NULL,
             updated_at_utc TEXT NOT NULL
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
            created_at_utc,
            version,
            sync_state
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            entry.id,
            entry.original_transcript,
            entry.refined_transcript,
            entry.edited_text,
            entry.output_mode,
            entry.provider_id,
            entry.duration_ms as i64,
            entry.created_at_utc,
            entry.version,
            entry.sync_state,
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
            created_at_utc,
            version,
            sync_state
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
            version: row.get(8).unwrap_or(0),
            sync_state: row.get(9).unwrap_or_else(|_| "local-only".to_string()),
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

pub fn upsert_sync_queue_item(
    conn: &Connection,
    item: &OfflineSyncQueueRecord,
) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT OR REPLACE INTO offline_dictation_queue (
            id,
            entity_type,
            entity_id,
            operation_type,
            idempotency_key,
            expected_version,
            payload_json,
            sync_state,
            attempt_count,
            next_retry_at_utc,
            last_error,
            conflict_server_json,
            created_at_utc,
            updated_at_utc
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        params![
            item.id,
            item.entity_type,
            item.entity_id,
            item.operation_type,
            item.idempotency_key,
            item.expected_version,
            item.payload_json,
            item.sync_state,
            item.attempt_count,
            item.next_retry_at_utc,
            item.last_error,
            item.conflict_server_json,
            item.created_at_utc,
            item.updated_at_utc,
        ],
    )?;
    Ok(())
}

pub fn list_sync_queue_items(conn: &Connection) -> Result<Vec<OfflineSyncQueueRecord>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT
            id,
            entity_type,
            entity_id,
            operation_type,
            idempotency_key,
            expected_version,
            payload_json,
            sync_state,
            attempt_count,
            next_retry_at_utc,
            last_error,
            conflict_server_json,
            created_at_utc,
            updated_at_utc
         FROM offline_dictation_queue
         ORDER BY created_at_utc ASC",
    )?;

    let rows = stmt.query_map([], |row| {
        Ok(OfflineSyncQueueRecord {
            id: row.get(0)?,
            entity_type: row.get(1)?,
            entity_id: row.get(2)?,
            operation_type: row.get(3)?,
            idempotency_key: row.get(4)?,
            expected_version: row.get(5)?,
            payload_json: row.get(6)?,
            sync_state: row.get(7)?,
            attempt_count: row.get(8)?,
            next_retry_at_utc: row.get(9)?,
            last_error: row.get(10)?,
            conflict_server_json: row.get(11)?,
            created_at_utc: row.get(12)?,
            updated_at_utc: row.get(13)?,
        })
    })?;

    let mut results = Vec::new();
    for item in rows {
        results.push(item?);
    }
    Ok(results)
}

pub fn remove_sync_queue_item(conn: &Connection, id: &str) -> Result<(), rusqlite::Error> {
    conn.execute("DELETE FROM offline_dictation_queue WHERE id = ?1", params![id])?;
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
            version: 1,
            sync_state: "synced".to_string(),
        };

        insert_history_entry(&conn, &record).expect("insert should succeed");

        let found = query_history_entries(&conn, Some("windows")).expect("query should succeed");
        assert_eq!(found.len(), 1);
        assert_eq!(found[0], record);

        let queue_item = OfflineSyncQueueRecord {
            id: "q-1".to_string(),
            entity_type: "transcript".to_string(),
            entity_id: "entry-1".to_string(),
            operation_type: "upsert".to_string(),
            idempotency_key: "idem-1".to_string(),
            expected_version: 0,
            payload_json: "{\"id\":\"entry-1\"}".to_string(),
            sync_state: "pending-sync".to_string(),
            attempt_count: 0,
            next_retry_at_utc: None,
            last_error: None,
            conflict_server_json: None,
            created_at_utc: "2026-10-21T18:00:00Z".to_string(),
            updated_at_utc: "2026-10-21T18:00:00Z".to_string(),
        };

        upsert_sync_queue_item(&conn, &queue_item).expect("queue insert should succeed");
        let queue_list = list_sync_queue_items(&conn).expect("queue list should succeed");
        assert_eq!(queue_list.len(), 1);
        assert_eq!(queue_list[0], queue_item);
        remove_sync_queue_item(&conn, "q-1").expect("queue remove should succeed");
        assert!(list_sync_queue_items(&conn).expect("empty queue").is_empty());

        remove_history_entry(&conn, "entry-1").expect("delete should succeed");
        let after_delete = query_history_entries(&conn, None).expect("query should succeed");
        assert!(after_delete.is_empty());
    }
}
