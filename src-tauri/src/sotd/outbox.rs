//! The outbox (docs/DeetsOTD.md §8.2, §8.5) — when a pick is sent, and what happens when it
//! could not be.
//!
//! Three modes, one rule each:
//! - **Ask each time** — the rows go in as `asking` and the window shows the toast. Nothing
//!   leaves until the user presses Post.
//! - **Right away** — the rows go in and are sent at once.
//! - **At a set time** — the rows carry a `due_ts` inside the pick's own journal day, and one
//!   timer (re-armed on every change) fires them.
//!
//! Everything survives a restart, because the state is in `pick_posts` and not in memory.
//! A failed post is retried once at the next start, never in a loop, and only while the
//! pick's day has not ended — a post after that would count for the next day at Discord.

use std::collections::HashSet;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{LazyLock, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use super::{day_ends, day_of, now_ms, outlet, time_in_day, Pick};
use crate::library::Db;
use crate::settings::{PostMode, Settings};

/// Every arm gets a number; a timer whose number is stale exits without firing.
static GENERATION: AtomicU64 = AtomicU64::new(0);

/// The (pick, outlet) pairs a send holds right now. `post_now` has four callers — the
/// window's Post, the Right-away spawn, the set-time timer and the boot retry — and two
/// can read the same `waiting` row before either has written `sent`. A webhook is not
/// idempotent, so the second would post the song twice. The claim is in memory because
/// every caller lives in this process; a restart cannot overlap with itself.
static SENDING: LazyLock<Mutex<HashSet<(i64, String)>>> = LazyLock::new(|| Mutex::new(HashSet::new()));

/// Holds one claim; `Drop` releases it, so a panic inside the send cannot keep the outlet
/// silent for the rest of the session.
struct Claim(i64, String);

impl Claim {
    fn take(id: i64, outlet: &str) -> Option<Claim> {
        let mut held = SENDING.lock().unwrap_or_else(|e| e.into_inner());
        held.insert((id, outlet.to_string())).then(|| Claim(id, outlet.to_string()))
    }
}

impl Drop for Claim {
    fn drop(&mut self) {
        let mut held = SENDING.lock().unwrap_or_else(|e| e.into_inner());
        held.remove(&(self.0, self.1.clone()));
    }
}

// ── what the window is told ──────────────────────────────────────────────────

/// "Post “Song” to Discord?" — the Ask toast, for a mark made anywhere (a right-click, an
/// agent). The window writes the sentence; this only says which pick and where to.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AskEvent {
    pub id: i64,
    pub title: String,
    pub outlets: Vec<String>,
}

/// What one send did, so the window's toast can name the real reason a post did not go
/// (§8.5). It carries no secret: an outlet's name, and the message the outlet gave us.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PostedEvent {
    pub id: i64,
    pub title: String,
    pub outlet: String,
    pub ok: bool,
    pub error: Option<String>,
}

fn ask(app: &AppHandle, pick: &Pick, outlets: Vec<String>) {
    let _ = app.emit(
        "sotd-ask",
        AskEvent { id: pick.id, title: super::title_of(&pick.meta), outlets },
    );
}

// ── the rows ─────────────────────────────────────────────────────────────────

fn set_state(app: &AppHandle, id: i64, outlet: &str, state: &str, remote: Option<&str>, error: Option<&str>) {
    let db = app.state::<Db>();
    let conn = db.lock();
    let _ = crate::dbhealth::watch(
        "pick post state",
        conn.execute(
            "UPDATE pick_posts SET state = ?1, remote_id = ?2, error = ?3, at = ?4 WHERE pick_id = ?5 AND outlet = ?6",
            rusqlite::params![state, remote, error, now_ms(), id, outlet],
        ),
    );
}

fn add_rows(app: &AppHandle, id: i64, outlets: &[String], state: &str, due: Option<i64>) {
    let db = app.state::<Db>();
    let conn = db.lock();
    for o in outlets {
        let _ = crate::dbhealth::watch(
            "pick post row",
            conn.execute(
                "INSERT OR REPLACE INTO pick_posts(pick_id, outlet, state, due_ts, remote_id, error, at)
                 VALUES(?1, ?2, ?3, ?4, NULL, NULL, ?5)",
                rusqlite::params![id, o, state, due, now_ms()],
            ),
        );
    }
}

/// The message: the song's Apple Music link, then the note on a second line. Discord draws
/// its own preview of the link, so we upload no artwork (§8.3).
fn message(pick: &Pick) -> String {
    let link = format!("https://music.apple.com/song/{}", pick.track_id);
    match pick.note.as_deref().map(str::trim).filter(|n| !n.is_empty()) {
        Some(n) => format!("{link}\n{n}"),
        None => link,
    }
}

// ── sending ──────────────────────────────────────────────────────────────────

/// Send one pick to one outlet, and write down what happened.
async fn send_one(app: &AppHandle, pick: &Pick, outlet_name: &str) {
    let Some(_claim) = Claim::take(pick.id, outlet_name) else {
        crate::log::info(&format!("sotd:post:busy outlet={outlet_name} id={} (a send already holds it)", pick.id));
        return;
    };
    let r = outlet::post(app, outlet_name, &message(pick)).await;
    let err = match &r {
        Ok(remote) => {
            set_state(app, pick.id, outlet_name, "sent", Some(remote), None);
            outlet::note_error(outlet_name, None);
            crate::log::info(&format!("sotd:post:sent outlet={outlet_name} id={} message={remote}", pick.id));
            None
        }
        Err(e) => {
            set_state(app, pick.id, outlet_name, "failed", None, Some(e));
            outlet::note_error(outlet_name, Some(e.clone()));
            crate::log::warn(&format!("sotd:post:fail outlet={outlet_name} id={} ({e})", pick.id));
            Some(e.clone())
        }
    };
    let _ = app.emit(
        "sotd-posted",
        PostedEvent {
            id: pick.id,
            title: super::title_of(&pick.meta),
            outlet: outlet_name.to_string(),
            ok: err.is_none(),
            error: err,
        },
    );
    super::changed(app);
}

/// Send a pick to every outlet whose row is not `sent` yet. The Ask toast's Post, the tile
/// menu's Post Now, Right away, and a fired timer all come through here.
pub async fn post_now(app: &AppHandle, id: i64) {
    let Some(pick) = super::pick_by_id(app, id) else { return };
    let live = outlet::live();
    // An outlet turned on after the mark still gets the pick: it has no row yet.
    let missing: Vec<String> = live.iter().filter(|o| !pick.posts.iter().any(|p| &&p.outlet == o)).cloned().collect();
    if !missing.is_empty() {
        add_rows(app, id, &missing, "waiting", None);
    }
    let Some(pick) = super::pick_by_id(app, id) else { return };
    for p in &pick.posts {
        if p.state == "sent" || !live.contains(&p.outlet) {
            continue;
        }
        crate::log::info(&format!("sotd:post:fire outlet={} id={id}", p.outlet));
        send_one(app, &pick, &p.outlet).await;
    }
    rearm(app);
}

/// Right after a mark: the rows, and what the post mode says to do with them.
pub fn after_mark(app: &AppHandle, id: i64) {
    let Some(pick) = super::pick_by_id(app, id) else { return };
    let live = outlet::live();
    if live.is_empty() {
        return; // local only — the window's toast says so
    }
    let s = app.state::<Settings>().get();
    match s.sotd_post_mode {
        PostMode::Ask => {
            add_rows(app, id, &live, "asking", None);
            ask(app, &pick, live);
        }
        PostMode::Now => {
            add_rows(app, id, &live, "waiting", None);
            let app = app.clone();
            tauri::async_runtime::spawn(async move { post_now(&app, id).await });
        }
        PostMode::Time => {
            let due = time_in_day(&pick.day, &s.sotd_post_at, s.sotd_day_start);
            add_rows(app, id, &live, "waiting", Some(due));
            crate::log::info(&format!("sotd:post:arm id={id} due={due}"));
            rearm(app);
        }
    }
}

// ── the timer ────────────────────────────────────────────────────────────────

async fn sleep(d: Duration) {
    let _ = tauri::async_runtime::spawn_blocking(move || std::thread::sleep(d)).await;
}

/// Every post still waiting on a clock, with its pick's day.
fn due_rows(app: &AppHandle) -> Vec<(i64, i64, String)> {
    let db = app.state::<Db>();
    let conn = db.lock();
    let Ok(mut stmt) = conn.prepare_cached(
        "SELECT p.pick_id, p.due_ts, k.day FROM pick_posts p JOIN picks k ON k.id = p.pick_id
         WHERE p.state = 'waiting' AND p.due_ts IS NOT NULL ORDER BY p.due_ts",
    ) else {
        return vec![];
    };
    stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .map(|it| it.filter_map(Result::ok).collect())
        .unwrap_or_default()
}

/// Arm one timer for the next post due. Called after every change that could move it.
pub fn rearm(app: &AppHandle) {
    let gen = GENERATION.fetch_add(1, Ordering::Relaxed) + 1;
    if !app.state::<Settings>().get().sotd {
        return;
    }
    let rows = due_rows(app);
    let Some(next) = rows.iter().map(|(_, due, _)| *due).min() else { return };
    let wait = (next - now_ms()).max(0) as u64;
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        // Long sleeps are broken into minutes, so a machine that woke from sleep still
        // fires close to the time, and a stale generation exits at the next check.
        let mut left = wait;
        loop {
            if GENERATION.load(Ordering::Relaxed) != gen {
                return;
            }
            if left == 0 {
                break;
            }
            let step = left.min(60_000);
            sleep(Duration::from_millis(step)).await;
            left = left.saturating_sub(step);
        }
        if GENERATION.load(Ordering::Relaxed) != gen {
            return;
        }
        fire_due(&app).await;
    });
}

/// Send every post whose time has come — and only while its own journal day still runs.
async fn fire_due(app: &AppHandle) {
    let grace = app.state::<Settings>().get().sotd_day_start;
    let now = now_ms();
    let rows = due_rows(app);
    for (id, due, day) in rows {
        if due > now {
            continue;
        }
        if day_ends(&day, grace) <= now {
            continue; // the day ended while we were away: the window asks (see `missed`)
        }
        post_now(app, id).await;
    }
    rearm(app);
}

/// A pick whose set time went by while the app was closed AND whose day has since ended.
/// The window asks "Post yesterday's pick now? It will count for today." before anything
/// leaves (§8.5).
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Missed {
    pub id: i64,
    pub title: String,
    pub day: String,
}

#[tauri::command]
pub fn picks_missed(app: AppHandle) -> Vec<Missed> {
    let grace = app.state::<Settings>().get().sotd_day_start;
    let now = now_ms();
    due_rows(&app)
        .into_iter()
        .filter(|(_, due, day)| *due <= now && day_ends(day, grace) <= now)
        .filter_map(|(id, _, day)| super::pick_by_id(&app, id).map(|p| Missed { id, title: super::title_of(&p.meta), day }))
        .collect::<Vec<_>>()
        .into_iter()
        .fold(Vec::new(), |mut acc, m| {
            if !acc.iter().any(|x: &Missed| x.id == m.id) {
                acc.push(m);
            }
            acc
        })
}

/// "Skip" on the missed-time question: the pick stays, the posts do not go.
#[tauri::command]
pub fn picks_missed_skip(id: i64, app: AppHandle) -> Result<(), String> {
    {
        let db = app.state::<Db>();
        let conn = db.lock();
        let _ = conn.execute(
            "UPDATE pick_posts SET state = 'skipped', due_ts = NULL, at = ?1 WHERE pick_id = ?2 AND state = 'waiting'",
            rusqlite::params![now_ms(), id],
        );
    }
    crate::log::info(&format!("sotd:post:skip id={id} (missed time)"));
    super::changed(&app);
    Ok(())
}

// ── start ────────────────────────────────────────────────────────────────────

/// At launch, and whenever the feature is switched back on: take up what was left.
pub fn setup(app: &AppHandle) {
    if !app.state::<Settings>().get().sotd {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let s = app.state::<Settings>().get();
        let grace = s.sotd_day_start;
        let today = day_of(now_ms(), grace);
        let now = now_ms();

        // An Ask that was never answered: ask again while it is still that day, else let it go.
        let asking: Vec<(i64, String)> = {
            let db = app.state::<Db>();
            let conn = db.lock();
            let Ok(mut stmt) = conn.prepare_cached(
                "SELECT DISTINCT p.pick_id, k.day FROM pick_posts p JOIN picks k ON k.id = p.pick_id WHERE p.state = 'asking'",
            ) else {
                return;
            };
            stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
                .map(|it| it.filter_map(Result::ok).collect())
                .unwrap_or_default()
        };
        for (id, day) in asking {
            if day == today {
                if let Some(pick) = super::pick_by_id(&app, id) {
                    let live: Vec<String> = pick.posts.iter().filter(|p| p.state == "asking").map(|p| p.outlet.clone()).collect();
                    ask(&app, &pick, live);
                }
            } else {
                let db = app.state::<Db>();
                let conn = db.lock();
                let _ = conn.execute(
                    "UPDATE pick_posts SET state = 'skipped', at = ?1 WHERE pick_id = ?2 AND state = 'asking'",
                    rusqlite::params![now_ms(), id],
                );
            }
        }

        // One retry for what failed, while its own day still runs (§8.5: never a loop).
        let failed: Vec<(i64, String)> = {
            let db = app.state::<Db>();
            let conn = db.lock();
            let Ok(mut stmt) = conn.prepare_cached(
                "SELECT DISTINCT p.pick_id, k.day FROM pick_posts p JOIN picks k ON k.id = p.pick_id WHERE p.state = 'failed'",
            ) else {
                return;
            };
            stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
                .map(|it| it.filter_map(Result::ok).collect())
                .unwrap_or_default()
        };
        for (id, day) in failed {
            if day_ends(&day, grace) > now {
                post_now(&app, id).await;
            }
        }

        // A set time that went by while the app ran on, or while it was closed but inside
        // the day, fires now. One that outlived its day waits for the window's question.
        fire_due(&app).await;
    });
}

/// Song of the Day went Off: the timer stops. Every waiting post stays waiting.
pub fn stop() {
    GENERATION.fetch_add(1, Ordering::Relaxed);
}
