mod connection;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            app.manage(connection::initialize(app.handle())?);
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
