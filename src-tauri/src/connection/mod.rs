mod credentials;
mod diagnostics;
mod protocol;
mod search;
mod service;
mod settings;

use search::SearchSnapshot;
use service::{ConnectionBootstrap, ConnectionManager, ConnectionSnapshot, SaveConnectionRequest};
use tauri::{AppHandle, Manager, State};

pub fn initialize(app: &AppHandle) -> Result<ConnectionManager, String> {
    let config_directory = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    let download_directory = app
        .path()
        .download_dir()
        .unwrap_or_else(|_| config_directory.clone())
        .join("Forever");

    ConnectionManager::new(
        app.clone(),
        config_directory.join("connection.json"),
        config_directory.join("logs").join("connection.log"),
        download_directory,
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn connection_bootstrap(
    manager: State<'_, ConnectionManager>,
) -> Result<ConnectionBootstrap, String> {
    manager.bootstrap().map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn connection_save_profile(
    manager: State<'_, ConnectionManager>,
    request: SaveConnectionRequest,
) -> Result<ConnectionBootstrap, String> {
    manager
        .save_profile(request)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn connection_connect(
    manager: State<'_, ConnectionManager>,
) -> Result<ConnectionSnapshot, String> {
    manager.connect().map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn connection_disconnect(
    manager: State<'_, ConnectionManager>,
) -> Result<ConnectionSnapshot, String> {
    manager.disconnect().map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn connection_reset(
    manager: State<'_, ConnectionManager>,
) -> Result<ConnectionBootstrap, String> {
    manager.reset().map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn connection_diagnostics(
    manager: State<'_, ConnectionManager>,
) -> Result<Vec<diagnostics::DiagnosticEntry>, String> {
    Ok(manager.diagnostics())
}

#[tauri::command]
pub async fn search_snapshot(
    manager: State<'_, ConnectionManager>,
) -> Result<SearchSnapshot, String> {
    Ok(manager.current_search())
}

#[tauri::command]
pub async fn search_start(
    manager: State<'_, ConnectionManager>,
    query: String,
) -> Result<SearchSnapshot, String> {
    manager
        .start_search(query)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn search_stop(manager: State<'_, ConnectionManager>) -> Result<SearchSnapshot, String> {
    Ok(manager.stop_search())
}
