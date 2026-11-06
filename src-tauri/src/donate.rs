//! The Donate panel's total (docs/features/donate.md § The total). He sets it on the admin page,
//! DeetsSupport keeps it as a `config` row, and `/config` returns it. The page cannot make this
//! call: `connect-src` does not list the host, and that policy stays as it is (ideas/donations.md
//! §5). The call carries no user ID and no version.

use std::time::Duration;

const CONFIG_URL: &str = "https://support.deets.solutions/config?app=deetsmusic";
const TIMEOUT: Duration = Duration::from_secs(5);

/// `config.donated` from a `/config` reply: whole dollars, 0 or more. Anything else is no value.
fn total_in(body: &serde_json::Value) -> Option<u64> {
    body.get("config")?.get("donated")?.as_u64()
}

/// The total now, or `None` when `/config` holds no usable one. An error means the worker was not
/// read: the panel keeps the last amount for both.
#[tauri::command]
pub async fn donate_total() -> Result<Option<u64>, String> {
    let resp = crate::apple::http_client()
        .get(CONFIG_URL)
        .timeout(TIMEOUT)
        .send()
        .await
        .map_err(|e| format!("donate: not sent: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("donate: the worker answered {}", resp.status().as_u16()));
    }
    let body: serde_json::Value = resp.json().await.map_err(|e| format!("donate: not JSON: {e}"))?;
    Ok(total_in(&body))
}

#[cfg(test)]
mod tests {
    use super::total_in;
    use serde_json::json;

    #[test]
    fn reads_whole_dollars() {
        assert_eq!(total_in(&json!({ "config": { "donated": 75 } })), Some(75));
        assert_eq!(total_in(&json!({ "config": { "donated": 0 } })), Some(0));
    }

    #[test]
    fn anything_else_is_no_value() {
        assert_eq!(total_in(&json!({ "config": {} })), None);
        assert_eq!(total_in(&json!({ "config": { "donated": -5 } })), None);
        assert_eq!(total_in(&json!({ "config": { "donated": 7.5 } })), None);
        assert_eq!(total_in(&json!({ "config": { "donated": "75" } })), None);
        assert_eq!(total_in(&json!({})), None);
    }
}
