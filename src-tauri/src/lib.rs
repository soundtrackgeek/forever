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
            connection::wanted_set_default_preferences,
            connection::wanted_sync_fulfilled,
            connection::wanted_fulfill_downloaded,
            connection::wanted_restore,
            connection::wanted_check,
            connection::radar_snapshot,
            connection::radar_start,
            connection::radar_stop,
            connection::connection_bootstrap,
            connection::connection_save_profile,
            connection::connection_connect,
            connection::connection_disconnect,
            connection::connection_reset,
            connection::connection_diagnostics,
            connection::rooms_snapshot,
            connection::rooms_refresh,
            connection::rooms_join,
            connection::rooms_leave,
            connection::rooms_send,
            connection::rooms_mark_read,
            connection::rooms_set_favorite,
            connection::search_snapshot,
            connection::search_start,
            connection::search_stop,
            connection::search_stop_all,
            connection::search_close,
            connection::transfers_snapshot,
            connection::transfers_prepare_for_restart,
            connection::transfers_cancel_restart_preparation,
            connection::transfer_set_max_concurrent_downloads,
            connection::transfer_set_relay_suggestion_minutes,
            connection::transfer_set_soundcheck_enabled,
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
            connection::transfer_set_release_filed,
            connection::transfer_clear_release_history,
            connection::transfer_verify_release,
            connection::transfers_verify_completed,
            connection::transfer_soundcheck_release,
            connection::transfer_retry_release_issues,
            connection::transfer_switch_release_source,
            connection::transfer_relay_release_source,
            connection::transfer_patch_release_file,
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
            musicbrainz::album_official_track_count,
            musicbrainz::album_official_tracklist,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    #[test]
    fn main_window_can_finish_close_requests() {
        let capability: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/default.json"))
                .expect("main-window capability should be valid JSON");
        let permissions = capability["permissions"]
            .as_array()
            .expect("main-window capability should list permissions");

        assert!(permissions
            .iter()
            .any(|permission| { permission.as_str() == Some("core:window:allow-close") }));
        assert!(permissions
            .iter()
            .any(|permission| { permission.as_str() == Some("core:window:allow-destroy") }));
    }
}
