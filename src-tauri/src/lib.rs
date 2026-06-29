mod apple;
mod library;
mod model;
mod provider;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Seed the user-token store from disk so a prior sign-in survives restarts.
    let apple_state = apple::AppleState::default();
    if let Some(tok) = apple::load_persisted_user_token() {
        *apple_state.user_token.lock().unwrap() = Some(tok);
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(apple_state)
        .setup(|app| {
            use tauri::Manager;

            // Open the local library cache (SQLite) in the app data dir.
            let dir = app.path().app_data_dir().expect("app data dir");
            std::fs::create_dir_all(&dir).ok();
            let conn =
                rusqlite::Connection::open(dir.join("deetsmusic.db")).expect("open library db");
            library::init_db(&conn).expect("init library db");
            app.manage(library::Db(std::sync::Mutex::new(conn)));

            // Auto-open devtools in dev so the webview console is visible.
            #[cfg(debug_assertions)]
            if let Some(win) = app.get_webview_window("main") {
                win.open_devtools();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            apple::apple_developer_token,
            apple::apple_begin_auth,
            apple::apple_connection_status,
            apple::apple_user_token,
            apple::apple_disconnect,
            apple::apple_dump_library,
            library::library_sync,
            library::library_tracks,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
