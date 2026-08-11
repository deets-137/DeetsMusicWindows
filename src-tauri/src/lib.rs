mod apple;
mod enrich;
mod library;
mod model;
mod playlists;
mod provider;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(apple::AppleState::default())
        .setup(|app| {
            use tauri::Manager;

            // Open the local library cache (SQLite) in the app data dir.
            let dir = app.path().app_data_dir().expect("app data dir");
            std::fs::create_dir_all(&dir).ok();
            let db_path = dir.join("deetsmusic.db");

            // Hand the same dir to the Apple module, which resolves secrets and
            // the persisted user token against it. MUST happen before the token
            // is read below — hence the seeding moved in here from run()'s top,
            // where it ran before Tauri could tell us where app data lives.
            apple::set_app_data_dir(dir.clone());

            // Seed the user-token store so a prior sign-in survives restarts.
            if let Some(tok) = apple::load_persisted_user_token() {
                *app.state::<apple::AppleState>().user_token.lock().unwrap() = Some(tok);
            }

            // v2 migration (catalog-first keys): detect BEFORE opening the main
            // connection, back the file up, then migrate inside one transaction.
            let migrate = library::needs_v2_migration(&db_path);
            if migrate {
                // Timestamped so repeated attempts can never clobber a good backup.
                let stamp = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_secs())
                    .unwrap_or(0);
                let bak = dir.join(format!("deetsmusic.v1.{stamp}.bak.db"));
                std::fs::copy(&db_path, &bak).expect("backup db before v2 migration");
                println!("[library] v1 DB backed up to {}", bak.display());
            }

            let mut conn = rusqlite::Connection::open(&db_path).expect("open library db");
            library::init_db(&conn).expect("init library db");
            enrich::init_tables(&conn).expect("init enrichment tables");
            playlists::init_tables(&conn).expect("init playlist tables");
            if migrate {
                library::migrate_v2(&mut conn).expect("v2 migration failed (backup intact)");
            }
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
            apple::catalog_search,
            apple::catalog_collection_tracks,
            apple::catalog_artist,
            apple::apple_add_to_library,
            apple::radio_live,
            apple::radio_my_station,
            apple::radio_discovery,
            apple::radio_genres,
            apple::radio_genre_stations,
            apple::radio_seed_station,
            apple::catalog_song_artist,
            apple::catalog_related,
            library::library_sync,
            library::library_tracks,
            library::seen_tracks,
            library::record_play,
            library::record_event_start,
            library::record_event_end,
            library::play_events_since,
            library::materialize_track,
            enrich::catalog_enrich,
            enrich::album_palette,
            playlists::playlists_cached,
            playlists::apple_playlists_sync,
            playlists::apple_playlist_counts,
            playlists::apple_playlist_tracks,
            playlists::playlist_create,
            playlists::playlist_rename,
            playlists::playlist_delete,
            playlists::playlist_add_tracks,
            playlists::playlist_remove_track,
            playlists::playlist_reorder,
            playlists::local_playlist_tracks,
            playlists::playlist_folders_list,
            playlists::playlist_folder_create,
            playlists::playlist_folder_rename,
            playlists::playlist_folder_delete,
            playlists::playlist_folder_assign,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
