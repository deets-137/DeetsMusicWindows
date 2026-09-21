//! Song of the Day (docs/integrations/DeetsOTD.md §8) — one song you mark for one day, kept here and,
//! if you set an outlet up, sent out once.
//!
//! Three parts, all in Rust so the rules hold whoever asks (the window, an agent, a missed
//! timer at the next start):
//! - **The picks** — the `picks` table, one row per marked song, with the journal day the
//!   app computed at mark time. `meta` is the song as it was, so a pick still draws after
//!   the song leaves the library.
//! - **The outlets** (`outlet.rs`, `discord.rs`) — a place a pick is sent to. Build 1 has
//!   one, the Discord webhook. The trait is shaped for the three the doc names.
//! - **The outbox** (`outbox.rs`) — when a pick is sent: at once, at a set time, or after
//!   the user answers the Ask toast. It survives a restart, and it never retries in a loop.
//!
//! The journal day is the app's own: the system time zone, with the "Day starts at" hour
//! taken off the clock first. At 5 AM a mark at 12:30 AM belongs to the day before.

pub mod discord;
pub mod outbox;
pub mod outlet;

use chrono::{Datelike, Duration as ChronoDuration, Local, NaiveDate, TimeZone};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::library::Db;
use crate::settings::Settings;

// ── the table ────────────────────────────────────────────────────────────────

/// v10 (2026-09-18): `picks` + `pick_posts` (DeetsOTD.md §8.1). Additive, idempotent.
/// Posts live in their own table, so a second outlet is a new row and not a migration.
pub fn migrate_v10(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS picks (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            source      TEXT NOT NULL,
            day         TEXT NOT NULL,
            track_id    TEXT NOT NULL,
            meta        TEXT NOT NULL,
            note        TEXT,
            marked_at   INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_picks_day ON picks(day);
        CREATE TABLE IF NOT EXISTS pick_posts (
            pick_id     INTEGER NOT NULL,
            outlet      TEXT NOT NULL,
            state       TEXT NOT NULL,
            due_ts      INTEGER,
            remote_id   TEXT,
            error       TEXT,
            at          INTEGER,
            PRIMARY KEY (pick_id, outlet)
        );",
    )
    .map_err(|e| format!("create picks: {e}"))?;
    // `at` (when the state last changed) arrived after the table did, while v10 was still
    // unreleased — so it is added here rather than in a v11 nobody would ever need. It is
    // what the user's own record of what has left the app is ordered by (§10.7).
    let has: i64 = conn
        .query_row("SELECT COUNT(*) FROM pragma_table_info('pick_posts') WHERE name = 'at'", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if has == 0 {
        conn.execute_batch("ALTER TABLE pick_posts ADD COLUMN at INTEGER;")
            .map_err(|e| format!("add pick_posts.at: {e}"))?;
        crate::log::info("migration: v10 added pick_posts.at");
    }
    crate::library::meta_set(conn, "schema_version", "10")
}

// ── the journal day ──────────────────────────────────────────────────────────

/// The day a moment belongs to, as `YYYY-MM-DD`, in the system time zone with the grace
/// hour taken off first. `grace` is the "Day starts at" hour (0 = midnight, 5 = 5 AM).
pub fn day_of(ms: i64, grace: u8) -> String {
    let t = Local.timestamp_millis_opt(ms).single().unwrap_or_else(Local::now);
    (t - ChronoDuration::hours(grace as i64)).format("%Y-%m-%d").to_string()
}

/// When a journal day ends, in epoch-ms: the next day's date at the grace hour. A post
/// after this lands on the next day at Discord, which is why a set time never crosses it.
pub fn day_ends(day: &str, grace: u8) -> i64 {
    let Ok(d) = NaiveDate::parse_from_str(day, "%Y-%m-%d") else { return 0 };
    let next = d + ChronoDuration::days(1);
    Local
        .with_ymd_and_hms(next.year(), next.month(), next.day(), grace as u32, 0, 0)
        .single()
        .map(|t| t.timestamp_millis())
        .unwrap_or(0)
}

/// The epoch-ms of a clock time (`HH:MM`) inside a journal day. Every clock time falls in
/// exactly one journal day under both day rules: at 5 AM, 02:00 belongs to the date before.
pub fn time_in_day(day: &str, hhmm: &str, grace: u8) -> i64 {
    let Ok(d) = NaiveDate::parse_from_str(day, "%Y-%m-%d") else { return 0 };
    let (h, m) = match hhmm.split_once(':') {
        Some((a, b)) => (a.parse::<u32>().unwrap_or(20), b.parse::<u32>().unwrap_or(0)),
        None => (20, 0),
    };
    // A time before the grace hour belongs to the calendar date AFTER the journal day's own.
    let date = if h < grace as u32 { d + ChronoDuration::days(1) } else { d };
    Local
        .with_ymd_and_hms(date.year(), date.month(), date.day(), h, m, 0)
        .single()
        .map(|t| t.timestamp_millis())
        .unwrap_or(0)
}

pub fn now_ms() -> i64 {
    Local::now().timestamp_millis()
}

/// Today's journal day, as the app reads the clock right now.
#[tauri::command]
pub fn pick_today(settings: State<'_, Settings>) -> String {
    day_of(now_ms(), settings.get().sotd_day_start)
}

// ── the rows ─────────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PickPost {
    pub outlet: String,
    /// `asking` (the Ask toast is out) · `waiting` (a set time) · `sent` · `failed` ·
    /// `skipped` (never sent) · `withdrawn` (sent, then taken down again — §10.7).
    pub state: String,
    pub due_ts: Option<i64>,
    pub remote_id: Option<String>,
    pub error: Option<String>,
    /// When the state last changed, epoch-ms. The user's record of what left the app reads it.
    pub at: Option<i64>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Pick {
    pub id: i64,
    /// `app` (marked here) · `import` (the owner's journal, §8.13).
    pub source: String,
    pub day: String,
    pub track_id: String,
    /// The song as it was at mark time — still the Track JSON the front end sent.
    pub meta: serde_json::Value,
    pub note: Option<String>,
    pub marked_at: i64,
    pub posts: Vec<PickPost>,
}

pub(crate) fn read_posts(conn: &Connection, pick_id: i64) -> Vec<PickPost> {
    let Ok(mut stmt) = conn.prepare_cached(
        "SELECT outlet, state, due_ts, remote_id, error, at FROM pick_posts WHERE pick_id = ?1 ORDER BY outlet",
    ) else {
        return vec![];
    };
    stmt.query_map([pick_id], |r| {
        Ok(PickPost {
            outlet: r.get(0)?,
            state: r.get(1)?,
            due_ts: r.get(2)?,
            remote_id: r.get(3)?,
            error: r.get(4)?,
            at: r.get(5)?,
        })
    })
    .map(|it| it.filter_map(Result::ok).collect())
    .unwrap_or_default()
}

type Row = (i64, String, String, String, String, Option<String>, i64);

fn row_to_pick(conn: &Connection, r: Row) -> Pick {
    let (id, source, day, track_id, meta, note, marked_at) = r;
    Pick {
        id,
        source,
        day,
        track_id,
        meta: serde_json::from_str(&meta).unwrap_or(serde_json::Value::Null),
        note,
        marked_at,
        posts: read_posts(conn, id),
    }
}

const SELECT_PICK: &str = "SELECT id, source, day, track_id, meta, note, marked_at FROM picks";

/// Every pick in a day range (both ends inclusive, `YYYY-MM-DD`), newest first. No range =
/// all of them: the shelf takes the head, Rewind filters by its own window.
#[tauri::command]
pub fn picks_list(from: Option<String>, to: Option<String>, db: State<'_, Db>) -> Result<Vec<Pick>, String> {
    let conn = db.lock();
    let lo = from.unwrap_or_else(|| "0000-00-00".into());
    let hi = to.unwrap_or_else(|| "9999-99-99".into());
    let sql = format!("{SELECT_PICK} WHERE day >= ?1 AND day <= ?2 ORDER BY day DESC, marked_at DESC");
    let mut stmt = conn.prepare_cached(&sql).map_err(|e| e.to_string())?;
    let rows: Vec<Row> = stmt
        .query_map(params![lo, hi], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?))
        })
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();
    Ok(rows.into_iter().map(|r| row_to_pick(&conn, r)).collect())
}

fn one_pick(conn: &Connection, id: i64) -> Option<Pick> {
    let sql = format!("{SELECT_PICK} WHERE id = ?1");
    let mut stmt = conn.prepare_cached(&sql).ok()?;
    let row: Row = stmt
        .query_row([id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?)))
        .ok()?;
    Some(row_to_pick(conn, row))
}

pub fn pick_by_id(app: &AppHandle, id: i64) -> Option<Pick> {
    let db = app.state::<Db>();
    let conn = db.lock();
    one_pick(&conn, id)
}

/// The window redraws: the shelf, Rewind's Picks, the Settings status lines.
pub fn changed(app: &AppHandle) {
    let _ = app.emit("sotd-changed", ());
}

// ── marking ──────────────────────────────────────────────────────────────────

/// What a mark left behind, so the caller can ask about it: the new pick, and the posts of
/// any pick it replaced that had already gone out (§8.5 Replace).
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MarkResult {
    pub pick: Pick,
    /// Every remote post the replaced picks left behind, for "Also delete the posts?".
    pub orphans: Vec<Orphan>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Orphan {
    pub outlet: String,
    pub remote_id: String,
}

pub fn title_of(meta: &serde_json::Value) -> String {
    meta.get("title").and_then(|v| v.as_str()).unwrap_or("this song").to_string()
}

/// Mark a song as a Song of the Day. The day is the app's own — never the caller's — so an
/// agent, the window and a replay of the same call all land on the same day.
///
/// `replace` takes today's oldest picks away first; without it, a mark at the limit is
/// refused, and the caller is the one that knows to offer Replace.
#[tauri::command]
pub fn pick_mark(
    track: serde_json::Value,
    note: Option<String>,
    replace: Option<bool>,
    app: AppHandle,
    db: State<'_, Db>,
    settings: State<'_, Settings>,
) -> Result<MarkResult, String> {
    let s = settings.get();
    if !s.sotd {
        return Err("sotd-off".into());
    }
    // No catalog id, no link to post and nothing Apple can resolve: the menu hides the item,
    // and an agent gets the same answer instead of a pick that can never go out.
    let track_id = track.get("catalogId").and_then(|v| v.as_str()).ok_or("no-catalog-id")?.to_string();
    let day = day_of(now_ms(), s.sotd_day_start);
    let meta = serde_json::to_string(&track).map_err(|e| e.to_string())?;

    let (id, orphans) = {
        let conn = db.lock();
        let today: Vec<(i64, String)> = {
            let mut stmt = conn
                .prepare_cached("SELECT id, track_id FROM picks WHERE day = ?1 AND source = 'app' ORDER BY marked_at")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([&day], |r| Ok((r.get(0)?, r.get(1)?)))
                .map_err(|e| e.to_string())?
                .filter_map(Result::ok)
                .collect();
            rows
        };
        // Already today's pick: marking it again is not a second pick.
        if today.iter().any(|(_, t)| t == &track_id) {
            return Err("already-picked".into());
        }
        let limit = s.sotd_picks_per_day as usize; // 0 = no limit
        let mut orphans: Vec<Orphan> = vec![];
        if limit > 0 && today.len() >= limit {
            if !replace.unwrap_or(false) {
                return Err("limit".into());
            }
            // Replace: the oldest picks go, so the day holds the limit again.
            let drop_count = today.len() + 1 - limit;
            for (old_id, _) in today.iter().take(drop_count) {
                for p in read_posts(&conn, *old_id) {
                    if p.state == "sent" {
                        if let Some(rid) = p.remote_id {
                            orphans.push(Orphan { outlet: p.outlet, remote_id: rid });
                        }
                    }
                }
                let _ = conn.execute("DELETE FROM pick_posts WHERE pick_id = ?1", [old_id]);
                let _ = crate::dbhealth::watch("pick replace", conn.execute("DELETE FROM picks WHERE id = ?1", [old_id]));
            }
        }
        crate::dbhealth::watch(
            "pick mark",
            conn.execute(
                "INSERT INTO picks(source, day, track_id, meta, note, marked_at) VALUES('app', ?1, ?2, ?3, ?4, ?5)",
                params![day, track_id, meta, note, now_ms()],
            ),
        )
        .map_err(|e| e.to_string())?;
        (conn.last_insert_rowid(), orphans)
    };

    crate::log::info(&format!("sotd:mark day={day} id={id}"));
    outbox::after_mark(&app, id);
    changed(&app);
    let pick = pick_by_id(&app, id).ok_or("pick vanished")?;
    Ok(MarkResult { pick, orphans })
}

/// Add, change or clear a pick's note. The note is the message's second line, so it only
/// reaches an outlet on a post that has not gone out yet.
#[tauri::command]
pub fn pick_note(id: i64, note: Option<String>, app: AppHandle, db: State<'_, Db>) -> Result<(), String> {
    {
        let conn = db.lock();
        crate::dbhealth::watch("pick note", conn.execute("UPDATE picks SET note = ?1 WHERE id = ?2", params![note, id]))
            .map_err(|e| e.to_string())?;
    }
    changed(&app);
    Ok(())
}

/// Take a pick away. `delete_post` also deletes what went out, where the outlet allows it
/// (9d; Delete is the first button at the call site). A post we cannot delete leaves a warn.
#[tauri::command]
pub async fn pick_unmark(id: i64, delete_post: bool, app: AppHandle) -> Result<(), String> {
    let posts = {
        let db = app.state::<Db>();
        let conn = db.lock();
        read_posts(&conn, id)
    };
    if delete_post {
        for p in &posts {
            if p.state == "sent" {
                if let Some(rid) = &p.remote_id {
                    outlet::delete_post(&app, &p.outlet, rid).await;
                }
            }
        }
    }
    {
        let db = app.state::<Db>();
        let conn = db.lock();
        let _ = conn.execute("DELETE FROM pick_posts WHERE pick_id = ?1", [id]);
        crate::dbhealth::watch("pick unmark", conn.execute("DELETE FROM picks WHERE id = ?1", [id]))
            .map_err(|e| e.to_string())?;
    }
    crate::log::info(&format!("sotd:unmark id={id} deletePost={delete_post}"));
    outbox::rearm(&app);
    changed(&app);
    Ok(())
}

/// Delete remote posts by hand — the Replace toast's "Delete", which acts on posts whose
/// pick is already gone.
#[tauri::command]
pub async fn pick_delete_posts(orphans: Vec<Orphan>, app: AppHandle) -> Result<(), String> {
    for o in orphans {
        outlet::delete_post(&app, &o.outlet, &o.remote_id).await;
    }
    Ok(())
}

/// Take a posted message down and KEEP the pick (§10.7). The pick stays in the journal, on
/// Home and in Rewind; only what left the app is recalled. The row then reads `withdrawn`, so
/// Post Now can send it again — a new message, with a new time in the channel.
///
/// Separate from `pick_unmark` on purpose: unmarking is about the journal, this is about the
/// channel, and an hour later they are rarely the same wish.
#[tauri::command]
pub async fn pick_withdraw(id: i64, app: AppHandle) -> Result<(), String> {
    let posts = {
        let db = app.state::<Db>();
        let conn = db.lock();
        read_posts(&conn, id)
    };
    let mut pulled = 0;
    for p in &posts {
        if p.state != "sent" {
            continue;
        }
        let Some(rid) = &p.remote_id else { continue };
        outlet::delete_post(&app, &p.outlet, rid).await;
        {
            let db = app.state::<Db>();
            let conn = db.lock();
            let _ = crate::dbhealth::watch(
                "pick withdraw",
                conn.execute(
                    "UPDATE pick_posts SET state = 'withdrawn', remote_id = NULL, error = NULL, at = ?1
                     WHERE pick_id = ?2 AND outlet = ?3",
                    params![now_ms(), id, p.outlet],
                ),
            );
        }
        crate::log::info(&format!("sotd:post:withdraw outlet={} id={id}", p.outlet));
        pulled += 1;
    }
    if pulled == 0 {
        return Err("nothing-posted".into());
    }
    changed(&app);
    Ok(())
}

/// The user's own record of what has left the app (§10.7): one row per send, newest first.
/// It names the song and the place, never a webhook link or a token.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PostRecord {
    pub pick_id: i64,
    pub day: String,
    pub title: String,
    pub artist: String,
    pub outlet: String,
    pub state: String,
    pub at: Option<i64>,
    pub error: Option<String>,
}

#[tauri::command]
pub fn post_log(db: State<'_, Db>) -> Result<Vec<PostRecord>, String> {
    let conn = db.lock();
    let mut stmt = conn
        .prepare_cached(
            "SELECT p.pick_id, k.day, k.meta, p.outlet, p.state, p.at, p.error
             FROM pick_posts p JOIN picks k ON k.id = p.pick_id
             ORDER BY COALESCE(p.at, k.marked_at) DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            let meta: String = r.get(2)?;
            let v: serde_json::Value = serde_json::from_str(&meta).unwrap_or(serde_json::Value::Null);
            Ok(PostRecord {
                pick_id: r.get(0)?,
                day: r.get(1)?,
                title: title_of(&v),
                artist: v.get("artistName").and_then(|x| x.as_str()).unwrap_or("").to_string(),
                outlet: r.get(3)?,
                state: r.get(4)?,
                at: r.get(5)?,
                error: r.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

/// The Ask toast's "Post", and the tile menu's Post Now.
#[tauri::command]
pub async fn pick_post(id: i64, app: AppHandle) -> Result<(), String> {
    outbox::post_now(&app, id).await;
    Ok(())
}

/// "Not now": the pick stays, the post does not go, and the tile menu offers Post Now.
#[tauri::command]
pub fn pick_skip(id: i64, app: AppHandle) -> Result<(), String> {
    {
        let db = app.state::<Db>();
        let conn = db.lock();
        let _ = conn.execute(
            "UPDATE pick_posts SET state = 'skipped', at = ?1 WHERE pick_id = ?2 AND state = 'asking'",
            params![now_ms(), id],
        );
    }
    crate::log::info(&format!("sotd:post:skip id={id}"));
    changed(&app);
    Ok(())
}

// ── setup ────────────────────────────────────────────────────────────────────

/// From `lib.rs`, after the db and the settings are managed: the outlets we have, and the
/// posts that were waiting when the app last closed.
pub fn setup(app: &AppHandle, dir: std::path::PathBuf) {
    outlet::setup(app, dir);
    outbox::setup(app);
}

/// The Song of the Day switch went off or on (§8.4). Off stops the timer and keeps every
/// pick; on takes the waiting posts back up under the missed-time rule.
pub fn switched(app: &AppHandle, on: bool) {
    crate::log::info(if on { "sotd:on" } else { "sotd:off" });
    if on {
        outbox::setup(app);
    } else {
        outbox::stop();
    }
    changed(app);
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The grace hour moves a late-night moment back a day, and nothing else.
    #[test]
    fn day_rule() {
        // 2026-09-18 02:30 local.
        let late = Local.with_ymd_and_hms(2026, 9, 18, 2, 30, 0).single().unwrap().timestamp_millis();
        assert_eq!(day_of(late, 0), "2026-09-18");
        assert_eq!(day_of(late, 5), "2026-09-17");
        let noon = Local.with_ymd_and_hms(2026, 9, 18, 12, 0, 0).single().unwrap().timestamp_millis();
        assert_eq!(day_of(noon, 0), "2026-09-18");
        assert_eq!(day_of(noon, 5), "2026-09-18");
    }

    /// A journal day ends at the next date's grace hour, and a set time always falls inside
    /// the day it belongs to — the rule "Post at" leans on (§8.4).
    #[test]
    fn day_bounds() {
        for grace in [0u8, 5u8] {
            let ends = day_ends("2026-09-18", grace);
            for hhmm in ["00:30", "08:00", "20:00", "23:59"] {
                let at = time_in_day("2026-09-18", hhmm, grace);
                assert!(at < ends, "{hhmm} at grace {grace} falls outside its own day");
                assert_eq!(day_of(at, grace), "2026-09-18");
            }
        }
    }
}
