//! Row order — the user's own order for the sections and items of a card
//! (docs/features/MOVABLE-ROWS.md). One table for all of it (fork 4C, the owner 2026-09-20).
//!
//! A **scope** is one ordered list: `settings.sections`, `home.shelves`,
//! `radio.sections`, `playlists.sections`, `playlists.folder:<key>` (the playlists inside
//! one folder or cluster) and `pins` (the pinned tiles, every shelf that draws them).
//!
//! A scope holds only the ids the user has moved past — it is a RANK LIST, not a copy of
//! the list. An id the rank list does not name is **unranked** and sorts last, in the
//! card's own built-in order (fork 3A). So a Home shelf a later version adds, or a folder
//! made after the last drag, appears at the end and never inside the user's order.
//!
//! An id that no longer exists is kept. A folder deleted today may be a folder restored
//! tomorrow, the rows are two columns wide, and a dead id costs one skipped compare.
//!
//! Why SQLite and not `localStorage`, where every fold in this app lives: this is the one
//! store that survives a cleared WebView cache, rides the same backup as the library, and
//! can be read by the `query` MCP tool (LOCAL-DATA.md).

use rusqlite::Connection;


fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// v13 (2026-09-20): the `row_order` table (MOVABLE-ROWS.md §3). Additive, idempotent.
pub fn migrate_v13(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS row_order (
            scope TEXT NOT NULL,
            id    TEXT NOT NULL,
            rank  INTEGER NOT NULL,
            PRIMARY KEY (scope, id)
        );",
    )
    .map_err(|e| format!("create row_order: {e}"))?;
    crate::library::meta_set(conn, "schema_version", "13")
}

#[derive(serde::Serialize)]
pub struct OrderRow {
    pub scope: String,
    pub id: String,
    pub rank: i64,
}

/// Every saved order, in one read. The front end asks once at start and keeps the map
/// (src/row-order.ts): a sort must never wait on the database, and these lists are short.
#[tauri::command]
pub async fn row_order_all(app: tauri::AppHandle) -> Result<Vec<OrderRow>, String> {
    crate::db_thread::run(&app, move |db| {
        let conn = db.lock();
        let mut stmt = conn
            .prepare_cached("SELECT scope, id, rank FROM row_order ORDER BY scope, rank")
            .map_err(err)?;
        let rows = stmt
            .query_map([], |r| Ok(OrderRow { scope: r.get(0)?, id: r.get(1)?, rank: r.get(2)? }))
            .map_err(err)?;
        rows.collect::<Result<_, _>>().map_err(err)
    })
    .await
}

/// Replace one scope's whole list. The caller sends the order it wants to see, so the
/// write is a delete plus an insert inside ONE transaction — a half-written order would
/// read as a shuffled card.
#[tauri::command]
pub async fn row_order_set(scope: String, ids: Vec<String>, app: tauri::AppHandle) -> Result<(), String> {
    crate::db_thread::run(&app, move |db| {
        if scope.is_empty() {
            return Err("row_order: empty scope".into());
        }
        let mut conn = db.lock();
        let tx = conn.transaction().map_err(err)?;
        tx.execute("DELETE FROM row_order WHERE scope = ?1", [&scope]).map_err(err)?;
        {
            let mut ins = tx
                .prepare("INSERT INTO row_order(scope, id, rank) VALUES(?1, ?2, ?3)")
                .map_err(err)?;
            for (i, id) in ids.iter().enumerate() {
                ins.execute(rusqlite::params![scope, id, i as i64]).map_err(err)?;
            }
        }
        tx.commit().map_err(err)?;
        Ok(())
    })
    .await
}

/// Forget one scope's order, or every scope (Settings › Reset, MOVABLE-ROWS.md §4.4).
/// Forgetting is the whole reset: with no rows, every id is unranked and the card draws
/// its built-in order again.
#[tauri::command]
pub async fn row_order_reset(scope: Option<String>, app: tauri::AppHandle) -> Result<(), String> {
    crate::db_thread::run(&app, move |db| {
        let conn = db.lock();
        match scope {
            Some(s) => conn.execute("DELETE FROM row_order WHERE scope = ?1", [&s]).map_err(err)?,
            None => conn.execute("DELETE FROM row_order", []).map_err(err)?,
        };
        Ok(())
    })
    .await
}
