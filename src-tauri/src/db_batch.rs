//! Atomic multi-statement write batch for the frontend DB transport.
//!
//! `tauri-plugin-sql` runs every `execute`/`select` on a connection checked out
//! from a sqlx pool with no session pinning, so emulating a transaction with
//! separate BEGIN/COMMIT IPC calls is unsafe: the statements can land on
//! different physical connections and lose atomicity. This command instead runs
//! the whole batch inside ONE held sqlx transaction.
//!
//! Batches are write-only (see the JS `batch` guard), so we execute each
//! statement and ignore any result rows — no need for the plugin's private
//! result decoder.

use tauri::State;
use tauri_plugin_sql::{DbInstances, DbPool};

const DB_URL: &str = "sqlite:dashboard.db";

#[derive(serde::Deserialize)]
pub struct BatchStmt {
    sql: String,
    params: Vec<serde_json::Value>,
}

#[tauri::command]
pub async fn db_batch(
    db_instances: State<'_, DbInstances>,
    statements: Vec<BatchStmt>,
) -> Result<(), String> {
    // tokio::sync::RwLock (confirmed via tauri-plugin-sql 2.4.0 src/lib.rs).
    let instances = db_instances.0.read().await;
    // The `DbPool::sqlite()` accessor is commented out in the published 2.4.0
    // crate, but `DbPool` and its `Sqlite(Pool<Sqlite>)` variant are public, so
    // match the variant directly. Only the `sqlite` feature is enabled, so this
    // is the sole variant (the catch-all is unreachable but future-proofs it).
    let db = instances
        .get(DB_URL)
        .ok_or_else(|| format!("sqlite pool '{DB_URL}' not loaded"))?;
    let pool = match db {
        DbPool::Sqlite(pool) => pool,
        #[allow(unreachable_patterns)]
        _ => return Err(format!("db '{DB_URL}' is not a sqlite pool")),
    };

    // One held connection for the whole batch; if `tx` drops before `commit`
    // (any `?` below), sqlx rolls the transaction back automatically.
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    for stmt in statements {
        let mut query = sqlx::query(&stmt.sql);
        // Bind params exactly like tauri-plugin-sql does (src/wrapper.rs).
        for value in stmt.params {
            if value.is_null() {
                query = query.bind(None::<serde_json::Value>);
            } else if value.is_string() {
                query = query.bind(value.as_str().unwrap().to_owned());
            } else if let Some(number) = value.as_number() {
                // Bind integers as i64 so values above 2^53 (and ordinary IDs/counts) round-trip
                // losslessly; only genuinely fractional numbers fall back to f64.
                if let Some(int) = number.as_i64() {
                    query = query.bind(int);
                } else {
                    query = query.bind(number.as_f64().unwrap_or_default());
                }
            } else {
                query = query.bind(value);
            }
        }
        query.execute(&mut *tx).await.map_err(|e| e.to_string())?;
    }
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(())
}
