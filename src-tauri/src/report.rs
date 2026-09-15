//! In-app reports — Settings › Bugs (LOGGING.md step 5; DeetsSolutions/docs/support.md "Intake").
//!
//! A bug or a suggestion goes to `POST support.deets.solutions/posts` with `source: "app"`.
//! A bug can carry a log tail in `meta.log`, filtered to the area the user picked, so the
//! 8 KB the worker allows holds the lines that matter. Every post carries `meta.version`
//! (the boards' Version filter reads it).
//!
//! The worker answers with the post's code. The code is the only way back to the thread,
//! and it is a credential (whoever holds it reads and replies), so:
//! - the app keeps its own list in `<app_data>/reports.json` (Settings › Bugs › My reports);
//! - the code is never written to the log, which a later report attaches.
//!
//! The front end shows the exact log text before sending (`report_log`) and sends that text
//! back; it is scrubbed again here, and a payload shaped like a JWT is refused before it
//! leaves the PC — the worker refuses it too, but with a bare 400.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, Manager};

const POSTS_URL: &str = "https://support.deets.solutions/posts";
const TICKET_PAGE: &str = "https://deets.solutions/deetsmusic/#t=";
const APP_ID: &str = "deetsmusic";

// The worker's limits (DeetsSupport src/index.js). Lengths are JS `.length`: UTF-16 units.
const TITLE_WORDS: usize = 10;
const TITLE_MAX: usize = 120;
const BODY_MAX: usize = 4000;
/// `meta` is capped at 8192; the margin covers JS re-serializing the object differently.
const META_MAX: usize = 8192 - 192;
/// The whole request is capped at 16 KB (bytes, before parse).
const REQUEST_MAX: usize = 16 * 1024 - 512;
const SEND_TIMEOUT: Duration = Duration::from_secs(20);

const STORE: &str = "reports.json";
const KEEP: usize = 100;

// ── the log tail ────────────────────────────────────────────────────────────────────

/// The tags each bug type keeps. `None` = "Something else": the whole tail. Every type
/// also keeps the startup line, panics and every ERROR line (`keep`).
fn area_tags(area: &str) -> Option<&'static [&'static str]> {
    let tags: &'static [&'static str] = match area {
        "playback" => &["player:", "apple:", "token:", "smtc:", "airplay:", "toast", "window:"],
        "signin" => &["sign-in:", "token:", "account:", "apple:", "webview:"],
        "library" => &["library:", "playlists:", "favorites:", "enrich:", "migration:", "apple:"],
        "airplay" => &["airplay:", "player:"],
        "updates" => &["update:"],
        _ => return None,
    };
    Some(tags)
}
const ALWAYS: &[&str] = &["start:", "panic:"];

/// A file line is `2026-09-11 14:03:22.481  WARN  msg`: the level sits at 25..30, the
/// message from 31. A diag block's body line is indented: `        1234ms  tag {…}`.
/// Front-end lines carry their tag after `fe: `.
fn tag_of(line: &str) -> &str {
    let rest = if line.starts_with(' ') {
        let t = line.trim_start();
        t.split_once("ms  ").map(|(_, r)| r).unwrap_or(t)
    } else {
        line.get(31..).unwrap_or("")
    };
    rest.strip_prefix("fe: ").unwrap_or(rest)
}

fn keep(line: &str, tags: Option<&[&str]>) -> bool {
    let Some(tags) = tags else { return true };
    if line.get(25..30) == Some("ERROR") {
        return true;
    }
    let tag = tag_of(line);
    ALWAYS.iter().chain(tags.iter()).any(|t| tag.starts_with(t))
}

fn utf16(s: &str) -> usize {
    s.encode_utf16().count()
}

/// The newest lines whose JSON-escaped text fits `budget`, oldest first.
fn fit(lines: &[String], budget: usize) -> Vec<String> {
    let mut used = 0;
    let mut out = Vec::new();
    for l in lines.iter().rev() {
        // escaped length, plus the `\n` joining it to the next line
        let cost = serde_json::to_string(l).map(|s| utf16(&s)).unwrap_or(l.len()) + 2;
        if used + cost > budget {
            break;
        }
        used += cost;
        out.push(l.clone());
    }
    out.reverse();
    out
}

/// The log text a bug report of this type attaches — shown to the user before sending.
#[tauri::command]
pub fn report_log(area: String) -> String {
    let Some(path) = crate::log::path() else { return String::new() };
    let read = |p: PathBuf| std::fs::read(p).map(|b| String::from_utf8_lossy(&b).into_owned()).unwrap_or_default();
    let prev = read(path.with_file_name(crate::log::PREV));
    let cur = read(path.clone());
    let tags = area_tags(&area);
    let lines: Vec<String> = prev
        .lines()
        .chain(cur.lines())
        .filter(|l| keep(l, tags))
        .map(crate::log::scrub)
        .collect();
    // `{"version":"…","log":""}` is well under 64.
    fit(&lines, META_MAX - 64).join("\n")
}

// ── sending ─────────────────────────────────────────────────────────────────────────

/// The worker's regex: `eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}`.
fn jwt_shaped(s: &str) -> bool {
    let b64 = |c: &&u8| c.is_ascii_alphanumeric() || **c == b'-' || **c == b'_';
    let bytes = s.as_bytes();
    s.match_indices("eyJ").any(|(i, _)| {
        let rest = &bytes[i + 3..];
        let a = rest.iter().take_while(b64).count();
        a >= 8 && rest.get(a) == Some(&b'.') && rest[a + 1..].iter().take_while(b64).count() >= 8
    })
}

#[derive(Serialize, Deserialize, Clone, Default)]
struct Saved {
    code: String,
    kind: String,
    title: String,
    /// Unix seconds.
    at: i64,
    /// The worker's state at the last Refresh (`new` … `closed`; `gone` = the post no longer
    /// exists). None = never checked.
    #[serde(default)]
    state: Option<String>,
    /// Owner replies at the last Refresh, and how many of them Open has shown.
    #[serde(default)]
    owner_replies: u32,
    #[serde(default)]
    seen_replies: u32,
    /// When the post was first stored closed or removed (Unix seconds). `load` drops the
    /// report CLOSED_KEEP_S later, so the file cannot grow without bound.
    #[serde(default)]
    closed_at: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportView {
    code: String,
    kind: String,
    title: String,
    at: i64,
    url: String,
    state: Option<String>,
    new_reply: bool,
}

impl From<Saved> for ReportView {
    fn from(s: Saved) -> Self {
        let url = format!("{TICKET_PAGE}{}", s.code);
        let new_reply = s.owner_replies > s.seen_replies;
        ReportView { code: s.code, kind: s.kind, title: s.title, at: s.at, url, state: s.state, new_reply }
    }
}

/// Send a bug (`issue`) or a suggestion. `log` is the text `report_log` returned and the
/// user saw; a suggestion never carries one. Returns the saved report with its page link.
#[tauri::command]
pub async fn report_send(
    app: AppHandle,
    kind: String,
    title: String,
    body: String,
    log: Option<String>,
) -> Result<ReportView, String> {
    if kind != "issue" && kind != "suggestion" {
        return Err("Unknown report type.".into());
    }
    // The worker counts words with split(/\s+/); collapse the spaces so a stray one can't add a word.
    // The user's own text gets the log's scrubber too: the music-user token is not JWT-shaped,
    // so only the scrubber (a registered secret) catches one pasted into a report.
    let title = crate::log::scrub(&title).split_whitespace().collect::<Vec<_>>().join(" ");
    let body = crate::log::scrub(&body);
    if title.is_empty() {
        return Err("Add a title.".into());
    }
    if title.split(' ').count() > TITLE_WORDS {
        return Err(format!("Keep the title to {TITLE_WORDS} words or fewer."));
    }
    if utf16(&title) > TITLE_MAX {
        return Err("The title is too long.".into());
    }
    let body = body.trim().to_string();
    if body.is_empty() {
        return Err("Add the details.".into());
    }
    if utf16(&body) > BODY_MAX {
        return Err(format!("The details are too long. Use {BODY_MAX} characters or fewer."));
    }

    let version = env!("CARGO_PKG_VERSION");
    let mut lines: Vec<String> = match (kind.as_str(), log) {
        ("issue", Some(l)) => l.lines().map(crate::log::scrub).collect(),
        _ => Vec::new(),
    };
    // Normally the text already fits (report_log sized it); drop the oldest lines until
    // both the meta cap and the request cap hold.
    let payload = loop {
        let mut meta = serde_json::json!({ "version": version });
        if !lines.is_empty() {
            meta["log"] = lines.join("\n").into();
        }
        let meta_len = utf16(&meta.to_string());
        let text = serde_json::json!({
            "app": APP_ID, "source": "app", "kind": kind, "title": title, "body": body, "meta": meta,
        })
        .to_string();
        if (meta_len <= META_MAX && text.len() <= REQUEST_MAX) || lines.is_empty() {
            break text;
        }
        lines.remove(0);
    };
    if jwt_shaped(&payload) {
        return Err("The report holds text that looks like a sign-in key. Remove it and try again.".into());
    }

    let client = reqwest::Client::builder()
        .timeout(SEND_TIMEOUT)
        .user_agent(format!("DeetsMusic/{version}"))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .post(POSTS_URL)
        .header("Content-Type", "application/json")
        .body(payload)
        .send()
        .await
        .map_err(|e| {
            crate::log::warn(&format!("report: send failed: {e}"));
            "Couldn't reach the support server. Check the connection and try again.".to_string()
        })?;
    let status = resp.status().as_u16();
    let reply: serde_json::Value = resp.json().await.unwrap_or_default();
    let code = reply.get("code").and_then(|c| c.as_str()).unwrap_or("");
    if status != 201 || !valid_code(code) {
        let err = reply.get("error").and_then(|v| v.as_str()).unwrap_or("");
        crate::log::warn(&format!("report: the server answered {status} {err}"));
        return Err(match (status, err) {
            (429, _) => "Too many reports in a short time. Wait a minute and try again.",
            (503, _) => "Reports are switched off for now. Try again later.",
            (413, _) | (400, "meta") | (400, "too_large") => "The report is too large. Turn off Attach log, or shorten the details.",
            (400, "title_words") => "Keep the title to 10 words or fewer.",
            (400, "credential_shaped") => "The report holds text that looks like a sign-in key. Remove it and try again.",
            _ => "The support server didn't take the report. Try again later.",
        }
        .into());
    }
    // Never the code: the log rides later reports and is served over loopback.
    crate::log::info(&format!("report: sent {kind}{}", if lines.is_empty() { "" } else { " with log" }));

    let saved = Saved { code: code.to_string(), kind, title, at: chrono::Utc::now().timestamp(), ..Default::default() };
    let mut list = load(&app);
    list.insert(0, saved.clone());
    list.truncate(KEEP);
    save(&app, &list);
    Ok(saved.into())
}

// ── My reports ──────────────────────────────────────────────────────────────────────

fn valid_code(code: &str) -> bool {
    (8..=32).contains(&code.len()) && code.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

fn store_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join(STORE))
}

/// A closed or removed report stays this long after it was first stored that way (the user's
/// call: keep closed tickets a day, so the file cannot grow without bound).
const CLOSED_KEEP_S: i64 = 24 * 60 * 60;

fn is_done(s: &Saved) -> bool {
    matches!(s.state.as_deref(), Some("closed") | Some("gone"))
}

/// Drop the reports closed for longer than CLOSED_KEEP_S.
fn fresh(list: Vec<Saved>, now: i64) -> Vec<Saved> {
    list.into_iter().filter(|s| s.closed_at.map_or(true, |t| now - t < CLOSED_KEEP_S)).collect()
}

/// Stamp `closed_at` on a report first stored closed; clear it if the owner reopened the post.
fn stamped(list: &[Saved], now: i64) -> Vec<Saved> {
    list.iter()
        .cloned()
        .map(|mut s| {
            s.closed_at = if is_done(&s) { s.closed_at.or(Some(now)) } else { None };
            s
        })
        .collect()
}

fn load(app: &AppHandle) -> Vec<Saved> {
    let list = store_path(app)
        .and_then(|p| std::fs::read(p).ok())
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default();
    fresh(list, chrono::Utc::now().timestamp())
}

/// Write beside, then rename over: a crash mid-write must not lose the only copy of the codes.
fn save(app: &AppHandle, list: &[Saved]) {
    let Some(path) = store_path(app) else { return };
    let Ok(text) = serde_json::to_vec_pretty(&stamped(list, chrono::Utc::now().timestamp())) else { return };
    let tmp = path.with_extension("json.tmp");
    if std::fs::write(&tmp, text).is_ok() {
        if let Err(e) = std::fs::rename(&tmp, &path) {
            crate::log::warn(&format!("report: couldn't save the list: {e}"));
        }
    }
}

/// The reports this install sent, newest first.
#[tauri::command]
pub fn report_list(app: AppHandle) -> Vec<ReportView> {
    load(&app).into_iter().map(Into::into).collect()
}

/// Open a report's page in the browser. Only a code this install saved. The thread is read
/// there, so this marks the owner replies seen (My reports' dot goes).
#[tauri::command]
pub fn report_open(app: AppHandle, code: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let mut list = load(&app);
    let Some(s) = list.iter_mut().find(|s| valid_code(&code) && s.code == code) else {
        return Err("unknown report".into());
    };
    if s.seen_replies != s.owner_replies {
        s.seen_replies = s.owner_replies;
        save(&app, &list);
    }
    app.opener().open_url(format!("{TICKET_PAGE}{code}"), None::<&str>).map_err(|e| e.to_string())
}

// ── tracking: Refresh and Close (the user's calls: no request until Refresh is pressed) ──

const TICKET_API: &str = "https://support.deets.solutions/t/";
const NO_NETWORK: &str = "Couldn't reach the support server. Check the connection and try again.";

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(SEND_TIMEOUT)
        .user_agent(format!("DeetsMusic/{}", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())
}

/// My reports › Refresh: one `GET /t/<code>` per saved report, in turn. Stores each state and
/// owner-reply count; a request that fails keeps the last known values. Errors are logged
/// `without_url`: the URL holds the code.
#[tauri::command]
pub async fn report_refresh(app: AppHandle) -> Result<Vec<ReportView>, String> {
    let client = client()?;
    let codes: Vec<String> = load(&app).into_iter().map(|s| s.code).collect();
    let mut found: Vec<(String, String, u32)> = Vec::new(); // code, state, owner replies
    let mut failed = 0;
    for code in &codes {
        match client.get(format!("{TICKET_API}{code}")).send().await {
            Ok(resp) if resp.status().as_u16() == 404 => found.push((code.clone(), "gone".into(), 0)),
            Ok(resp) if resp.status().is_success() => {
                let v: serde_json::Value = resp.json().await.unwrap_or_default();
                match v.pointer("/post/state").and_then(|x| x.as_str()) {
                    Some(state) => {
                        let owner = v
                            .get("replies")
                            .and_then(|r| r.as_array())
                            .map_or(0, |r| r.iter().filter(|x| x.get("author").and_then(|a| a.as_str()) == Some("owner")).count());
                        found.push((code.clone(), state.to_string(), owner as u32));
                    }
                    None => failed += 1,
                }
            }
            Ok(resp) => {
                crate::log::warn(&format!("report: status check answered {}", resp.status().as_u16()));
                failed += 1;
            }
            Err(e) => {
                crate::log::warn(&format!("report: status check failed: {}", e.without_url()));
                failed += 1;
            }
        }
    }
    if found.is_empty() && failed > 0 {
        return Err(NO_NETWORK.into());
    }
    // Reload after the requests: a report sent meanwhile must not be lost.
    let mut list = load(&app);
    for (code, state, owner) in found {
        if let Some(s) = list.iter_mut().find(|s| s.code == code) {
            if state == "gone" {
                s.state = Some(state);
            } else {
                s.state = Some(state);
                s.owner_replies = owner;
            }
        }
    }
    save(&app, &list);
    Ok(list.into_iter().map(Into::into).collect())
}

/// My reports › Close: the reporter closes their own post (the web page's Close). The worker
/// shares its 5-per-minute limit with posts and replies.
#[tauri::command]
pub async fn report_close(app: AppHandle, code: String) -> Result<Vec<ReportView>, String> {
    if !valid_code(&code) || !load(&app).iter().any(|s| s.code == code) {
        return Err("unknown report".into());
    }
    let resp = client()?.post(format!("{TICKET_API}{code}/close")).send().await.map_err(|e| {
        crate::log::warn(&format!("report: close failed: {}", e.without_url()));
        NO_NETWORK.to_string()
    })?;
    let status = resp.status().as_u16();
    if !(200..300).contains(&status) && status != 404 {
        crate::log::warn(&format!("report: close answered {status}"));
        return Err(match status {
            429 => "Too many requests in a short time. Wait a minute and try again.",
            503 => "Reports are switched off for now. Try again later.",
            _ => "The support server didn't close the report. Try again later.",
        }
        .into());
    }
    let mut list = load(&app);
    if let Some(s) = list.iter_mut().find(|s| s.code == code) {
        s.state = Some(if status == 404 { "gone" } else { "closed" }.into());
    }
    save(&app, &list);
    crate::log::info("report: closed a report");
    Ok(list.into_iter().map(Into::into).collect())
}

/// My reports › right-click › Clear: forget a report on this PC. The post stays on the worker.
#[tauri::command]
pub fn report_clear(app: AppHandle, code: String) -> Vec<ReportView> {
    let mut list = load(&app);
    list.retain(|s| s.code != code);
    save(&app, &list);
    list.into_iter().map(Into::into).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn saved(state: Option<&str>, closed_at: Option<i64>) -> Saved {
        Saved { code: "c0de0000".into(), state: state.map(Into::into), closed_at, ..Default::default() }
    }

    #[test]
    fn closed_reports_expire_after_a_day() {
        let now = 1_000_000;
        let list = vec![
            saved(Some("closed"), Some(now - CLOSED_KEEP_S)),
            saved(Some("gone"), Some(now - 60)),
            saved(Some("open"), None),
        ];
        assert_eq!(fresh(list, now).len(), 2);
    }

    #[test]
    fn stamps_closed_and_unstamps_reopened() {
        let s = stamped(&[saved(Some("gone"), None), saved(Some("closed"), Some(5)), saved(Some("open"), Some(5))], 100);
        assert_eq!((s[0].closed_at, s[1].closed_at, s[2].closed_at), (Some(100), Some(5), None));
    }

    #[test]
    fn filters_by_area() {
        let rust = "2026-09-11 14:03:22.481  WARN  airplay: drop";
        let fe = "2026-09-11 14:03:22.481  WARN  fe: player:playFailed {}";
        let err = "2026-09-11 14:03:22.481  ERROR library: abort";
        let diag = "        1234ms  player:play {\"id\":1}";
        let start = "2026-09-11 14:03:22.481  INFO  start: DeetsMusic 0.4.3";
        let updates = area_tags("updates");
        assert!(!keep(rust, updates) && !keep(fe, updates) && !keep(diag, updates));
        assert!(keep(err, updates) && keep(start, updates));
        let playback = area_tags("playback");
        assert!(keep(fe, playback) && keep(diag, playback) && keep(rust, playback));
        assert!(keep(rust, area_tags("other")));
    }

    #[test]
    fn fits_newest_lines() {
        let lines: Vec<String> = (0..100).map(|i| format!("line {i:03} {}", "x".repeat(90))).collect();
        let out = fit(&lines, 1000);
        assert_eq!(out.last().unwrap(), &lines[99]);
        assert!(serde_json::to_string(&out.join("\n")).unwrap().len() <= 1000);
    }

    #[test]
    fn spots_jwt_shape() {
        assert!(jwt_shaped("x eyJhbGciOiJF.eyJpc3MiOiJ y"));
        assert!(!jwt_shaped("eyJshort.abc"));
        assert!(!jwt_shaped("token [redacted] done"));
    }
}
