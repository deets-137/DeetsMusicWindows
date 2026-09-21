//! The Discord webhook outlet (docs/integrations/DeetsOTD.md §8.3, §8.4a).
//!
//! What the user gives us is one webhook URL for their channel. No bot, no token, no
//! developer portal, no sign-in. The URL is a credential — anyone who holds it can post in
//! that channel — so it is checked before it is stored, it is stored encrypted
//! (`outlet.rs`), and it is never logged or sent to the renderer.
//!
//! The message is the song's Apple Music link, and the note on a second line. Discord draws
//! its own preview of the link; we upload no artwork. DeetsOTD's `_apple_track_id` reads
//! the `/song/<id>` form, so the post resolves as `direct` with no change to that repo.

use std::time::Duration;

use serde::Deserialize;
use tauri::{AppHandle, Manager};

use super::outlet::Conn;
use crate::settings::Settings;

const TIMEOUT: Duration = Duration::from_secs(15);
/// A webhook reply is small; a body past this is not Discord answering.
const MAX_BODY: usize = 1 << 20;

/// The hosts a Discord webhook can live on. The app never sends a request to any other host
/// for this outlet, whatever was pasted (§8.15, "Input checks").
const HOSTS: [&str; 6] =
    ["discord.com", "discordapp.com", "canary.discord.com", "ptb.discord.com", "canary.discordapp.com", "ptb.discordapp.com"];

/// Is this a Discord webhook URL, and nothing else? `https`, one of Discord's own hosts, and
/// the path `/api[/vNN]/webhooks/<digits>/<token>`.
pub fn valid_url(raw: &str) -> bool {
    let Ok(u) = url::Url::parse(raw.trim()) else { return false };
    if u.scheme() != "https" {
        return false;
    }
    let Some(host) = u.host_str() else { return false };
    if !HOSTS.iter().any(|h| host.eq_ignore_ascii_case(h)) {
        return false;
    }
    let mut parts: Vec<&str> = u.path().split('/').filter(|s| !s.is_empty()).collect();
    if parts.first() != Some(&"api") {
        return false;
    }
    parts.remove(0);
    // An optional API version, as Discord's own docs write it.
    if parts.first().map(|s| s.starts_with('v') && s[1..].chars().all(|c| c.is_ascii_digit())).unwrap_or(false) {
        parts.remove(0);
    }
    match parts.as_slice() {
        ["webhooks", id, token] => !id.is_empty() && id.chars().all(|c| c.is_ascii_digit()) && !token.is_empty(),
        _ => false,
    }
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(TIMEOUT)
        .user_agent(format!("DeetsMusic/{}", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())
}

/// The body, capped. A reply past the cap is an error, never a panic and never memory we
/// did not mean to take.
async fn body(resp: reqwest::Response) -> Result<String, String> {
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() > MAX_BODY {
        return Err("the reply was too large".into());
    }
    String::from_utf8(bytes.to_vec()).map_err(|_| "the reply was not text".to_string())
}

/// Discord's webhook object. It carries the webhook's own NAME and the ids of its channel
/// and server — but no channel or server *names* (checked against Discord's REST docs,
/// 2026-09-18; the doc's §8.4a said otherwise). So the status line names the webhook.
#[derive(Deserialize)]
struct Hook {
    name: Option<String>,
    channel_id: Option<String>,
}

#[derive(Deserialize)]
struct Message {
    id: String,
}

/// Check a pasted URL: ask Discord what the webhook is. It posts nothing.
pub async fn check(input: &str) -> Result<Conn, String> {
    let url = input.trim().to_string();
    if !valid_url(&url) {
        return Err("This is not a Discord webhook link.".into());
    }
    let resp = client()?.get(&url).send().await.map_err(|e| {
        if e.is_timeout() { "Discord did not answer.".to_string() } else { "Could not reach Discord.".to_string() }
    })?;
    let status = resp.status().as_u16();
    if status == 401 || status == 403 || status == 404 {
        return Err("Discord does not know this webhook. Copy it again.".into());
    }
    if status != 200 {
        return Err(format!("Discord answered {status}."));
    }
    let text = body(resp).await?;
    let hook: Hook = serde_json::from_str(&text).map_err(|_| "Discord's answer was not a webhook.".to_string())?;
    // A webhook with no channel is not one we can post to.
    if hook.channel_id.as_deref().unwrap_or("").is_empty() {
        return Err("This webhook has no channel.".into());
    }
    let name = hook.name.unwrap_or_default();
    let where_to = if name.is_empty() { "your channel".to_string() } else { name.clone() };
    Ok(Conn { secret: url, where_to, default_name: name, on: true, error: None })
}

/// Post one message. `?wait=true` makes Discord answer with the message, whose id is what a
/// later Unmark needs to delete it.
pub async fn post(app: &AppHandle, c: &Conn, text: &str) -> Result<String, String> {
    let name = app.state::<Settings>().get().sotd_post_as;
    let mut payload = serde_json::json!({ "content": text });
    if !name.trim().is_empty() {
        payload["username"] = serde_json::Value::String(name.trim().to_string());
    }
    let resp = client()?
        .post(format!("{}?wait=true", c.secret))
        .json(&payload)
        .send()
        .await
        .map_err(|e| if e.is_timeout() { "Discord did not answer".to_string() } else { "could not reach Discord".to_string() })?;
    let status = resp.status().as_u16();
    if status == 404 {
        return Err("the webhook no longer exists".into());
    }
    if status == 429 {
        return Err("Discord asked us to slow down".into());
    }
    if !(200..300).contains(&status) {
        return Err(format!("Discord answered {status}"));
    }
    let text = body(resp).await?;
    let m: Message = serde_json::from_str(&text).map_err(|_| "Discord's answer had no message".to_string())?;
    Ok(m.id)
}

/// Delete one of our own messages.
pub async fn delete(c: &Conn, message_id: &str) -> Result<(), String> {
    if !message_id.chars().all(|ch| ch.is_ascii_digit()) {
        return Err("not a message id".into());
    }
    let resp = client()?
        .delete(format!("{}/messages/{message_id}", c.secret))
        .send()
        .await
        .map_err(|_| "could not reach Discord".to_string())?;
    let status = resp.status().as_u16();
    // Already gone counts as deleted.
    if (200..300).contains(&status) || status == 404 {
        Ok(())
    } else {
        Err(format!("Discord answered {status}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn takes_a_real_webhook_url() {
        assert!(valid_url("https://discord.com/api/webhooks/123456789/abcDEF-token_1"));
        assert!(valid_url("https://discord.com/api/v10/webhooks/123/tok"));
        assert!(valid_url("https://ptb.discord.com/api/webhooks/123/tok"));
        assert!(valid_url("  https://discordapp.com/api/webhooks/123/tok  "));
    }

    /// Anything else is refused BEFORE a request is made, so the app never calls a host the
    /// user pasted (§8.15).
    #[test]
    fn refuses_everything_else() {
        for bad in [
            "https://example.com/api/webhooks/1/x",
            "http://discord.com/api/webhooks/1/x",
            "https://discord.com.evil.net/api/webhooks/1/x",
            "https://discord.com/api/webhooks/abc/x",
            "https://discord.com/api/webhooks/1",
            "https://discord.com/api/webhooks/1/x/extra",
            "https://discord.com/webhooks/1/x",
            "not a url",
            "",
        ] {
            assert!(!valid_url(bad), "{bad} should be refused");
        }
    }
}
