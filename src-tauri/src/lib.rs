mod archive;
mod connection;
mod musicbrainz;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            app.manage(connection::initialize(app.handle())?);
            app.manage(musicbrainz::MusicBrainzClient::new());
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            archive::archive_status,
            archive::archive_artists,
            archive::archive_cached_catalog,
            archive::archive_match_albums,
            archive::archive_match_wanted,
            connection::wanted_snapshot,
            connection::wanted_add,
            connection::wanted_add_many,
            connection::wanted_remove,
            connection::wanted_set_paused,
            connection::wanted_set_interval,
            connection::wanted_set_preferences,
            connection::wanted_sync_fulfilled,
            connection::wanted_check,
            connection::connection_bootstrap,
            connection::connection_save_profile,
            connection::connection_connect,
            connection::connection_disconnect,
            connection::connection_reset,
            connection::connection_diagnostics,
            connection::search_snapshot,
            connection::search_start,
            connection::search_stop,
            connection::transfers_snapshot,
            connection::transfer_enqueue,
            connection::transfer_enqueue_release,
            connection::transfer_pause,
            connection::transfer_resume,
            connection::transfer_cancel,
            connection::transfer_reveal_path,
            connection::transfer_pause_release,
            connection::transfer_resume_release,
            connection::transfer_cancel_release,
            connection::transfer_reorder_release,
            connection::transfer_clear_completed,
            connection::transfer_reveal_release_path,
            connection::folder_inspect,
            connection::shares_browse,
            connection::shares_folder,
            connection::shares_search,
            connection::local_shares_snapshot,
            connection::local_shares_add,
            connection::local_shares_remove,
            connection::local_shares_set_enabled,
            connection::local_shares_rescan,
            connection::local_shares_set_upload_slots,
            connection::uploads_snapshot,
            connection::upload_cancel,
            connection::upload_clear_finished,
            connection::people_snapshot,
            connection::people_profile,
            connection::people_set_favorite,
            connection::people_set_blocked,
            connection::people_set_ignored,
            connection::messages_snapshot,
            connection::messages_send,
            connection::messages_retry,
            connection::messages_open,
            connection::messages_mark_read,
            connection::messages_mark_unread,
            connection::messages_clear,
            connection::messages_remove,
            musicbrainz::album_artists_search,
            musicbrainz::album_catalog,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
