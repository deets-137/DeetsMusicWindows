//! The Mac playback probe (tools/mac-probe/README.md).
//!
//! One window on WKWebView. `run.mjs` passes the developer token, the Music User Token and
//! the song to look for as environment variables. They reach the page as `window.__PROBE`
//! through an initialization script, so they are never written to a file in the page.
//! The page sends each result line back through `report`, which prints it for `run.mjs`.
//!
//! `PROBE_MODE=glass` opens the Liquid Glass test instead (glass.html + src/glass.rs).

#[cfg(target_os = "macos")]
mod glass;

#[tauri::command]
fn report(line: String) {
    println!("[probe] {line}");
}

/// The glass test's one command: place the native glass for this scene. Async, so it runs
/// off the main thread and can wait for the main thread to apply it (a sync command already
/// runs on the main thread and would deadlock on the wait).
#[cfg(target_os = "macos")]
#[tauri::command]
async fn glass_scene(app: tauri::AppHandle, scene: glass::Scene) -> Result<(), String> {
    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = tx.send(glass::apply(&scene));
    })
    .map_err(|e| e.to_string())?;
    if let Ok(Some(line)) = rx.recv() {
        println!("[probe] {line}");
    }
    Ok(())
}

fn env(name: &str) -> String {
    std::env::var(name).unwrap_or_default()
}

fn main() {
    let glass_mode = env("PROBE_MODE") == "glass";
    let cfg = serde_json::json!({
        "devToken": env("PROBE_DEV_TOKEN"),
        "mut": env("PROBE_MUT"),
        "song": env("PROBE_SONG"),
    });
    let init = format!("window.__PROBE = {cfg};");

    let builder = tauri::Builder::default();
    #[cfg(target_os = "macos")]
    let builder = builder.invoke_handler(tauri::generate_handler![report, glass_scene]);
    #[cfg(not(target_os = "macos"))]
    let builder = builder.invoke_handler(tauri::generate_handler![report]);

    builder
        .setup(move |app| {
            if glass_mode {
                let win = tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::App("glass.html".into()))
                    .title("Liquid Glass test")
                    .inner_size(900.0, 640.0)
                    .transparent(true)
                    .title_bar_style(tauri::TitleBarStyle::Overlay)
                    .hidden_title(true)
                    .build()?;
                #[cfg(target_os = "macos")]
                {
                    let wallpaper = env("PROBE_WALLPAPER");
                    win.with_webview(move |pw| glass::init(pw.inner(), wallpaper))?;
                }
                let _ = win;
            } else {
                tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::default())
                    .title("DeetsMusic Mac playback probe")
                    .inner_size(680.0, 760.0)
                    .initialization_script(&init)
                    .build()?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("the probe window failed to start");
}
