mod airplay;
mod audio_out;
mod apple;
mod beta;
mod bridge;
mod credits;
mod db_thread;
mod dbhealth;
mod diary;
mod enrich;
mod favorites;
mod friends;
mod lastfm;
mod library;
mod lock;
use lock::LockExt;
mod log;
mod loudness;
mod model;
mod media;
mod playlists;
mod presence;
mod provider;
mod query;
mod report;
mod settings;
mod rooms;
mod roworder;
mod smtc;
mod sotd;
mod tray;
mod update;
mod wallpaper;
mod watchdog;
mod web;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // DeetsMusic Beta only: take the full app's data on the first start or after a pull
    // (beta.rs, docs/ops/BETA.md §2). Before the Builder, because Tauri opens the config
    // windows — and their localStorage — before the setup hook runs.
    beta::before_start();

    // FIRST plugin on purpose: a second process must be turned away BEFORE any setup
    // runs, or it opens the same SQLite file and takes the next bridge port. The
    // callback activates the window we already have — the same path as the tray menu's
    // "Open DeetsMusic", so a tray flyout un-pops to the full surface, back on the
    // taskbar, and a window hidden to the tray comes back.
    // The same second process is how a `deetsmusic://auth?…` link reaches the app: the
    // browser starts the exe with the link as its argument, and it lands here as argv
    // (DATA-ARCHITECTURE §2a). The nonce check inside decides whether it is accepted.
    let single_instance = tauri_plugin_single_instance::init(|app: &tauri::AppHandle, argv, _cwd| {
        if let Some(link) = apple::link_in_args(argv.iter()) {
            // `<scheme>://lastfm?token=…` is Last.fm's link back after Allow (LASTFM.md §4).
            if lastfm::is_link(link) {
                lastfm::handle_link(link);
            } else if friends::is_link(link) {
                // `<scheme>://friend?code=…` is a friend invite (FRIENDS.md §3, fork 2C).
                // Like the room link it only fills a field; the person presses Add.
                friends::handle_link(app, link);
            } else if rooms::is_link(link) {
                // `<scheme>://room?code=…` is an invite (ROOMS.md §1). It carries no
                // power: the code is all it holds, and the front end asks before joining.
                rooms::handle_link(app, link);
            } else {
                apple::handle_link(app, link);
            }
        }
        tray::show_main(app);
    });

    tauri::Builder::default()
        .plugin(single_instance)
        // Registers the scheme (the installer for a release, `register()` below for a
        // debug build). Link delivery itself is the single-instance callback above.
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        // The updater (RELEASE.md §6): transport, signature check, install. update.rs adds
        // the rules — one download at a time, the size cap, rollback, no install in dev.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(apple::AppleState::default())
        .manage(update::UpdateState::default())
        .manage(bridge::Hub::default())
        .manage(airplay::AirplayState::default())
        // A local playlist's own cover, served as a link (`http://cover.localhost/<id>`)
        // instead of a data URL inside every playlists_cached reply (PLAYLISTS.md §10.6).
        // Off the webview thread: the read takes the db lock.
        .register_asynchronous_uri_scheme_protocol("cover", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            let path = request.uri().path().to_string();
            std::thread::spawn(move || responder.respond(playlists::cover_response(&app, &path)));
        })
        // The Glass canvas picture the user chose (`http://wallpaper.localhost/<stamp>`,
        // COVER-WALLPAPER.md §8). Off the webview thread: a file read.
        .register_asynchronous_uri_scheme_protocol("wallpaper", |ctx, _request, responder| {
            let app = ctx.app_handle().clone();
            std::thread::spawn(move || responder.respond(wallpaper::response(&app)));
        })
        .setup(|app| {
            use tauri::Manager;

            // Open the local library cache (SQLite) in the app data dir.
            let dir = app.path().app_data_dir().expect("app data dir");
            std::fs::create_dir_all(&dir).ok();
            // The rolling log first (LOGGING.md): everything below may need to write.
            log::init(&dir);
            beta::log_notes();
            let db_path = dir.join("deetsmusic.db");

            // First launch of the DEV identifier (`npm run dev:app`, HANDOFF → Run it): seed
            // its data dir from the installed app's — the library cache and the persisted
            // user token — so it opens signed-in with the library, zero Apple calls. Only
            // ever copies INTO an empty dev dir; the release dir is never written.
            if dir.file_name().and_then(|n| n.to_str()) == Some("com.deetsmusic.dev") && !db_path.exists() {
                let release = dir.with_file_name("com.deetsmusic.app");
                for name in ["deetsmusic.db", "user-token.txt", "developer-token.json"] {
                    let from = release.join(name);
                    if from.is_file() {
                        // The db runs in WAL mode (LOCAL-DATA.md §3): its newest writes can sit in
                        // `deetsmusic.db-wal` while the installed app runs, so a file copy could miss
                        // them. `VACUUM INTO` from a read-only connection writes one consistent file.
                        let copied = if name == "deetsmusic.db" {
                            rusqlite::Connection::open_with_flags(&from, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
                                .and_then(|src| src.execute("VACUUM INTO ?1", [dir.join(name).to_string_lossy()]))
                                .map(|_| 0)
                                .map_err(|e| std::io::Error::other(e.to_string()))
                        } else {
                            std::fs::copy(&from, dir.join(name))
                        };
                        match copied {
                            Ok(_) => log::info(&format!("dev: seeded {name} from {}", release.display())),
                            Err(e) => log::warn(&format!("dev: seed {name} failed: {e}")),
                        }
                    }
                }
            }

            // Hand the same dir to the Apple module, which resolves secrets and
            // the persisted user token against it. MUST happen before the token
            // is read below — hence the seeding moved in here from run()'s top,
            // where it ran before Tauri could tell us where app data lives.
            apple::set_app_data_dir(dir.clone());
            apple::set_app_handle(app.handle().clone());

            // Resolve the developer token ONCE, before the webview can ask for it:
            // local .p8 if present (the dev seam), else the cache, else one fetch
            // from the mint (RELEASE.md §7). A failure is logged, never fatal —
            // a first run with no network is a real state, and the message names it.
            if let Err(e) = apple::ensure_developer_token() {
                log::error(&format!("token: {e}"));
            }

            // Seed the user-token store so a prior sign-in survives restarts.
            if let Some(tok) = apple::load_persisted_user_token() {
                *app.state::<apple::AppleState>().user_token.lock_or_recover() = Some(tok);
            }

            // The deep-link scheme (DATA-ARCHITECTURE §2a). A debug build owns
            // `deetsmusic-dev://` and points it at this exe on every launch — one HKCU
            // key, never the installed app's `deetsmusic://`, which the installer wrote.
            // A link that STARTS the app has no sign-in to match: say so and move on.
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                #[cfg(debug_assertions)]
                if let Err(e) = app.deep_link().register(apple::link_scheme()) {
                    log::warn(&format!("sign-in: could not register {}://: {e}", apple::link_scheme()));
                }
                #[cfg(not(debug_assertions))]
                if let Err(e) = app.deep_link().register_all() {
                    log::warn(&format!("sign-in: could not register {}://: {e}", apple::link_scheme()));
                }
            }
            let args: Vec<String> = std::env::args().collect();
            if apple::link_in_args(args.iter()).is_some() {
                log::warn("sign-in: a link started the app, but no sign-in was in progress; ignored (start the sign-in from DeetsMusic)");
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
                // The file name only: it sits in the data dir, and a full path carries the Windows user name.
                log::info(&format!(
                    "migration: v1 db detected; backed up to {}",
                    bak.file_name().map(|n| n.to_string_lossy()).unwrap_or_default()
                ));
            }

            let mut conn = rusqlite::Connection::open(&db_path).expect("open library db");
            // Every fixed statement goes through `prepare_cached` (2026-09-18): SQLite compiles
            // it once per connection, not per call. 45 fixed statements; the default cache holds 16.
            conn.set_prepared_statement_cache_capacity(96);
            // WAL (LOCAL-DATA.md §3, 2026-09-16): in the default journal mode any reader of the
            // file (a DB browser, a slow copy for `deetsmusic sql`) made the app's next write fail
            // at once — a play event, a scrobble. With WAL, readers and the writer don't block each
            // other; the busy timeout covers the brief checkpoint lock. The mode is stored in the file.
            match conn.query_row("PRAGMA journal_mode = WAL", [], |r| r.get::<_, String>(0)) {
                Ok(mode) if mode.eq_ignore_ascii_case("wal") => {}
                Ok(mode) => log::warn(&format!("db: journal mode stayed {mode}")),
                Err(e) => log::warn(&format!("db: could not set WAL: {e}")),
            }
            if let Err(e) = conn.busy_timeout(std::time::Duration::from_secs(2)) {
                log::warn(&format!("db: busy timeout: {e}"));
            }
            query::set_db_path(db_path.clone());
            library::init_db(&conn).expect("init library db");
            enrich::init_tables(&conn).expect("init enrichment tables");
            playlists::init_tables(&conn).expect("init playlist tables");
            web::init_tables(&conn).expect("init web tables");
            credits::init_tables(&conn).expect("init credit tables");
            dbhealth::init_tables(&conn).expect("init db health tables");
            if migrate {
                library::migrate_v2(&mut conn).expect("v2 migration failed (backup intact)");
            }
            library::migrate_v3(&conn).expect("v3 migration failed");
            library::migrate_v4(&conn).expect("v4 migration failed");
            library::migrate_v5(&conn).expect("v5 migration failed");
            library::migrate_v6(&conn).expect("v6 migration failed");
            loudness::migrate_v7(&conn).expect("v7 migration failed");
            library::migrate_v8(&conn).expect("v8 migration failed");
            library::migrate_v9(&conn).expect("v9 migration failed");
            sotd::migrate_v10(&conn).expect("v10 migration failed");
            playlists::migrate_v11(&conn).expect("v11 migration failed");
            library::migrate_v12(&conn).expect("v12 migration failed");
            roworder::migrate_v13(&conn).expect("v13 migration failed");
            diary::migrate_v14(&conn).expect("v14 migration failed");
            diary::migrate_v15(&conn).expect("v15 migration failed");
            app.manage(library::Db(std::sync::Mutex::new(conn)));
            // Every command that takes the lock runs on this one thread, in arrival order.
            db_thread::start(app.handle());
            // Is the database still writable? (DB-HEALTH.md) The first canary runs at once.
            dbhealth::start(app.handle().clone());

            // Back-end settings (minimize-to-tray, Windows-media fallback, the
            // extension pairing token), then the tray + the extension bridge.
            app.manage(settings::Settings::load(dir.clone()));
            // Last.fm (LASTFM.md): the saved session, and the scrobbles still waiting.
            lastfm::setup(app.handle(), dir.clone());
            // Song of the Day (docs/integrations/DeetsOTD.md): the outlets that are set up, and the posts
            // that were still waiting when the app last closed.
            sotd::setup(app.handle(), dir.clone());
            // Friends (docs/integrations/FRIENDS.md §2): the key file, if this PC already has one. It
            // mints nothing here — a first key waits for the first ask.
            friends::setup(dir.clone());
            airplay::setup(&dir);
            // Sound (SOUND.md §2.2): the Windows output, its form factor and volume.
            audio_out::setup(app.handle());
            tray::setup(app.handle())?;

            // A login launch (`--tray`, the Run-key command) starts in the tray.
            if std::env::args().any(|a| a == "--tray") {
                tray::start_hidden(app.handle());
            }
            // Any other launch shows the window when the page is ready (`main_ready`);
            // this shows it after 3 s if the page never says so (UX-COVERUPS.md §6).
            tray::reveal_fallback(app.handle());
            // First run of an INSTALLED build enrols in start-with-Windows once
            // (DeetsAirplay / DeetsRGB pattern); the Settings toggle owns it after.
            // A dev build never touches the registry.
            #[cfg(not(debug_assertions))]
            {
                let s = app.state::<settings::Settings>();
                if !s.get().autostart_seeded {
                    if let Err(e) = settings::autostart_write(true) {
                        log::warn(&format!("autostart: {e}"));
                    }
                    s.update(|d| d.autostart_seeded = true).ok();
                }
            }
            bridge::start(app.handle().clone());

            // Our Windows media session (overlay + media keys) on the main HWND.
            if let Some(win) = app.get_webview_window("main") {
                if let Err(e) = smtc::init(app.handle().clone(), &win) {
                    log::warn(&format!("smtc: init failed: {e}"));
                }
            }

            // No browser keys in the installed app (DRAG-DROP.md §6): Ctrl+F find, Ctrl+P
            // print, Ctrl+R / F5 reload, zoom, F7 caret browsing, Alt+Left back. The page
            // still gets the keydown, so the app's own Ctrl shortcuts keep working. Release
            // only, so F12 devtools stay in dev.
            #[cfg(not(debug_assertions))]
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.with_webview(|wv| {
                    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
                    use windows::core::Interface;
                    let off = || -> windows::core::Result<()> {
                        unsafe {
                            let settings = wv.controller().CoreWebView2()?.Settings()?;
                            settings.cast::<ICoreWebView2Settings3>()?.SetAreBrowserAcceleratorKeysEnabled(false)
                        }
                    };
                    if let Err(e) = off() {
                        log::warn(&format!("webview: browser keys stay on: {e}"));
                    }
                });
            }

            // Auto-open devtools in dev so the webview console is visible. DEETS_NO_DEVTOOLS=1
            // holds it shut: DevTools renders its own UI in the SAME GPU process as the app, so
            // any graphics measurement taken with it open is measuring DevTools too — it was the
            // largest single distortion in the 2026-09-16 pass. `npm run dev:app -- --perf` sets
            // it (DEBUGGING.md §Measuring like the live app).
            #[cfg(debug_assertions)]
            if std::env::var("DEETS_NO_DEVTOOLS").as_deref() != Ok("1") {
                if let Some(win) = app.get_webview_window("main") {
                    win.open_devtools();
                }
            }
            // A freeze cannot report itself: the thread that would write the line is the
            // thread that is stuck. This watches from outside (watchdog.rs, FRIENDS.md §8.11).
            watchdog::start(app.handle());
            Ok(())
        })
        .on_window_event(|win, ev| tray::on_window_event(win, ev))
        .invoke_handler(invoke_with_watchdog(tauri::generate_handler![
            apple::apple_developer_token,
            apple::apple_remote_config,
            apple::apple_begin_auth,
            apple::apple_connection_status,
            apple::apple_auth_status,
            apple::apple_cancel_auth,
            apple::apple_check,
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
            apple::library_artist_info,
            apple::library_artists_expire,
            web::web_build,
            web::web_seeds,
            playlists::playlists_song_index,
            library::play_counts,
            library::pins_list,
            presence::presence_set,
            presence::presence_clear,
            presence::presence_close,
            // Friends (docs/integrations/FRIENDS.md §2, §3). The seed leaves Rust only by `friend_key_export`.
            friends::friend_me,
            friends::friend_sign,
            friends::friend_key_export,
            friends::friend_key_import,
            friends::friend_list,
            friends::friend_add,
            friends::friend_rename,
            friends::friend_remove,
            roworder::row_order_all,
            roworder::row_order_set,
            roworder::row_order_reset,
            // The Diary (docs/features/DIARY.md): local only, never in the query export.
            diary::diary_list,
            diary::diary_get,
            diary::diary_open,
            diary::diary_update,
            diary::diary_song_set,
            diary::diary_rescale,
            diary::diary_delete,
            diary::diary_set_done,
            diary::diary_folders,
            diary::diary_folder_create,
            diary::diary_folder_rename,
            diary::diary_folder_delete,
            diary::diary_file,
            diary::diary_export,
            settings::settings_set_agent_diary,
            library::pin_set,
            library::pin_clear,
            library::pin_play_counts,
            library::library_sync,
            library::library_tracks,
            library::seen_tracks,
            library::record_play,
            library::record_event_start,
            library::record_event_end,
            library::play_events_since,
            library::play_event_count,
            library::added_at_map,
            apple::artist_photos,
            apple::recent_played_tracks,
            apple::recent_added,
            apple::artist_new_releases,
            library::materialize_track,
            favorites::favorite_set,
            favorites::favorites_cached,
            favorites::favorites_known,
            favorites::favorites_reconcile,
            favorites::favorite_collection_set,
            favorites::favorite_collection_reconcile,
            enrich::catalog_enrich,
            enrich::album_palette,
            credits::credits_stats,
            credits::credits_for,
            enrich::credits_fetch,
            credits::songs_by_writer,
            dbhealth::db_health,
            playlists::playlists_cached,
            playlists::apple_playlists_sync,
            playlists::apple_playlist_counts,
            playlists::apple_playlist_tracks,
            playlists::playlist_create,
            playlists::playlist_rename,
            playlists::playlist_set_cover,
            wallpaper::wallpaper_set,
            wallpaper::wallpaper_colors,
            playlists::playlist_export_plan,
            playlists::playlist_export_apple,
            playlists::playlist_get_apple_songs,
            playlists::playlist_refresh_rows,
            playlists::playlist_refresh_set,
            playlists::playlist_refresh_stamp,
            playlists::playlist_refetch,
            library::pin_act,
            playlists::playlist_import,
            playlists::apple_playlist_add,
            playlists::playlist_delete,
            playlists::playlist_keep,
            playlists::playlists_expire,
            playlists::playlist_restore,
            playlists::playlist_add_tracks,
            playlists::playlist_remove_track,
            playlists::playlist_reorder,
            playlists::playlist_insert_tracks,
            playlists::local_playlist_tracks,
            playlists::playlist_folders_list,
            playlists::playlist_folder_create,
            playlists::playlist_folder_rename,
            playlists::playlist_folder_delete,
            playlists::playlist_folder_assign,
            settings::settings_get,
            settings::settings_set_minimize_to_tray,
            settings::settings_set_read_windows_media,
            settings::settings_rotate_bridge_token,
            settings::settings_set_airplay_capture,
            settings::settings_set_agent_control,
            settings::settings_set_agent_history,
            settings::settings_set_lastfm_scrobble,
            settings::settings_set_lastfm_now_playing,
            // Song of the Day (docs/integrations/DeetsOTD.md §8.2)
            settings::settings_set_sotd,
            settings::settings_set_sotd_day_start,
            settings::settings_set_sotd_picks_per_day,
            settings::settings_set_sotd_post_mode,
            settings::settings_set_sotd_post_at,
            settings::settings_set_sotd_post_as,
            sotd::pick_today,
            sotd::picks_list,
            sotd::pick_mark,
            sotd::pick_note,
            sotd::pick_unmark,
            sotd::pick_post,
            sotd::pick_withdraw,
            sotd::post_log,
            sotd::pick_skip,
            sotd::pick_delete_posts,
            sotd::outbox::picks_missed,
            sotd::outbox::picks_missed_skip,
            sotd::outlet::outlet_status,
            sotd::outlet::outlet_connect,
            sotd::outlet::outlet_disconnect,
            sotd::outlet::outlet_set_on,
            lastfm::lastfm_begin_auth,
            lastfm::lastfm_auth_status,
            lastfm::lastfm_cancel_auth,
            lastfm::lastfm_disconnect,
            lastfm::lastfm_status,
            lastfm::lastfm_open_profile,
            lastfm::lastfm_heard,
            settings::autostart_get,
            settings::autostart_set,
            settings::agent_setup_text,
            settings::agent_open_guide,
            audio_out::audio_output,
            loudness::loudness_all,
            loudness::loudness_save,
            loudness::loudness_forget,
            airplay::airplay_scan,
            airplay::airplay_connect,
            airplay::airplay_disconnect,
            airplay::airplay_status,
            airplay::airplay_volume,
            airplay::airplay_tap,
            airplay::airplay_firewall_prompt,
            bridge::np_publish,
            bridge::np_snapshot,
            bridge::np_command,
            bridge::appearance_publish,
            bridge::bridge_info,
            bridge::bridge_log,
            log::diag_flush,
            log::log_event,
            library::queue_state_get,
            library::queue_state_set,
            library::dead_ids_cached,
            library::dead_ids_mark,
            log::log_open_folder,
            bridge::bridge_open_install_page,
            bridge::bridge_resolve,
            bridge::agent_reply,
            bridge::bridge_add,
            media::win_media_now_playing,
            media::win_media_transport,
            media::win_media_seek,
            media::system_volume_get,
            media::system_volume_set,
            media::system_volume_mute,
            tray::tray_panel_hide,
            tray::tray_open_main,
            tray::tray_place_main,
            tray::main_ready,
            tray::tray_pin_main,
            tray::tray_panel_resize,
            tray::app_quit,
            update::update_status,
            update::update_check,
            update::update_download,
            update::update_install,
            update::update_versions,
            report::report_log,
            report::report_send,
            report::report_list,
            report::report_open,
            report::report_refresh,
            report::report_close,
            report::report_clear,
        ]))
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Wrap the generated handler so every command records its name while it runs
/// (`watchdog.rs`). The wrapper costs one mutex on each side of a call.
///
/// The timing is what makes it worth having. An **async** command returns here almost at
/// once, because `spawn_blocking` moved the body off this thread — so it clears its name and
/// the watchdog sees nothing. A **synchronous** command does not return until its body is
/// done. A name still sitting here after five seconds therefore names a sync command that is
/// blocking the thread that paints, which is precisely the 0.12.0 fault (FRIENDS.md §8.11).
fn invoke_with_watchdog<R: tauri::Runtime, F>(handler: F) -> impl Fn(tauri::ipc::Invoke<R>) -> bool
where
    F: Fn(tauri::ipc::Invoke<R>) -> bool,
{
    move |invoke| {
        let name = invoke.message.command().to_string();
        watchdog::entered(&name);
        let handled = handler(invoke);
        watchdog::left();
        handled
    }
}
