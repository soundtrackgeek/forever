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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
